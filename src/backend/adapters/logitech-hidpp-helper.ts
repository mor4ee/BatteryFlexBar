import { execFile } from 'node:child_process';
import type { BatteryChargeStatus, BatteryDeviceSnapshot } from '../../core/battery-device';
import { levelFromPercent } from '../../core/battery-device';

type RawHelperResult = {
  source: string;
  transport: string;
  receiver: {
    vendorId: string;
    productId: string;
  };
  device: {
    name: string | null;
    modelId: string;
    slot: number;
    unitId: string;
    transportFlags: number;
    modelIds: number[];
    extendedModelId: number;
  };
  battery: {
    percentage: number;
    level: string;
    levelCode: number;
    status: string;
    statusCode: number;
  };
  protocol: {
    featureId: string;
    featureIndex: number;
    featureVersion: number;
    rawResponse: string;
  };
};

export type HelperRunResult = {
  stdout: string;
  stderr: string;
};

export type HelperRunner = (args: readonly string[]) => Promise<HelperRunResult>;

export class HelperExecutionError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number | string
  ) {
    super(message);
    this.name = 'HelperExecutionError';
  }
}

export function createExecutableRunner(
  executablePath: string,
  timeoutMs = 8_000
): HelperRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        executablePath,
        [...args],
        {
          encoding: 'utf8',
          maxBuffer: 64 * 1024,
          timeout: timeoutMs,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (error) {
            const exitCode = (error as NodeJS.ErrnoException & { code?: number | string })
              .code;
            reject(
              new HelperExecutionError(
                stderr.trim() || error.message || 'Battery helper failed',
                exitCode
              )
            );
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });
}

export type LogitechHidppHelperClientOptions = {
  runner: HelperRunner;
  helperArguments?: readonly string[];
  rediscoverOnFailure?: boolean;
  now?: () => Date;
  initialSlot?: number;
  onSlotChanged?: (slot: number) => void | Promise<void>;
};

export class LogitechHidppHelperClient {
  private cachedSlot: number | undefined;
  private readonly now: () => Date;

  constructor(private readonly options: LogitechHidppHelperClientOptions) {
    this.now = options.now ?? (() => new Date());
    if (
      options.initialSlot !== undefined &&
      (!Number.isInteger(options.initialSlot) || options.initialSlot < 1 || options.initialSlot > 6)
    ) {
      throw new RangeError('initialSlot must be an integer from 1 to 6.');
    }
    this.cachedSlot = options.initialSlot;
  }

  async read(): Promise<BatteryDeviceSnapshot> {
    if (this.cachedSlot !== undefined) {
      try {
        return await this.readOnce(this.cachedSlot);
      } catch (error) {
        if (this.options.rediscoverOnFailure === false) throw error;
        this.cachedSlot = undefined;
      }
    }

    return this.readOnce();
  }

  clearRouteCache(): void {
    this.cachedSlot = undefined;
  }

  private async readOnce(slot?: number): Promise<BatteryDeviceSnapshot> {
    const args = [
      ...(this.options.helperArguments ?? []),
      ...(slot === undefined ? [] : ['--slot', String(slot)])
    ];
    const result = await this.options.runner(args);
    const raw = parseHelperResult(result.stdout);
    const previousSlot = this.cachedSlot;
    this.cachedSlot = raw.device.slot;
    if (raw.device.slot !== previousSlot) {
      await this.options.onSlotChanged?.(raw.device.slot);
    }
    return normalizeHelperResult(raw, this.now());
  }
}

export function isLogitechDeviceUnavailableError(
  error: unknown,
  modelId: string
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(`Model ${modelId} was not found`) ||
    message.includes('Timed out waiting for HID++ response')
  );
}

export function parseHelperResult(stdout: string): RawHelperResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new HelperExecutionError(
      `Battery helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isRecord(value) || !isRecord(value.device) || !isRecord(value.battery)) {
    throw new HelperExecutionError('Battery helper result is missing device or battery.');
  }

  const percentage = value.battery.percentage;
  const slot = value.device.slot;
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new HelperExecutionError('Battery helper percentage must be an integer from 0 to 100.');
  }
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) {
    throw new HelperExecutionError('Battery helper slot must be an integer from 1 to 6.');
  }
  if (
    typeof value.source !== 'string' ||
    typeof value.device.name !== 'string' ||
    typeof value.device.modelId !== 'string' ||
    typeof value.device.unitId !== 'string' ||
    typeof value.battery.status !== 'string'
  ) {
    throw new HelperExecutionError('Battery helper result contains invalid identity fields.');
  }

  return value as RawHelperResult;
}

function normalizeHelperResult(
  raw: RawHelperResult,
  observedAt: Date
): BatteryDeviceSnapshot {
  const percent = raw.battery.percentage;
  const modelId = raw.device.modelId.toUpperCase();
  const g502 = modelId === '0X407F';
  return {
    id: normalizeDeviceId(raw),
    name: raw.device.name ?? raw.device.modelId,
    vendor: modelId === '0X4074' || g502 ? 'Logitech G' : 'Logitech',
    model: raw.device.modelId,
    kind: modelId === '0XB042' || modelId === '0X4074' || g502 ? 'mouse' : 'other',
    transport: 'receiver',
    battery: {
      percent,
      level: levelFromPercent(percent),
      status: normalizeChargeStatus(raw.battery.status),
      charging: isCharging(raw.battery.status),
      ...(g502 ? { approximate: true } : {})
    },
    availability: 'online',
    source: raw.source,
    ...(g502 ? { beta: true } : {}),
    observedAt: observedAt.toISOString()
  };
}

function normalizeDeviceId(raw: RawHelperResult): string {
  if (
    raw.device.modelId.toUpperCase() === '0X4074' &&
    /^[0-9a-f]{8}$/i.test(raw.device.unitId)
  ) {
    // Preserve the ID already stored by the initial G HUB implementation.
    const decimalUnitId = Number.parseInt(raw.device.unitId, 16);
    return `logitech-ghub:g305:${decimalUnitId}`;
  }
  return `logitech-hidpp:${raw.device.modelId.toLowerCase()}:${raw.device.unitId.toLowerCase()}`;
}

function normalizeChargeStatus(status: string): BatteryChargeStatus {
  switch (status) {
    case 'charging':
    case 'charging-nearly-full':
    case 'charging-slow':
      return 'charging';
    case 'discharging':
      return 'discharging';
    case 'full':
      return 'full';
    case 'invalid-battery':
    case 'thermal-error':
    case 'charging-error':
      return 'error';
    default:
      return 'unknown';
  }
}

function isCharging(status: string): boolean {
  return (
    status === 'charging' ||
    status === 'charging-nearly-full' ||
    status === 'charging-slow'
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
