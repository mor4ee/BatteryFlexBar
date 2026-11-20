import type { BatteryDeviceSnapshot } from '../../core/battery-device';
import { levelFromPercent } from '../../core/battery-device';
import {
  HelperExecutionError,
  type HelperRunner
} from './logitech-hidpp-helper';

type RawKeychronHelperResult = {
  source: string;
  transport: string;
  receiver: {
    vendorId: string;
    productId: string;
  };
  device: {
    name: string;
    model: string;
  };
  battery: {
    percentage: number;
    status: string;
    charging: boolean;
  };
};

export type KeychronRfHelperClientOptions = {
  runner: HelperRunner;
  receiverProductId?: string;
  now?: () => Date;
};

export class KeychronRfHelperClient {
  private readonly now: () => Date;

  constructor(private readonly options: KeychronRfHelperClientOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async read(): Promise<BatteryDeviceSnapshot> {
    const receiverProductId = this.options.receiverProductId ?? '0xD030';
    const result = await this.options.runner([
      '--keychron-rf',
      '--receiver-pid',
      receiverProductId,
      '--timeout-ms',
      '500',
      '--attempts',
      '2'
    ]);
    const raw = parseKeychronHelperResult(result.stdout);
    if (raw.receiver.productId.toUpperCase() !== receiverProductId.toUpperCase()) {
      throw new HelperExecutionError('Keychron helper reported a different receiver.');
    }
    return normalizeKeychronResult(raw, this.now());
  }
}

export function parseKeychronHelperResult(stdout: string): RawKeychronHelperResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new HelperExecutionError(
      `Keychron helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (
    !isRecord(value) ||
    !isRecord(value.receiver) ||
    !isRecord(value.device) ||
    !isRecord(value.battery)
  ) {
    throw new HelperExecutionError('Keychron helper result is incomplete.');
  }
  const percentage = value.battery.percentage;
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new HelperExecutionError(
      'Keychron helper percentage must be an integer from 0 to 100.'
    );
  }
  if (
    value.source !== 'keychron-rf-hid' ||
    value.transport !== 'keychron-link-2.4ghz' ||
    value.receiver.vendorId !== '0x3434' ||
    !['0xD030', '0xD031', '0xD038', '0xD028'].includes(value.receiver.productId) ||
    typeof value.device.name !== 'string' ||
    typeof value.device.model !== 'string' ||
    typeof value.battery.charging !== 'boolean' ||
    value.battery.status !== (value.battery.charging ? 'charging' : 'discharging') ||
    !matchesReceiverModel(value.receiver.productId, value.device.model) ||
    value.device.name !== `Keychron ${value.device.model}`
  ) {
    throw new HelperExecutionError('Keychron helper identity or status is invalid.');
  }
  return value as RawKeychronHelperResult;
}

function matchesReceiverModel(receiver: string, model: string): boolean {
  if (receiver === '0xD028') return /^Ultra-Link 8K \([0-9A-F]{4}\)$/.test(model);
  if (receiver === '0xD038') return ['M3 4K', 'M3 mini 4K', 'M4 4K', 'M6 4K'].includes(model);
  return ['M1', 'M2', 'M2 mini', 'M3', 'M3 mini', 'M6', 'M7'].includes(model);
}

function normalizeKeychronResult(
  raw: RawKeychronHelperResult,
  observedAt: Date
): BatteryDeviceSnapshot {
  const percent = raw.battery.percentage;
  const charging = raw.battery.charging;
  return {
    id: `keychron-rf:${raw.device.model.toLowerCase()}:${raw.receiver.vendorId.toLowerCase()}:${raw.receiver.productId.toLowerCase()}`,
    name: raw.device.name,
    vendor: 'Keychron',
    model: raw.device.model,
    kind: 'mouse',
    transport: 'receiver',
    battery: {
      percent,
      level: levelFromPercent(percent),
      status: charging ? 'charging' : 'discharging',
      charging
    },
    availability: 'online',
    source: raw.source,
    ...(raw.device.model !== 'M6' || raw.receiver.productId !== '0xD030' ? { beta: true } : {}),
    observedAt: observedAt.toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
