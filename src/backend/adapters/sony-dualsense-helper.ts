import { levelFromPercent, type BatteryDeviceSnapshot } from '../../core/battery-device';
import { HelperExecutionError, type HelperRunner } from './logitech-hidpp-helper';

export const SONY_DUALSENSE_PREFIX = 'sony-dualsense:';
const source = 'sony-dualsense-hid';
const identityPattern = /^sony-dualsense:(0x0ce6|0x0df2):([0-9a-f]{12}|path-[0-9a-f]{64})$/;

export function dualSenseUnitId(deviceId: string): string {
  const match = identityPattern.exec(deviceId);
  if (!match) throw new TypeError('Invalid DualSense device identity.');
  return match[2];
}

export class SonyDualSenseHelperClient {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly options: { runner: HelperRunner; now?: () => Date }) {}

  scan(enableBluetoothFor: readonly string[] = []): Promise<BatteryDeviceSnapshot[]> {
    // Only explicit per-controller permission can trigger a feature GET that
    // changes Bluetooth report mode. Serialize UI opt-in and regular scans.
    const unitIds = [...new Set(enableBluetoothFor.map(dualSenseUnitId))];
    const read = this.pending.then(async () => {
      const result = await this.options.runner([
        '--dualsense', '--timeout-ms', '600', '--attempts', '2',
        ...unitIds.flatMap((id) => ['--enable-bt-device', id])
      ]);
      return parseDualSenseHelperResult(result.stdout, this.options.now?.() ?? new Date());
    });
    this.pending = read.then(() => undefined, () => undefined);
    return read;
  }
}

export function parseDualSenseHelperResult(stdout: string, observedAt = new Date()): BatteryDeviceSnapshot[] {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch {
    throw new HelperExecutionError('DualSense helper returned invalid JSON.');
  }
  if (!isRecord(value) || value.source !== source || !Array.isArray(value.devices) || value.devices.length > 16) {
    throw new HelperExecutionError('DualSense helper returned an invalid device list.');
  }
  const devices = new Map<string, BatteryDeviceSnapshot>();
  for (const raw of value.devices) {
    if (!isRecord(raw) || !isRecord(raw.battery) || typeof raw.productId !== 'string'
      || typeof raw.unitId !== 'string' || typeof raw.transport !== 'string'
      || !['usb', 'bluetooth'].includes(raw.transport) || typeof raw.availability !== 'string'
      || !['online', 'unsupported', 'error'].includes(raw.availability)) {
      throw new HelperExecutionError('DualSense helper device is incomplete.');
    }
    const pid = raw.productId.toLowerCase();
    const model = pid === '0x0df2' ? 'dualsense-edge' : 'dualsense';
    const id = `${SONY_DUALSENSE_PREFIX}${pid}:${raw.unitId.toLowerCase()}`;
    try { dualSenseUnitId(id); } catch {
      throw new HelperExecutionError('DualSense helper identity is invalid.');
    }
    if (raw.model !== model) throw new HelperExecutionError('DualSense helper model does not match its product ID.');
    const percent = raw.battery.percentage;
    const status = raw.battery.status;
    const charging = raw.battery.charging;
    if (typeof status !== 'string' || typeof charging !== 'boolean') {
      throw new HelperExecutionError('DualSense helper battery status is invalid.');
    }
    const online = raw.availability === 'online';
    if (online
      ? typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100
        || !['charging', 'discharging', 'full'].includes(String(status)) || charging !== (status === 'charging')
        || (status === 'full' && percent !== 100)
      : percent !== null || charging !== false || !['error', 'unknown'].includes(String(status))) {
      throw new HelperExecutionError('DualSense helper battery status or percentage is invalid.');
    }
    if (raw.diagnostic !== undefined && (typeof raw.diagnostic !== 'string' || raw.diagnostic.length > 160)) {
      throw new HelperExecutionError('DualSense helper diagnostic is invalid.');
    }
    const snapshot: BatteryDeviceSnapshot = {
      id, name: model === 'dualsense-edge' ? 'DualSense Edge' : 'DualSense', vendor: 'Sony', model,
      kind: 'gamepad', transport: raw.transport as 'usb' | 'bluetooth',
      availability: raw.availability as BatteryDeviceSnapshot['availability'],
      battery: {
        percent: percent as number | null,
        level: typeof percent === 'number' ? levelFromPercent(percent) : 'unknown',
        status: status as BatteryDeviceSnapshot['battery']['status'], charging: charging as boolean,
        approximate: true, stepPercent: 10
      },
      source, observedAt: observedAt.toISOString(),
      ...(raw.diagnostic ? { diagnostic: raw.diagnostic as string } : {})
    };
    const previous = devices.get(id);
    // The same physical pad can enumerate on USB and Bluetooth simultaneously.
    // Prefer fresh telemetry, then USB; never let a failed duplicate hide it.
    if (!previous || priority(snapshot) > priority(previous)) devices.set(id, snapshot);
  }
  return [...devices.values()];
}

function priority(device: BatteryDeviceSnapshot): number {
  return (device.availability === 'online' ? 2 : 0) + (device.transport === 'usb' ? 1 : 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
