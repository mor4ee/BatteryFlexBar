import { levelFromPercent, type BatteryDeviceSnapshot } from '../../core/battery-device';
import { HelperExecutionError, type HelperRunner } from './logitech-hidpp-helper';

export const LAMZU_PARO_ID = 'lamzu-paro:37b0:paro';
export const LAMZU_AURORA_PREFIX = 'lamzu-aurora:';

export class LamzuParoHelperClient {
  constructor(private readonly options: { runner: HelperRunner; now?: () => Date }) {}

  async read(): Promise<BatteryDeviceSnapshot> {
    const result = await this.options.runner(['--lamzu-paro', '--attempts', '2']);
    return parseLamzuParoResult(result.stdout, this.options.now?.() ?? new Date());
  }

  async scan(): Promise<BatteryDeviceSnapshot[]> {
    const result = await this.options.runner(['--lamzu-aurora', '--attempts', '2']);
    return parseLamzuAuroraResult(result.stdout, this.options.now?.() ?? new Date());
  }
}

export function parseLamzuAuroraResult(stdout: string, observedAt: Date): BatteryDeviceSnapshot[] {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch {
    throw new HelperExecutionError('Lamzu Aurora helper returned invalid JSON.');
  }
  if (!isRecord(value) || value.source !== 'lamzu-aurora-hid' ||
      !Array.isArray(value.devices) || value.devices.length > 16) {
    throw new HelperExecutionError('Lamzu Aurora helper returned an invalid device list.');
  }
  const seen = new Set<string>();
  return value.devices.map((device: unknown): BatteryDeviceSnapshot => {
    if (!isRecord(device) || (device.vendorId !== '37b0' && device.vendorId !== '373e') ||
        typeof device.productId !== 'string' || !/^[0-9a-f]{4}$/.test(device.productId) ||
        typeof device.model !== 'string' || !/^[A-Z][A-Za-z0-9 ]{1,31}$/.test(device.model) ||
        (device.transport !== 'receiver' && device.transport !== 'usb') ||
        typeof device.percentage !== 'number' || !Number.isInteger(device.percentage) ||
        device.percentage < 0 || device.percentage > 100 ||
        typeof device.charging !== 'boolean' || typeof device.beta !== 'boolean') {
      throw new HelperExecutionError('Lamzu Aurora helper returned an invalid battery reading.');
    }
    const isParo = device.model === 'Paro';
    const verifiedParo = isParo && device.vendorId === '37b0' &&
      device.productId === (device.transport === 'usb' ? '0007' : '000d');
    if (device.beta === verifiedParo ||
        (isParo && !verifiedParo &&
          !(device.vendorId === '37b0' && device.transport === 'receiver' && device.productId === '000e'))) {
      throw new HelperExecutionError('Lamzu Aurora helper returned an invalid device route.');
    }
    const id = isParo ? LAMZU_PARO_ID :
      `${LAMZU_AURORA_PREFIX}${device.vendorId}:${device.model.toLowerCase().replace(/ +/g, '-')}`;
    if (seen.has(id)) throw new HelperExecutionError('Lamzu Aurora helper returned duplicate devices.');
    seen.add(id);
    return {
      id, name: `Lamzu ${device.model}`, vendor: 'Lamzu', model: device.model,
      kind: 'mouse', transport: device.transport,
      battery: {
        percent: device.percentage, level: levelFromPercent(device.percentage),
        status: device.charging ? 'charging' : 'discharging', charging: device.charging
      },
      availability: 'online',
      source: isParo ? 'lamzu-paro-hid' : 'lamzu-aurora-hid',
      observedAt: observedAt.toISOString(),
      ...(device.beta ? { beta: true } : {})
    };
  });
}

export function parseLamzuParoResult(stdout: string, observedAt: Date): BatteryDeviceSnapshot {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch {
    throw new HelperExecutionError('Lamzu Paro helper returned invalid JSON.');
  }
  if (!isRecord(value) || value.source !== 'lamzu-paro-hid' ||
      (value.transport !== 'receiver' && value.transport !== 'usb') || !isRecord(value.receiver) ||
      value.receiver.vendorId !== '0x37B0' ||
      value.receiver.productId !== (value.transport === 'usb' ? '0x0007' : '0x000D') ||
      !isRecord(value.device) || value.device.model !== 'Paro' ||
      !isRecord(value.battery)) {
    throw new HelperExecutionError('Lamzu Paro helper returned an invalid device identity.');
  }
  const percent = value.battery.percentage;
  const charging = value.battery.charging;
  if (!Number.isInteger(percent) || (percent as number) < 0 || (percent as number) > 100 ||
      typeof charging !== 'boolean' ||
      value.battery.status !== (charging ? 'charging' : 'discharging')) {
    throw new HelperExecutionError('Lamzu Paro helper returned an invalid battery status.');
  }
  return {
    id: LAMZU_PARO_ID,
    name: 'Lamzu Paro',
    vendor: 'Lamzu',
    model: 'Paro',
    kind: 'mouse',
    transport: value.transport,
    battery: {
      percent: percent as number,
      level: levelFromPercent(percent as number),
      status: charging ? 'charging' : 'discharging',
      charging
    },
    availability: 'online',
    source: 'lamzu-paro-hid',
    observedAt: observedAt.toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
