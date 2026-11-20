import { levelFromPercent, type BatteryLevel, type BatteryDeviceSnapshot } from '../../core/battery-device';
import { HelperExecutionError, type HelperRunner } from './logitech-hidpp-helper';

export const WINDOWS_BLUETOOTH_SOURCE = 'windows-bluetooth';
export const WINDOWS_BLUETOOTH_PREFIX = `${WINDOWS_BLUETOOTH_SOURCE}:`;
export const STANDARD_HID_SOURCE = 'standard-hid';
export const STANDARD_HID_PREFIX = `${STANDARD_HID_SOURCE}:`;
export const COMPX_MOUSE_SOURCE = 'compx-mouse';
export const SONIX_KEYBOARD_SOURCE = 'sonix-keyboard';
type CommonHidSource = typeof COMPX_MOUSE_SOURCE | typeof SONIX_KEYBOARD_SOURCE;
export const EXTRA_BETA_SOURCES = ['vendor-hid', 'rapoo-passive', 'gamepad-hid', 'xbox'] as const;
type ExtraBetaSource = (typeof EXTRA_BETA_SOURCES)[number];
const xboxLevels: readonly BatteryLevel[] = ['critical', 'low', 'medium', 'full'];
const containerIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function scanWindowsBluetooth(
  runner: HelperRunner,
  now = () => new Date()
): Promise<BatteryDeviceSnapshot[]> {
  const { stdout } = await runner(['--windows-bluetooth']);
  return parseWindowsBluetoothResult(stdout, now());
}

export async function scanStandardHid(
  runner: HelperRunner,
  now = () => new Date()
): Promise<BatteryDeviceSnapshot[]> {
  const { stdout } = await runner(['--standard-hid']);
  return parseSystemBatteryResult(stdout, now(), STANDARD_HID_SOURCE, 'usb', 'Standard HID');
}

export function parseWindowsBluetoothResult(stdout: string, now: Date): BatteryDeviceSnapshot[] {
  return parseSystemBatteryResult(stdout, now, WINDOWS_BLUETOOTH_SOURCE, 'bluetooth', 'Windows Bluetooth');
}

export async function scanCommonHidBattery(
  runner: HelperRunner, source: CommonHidSource, now = () => new Date()
): Promise<BatteryDeviceSnapshot[]> {
  const { stdout } = await runner([`--${source}`]);
  return parseSystemBatteryResult(stdout, now(), source, undefined, source === COMPX_MOUSE_SOURCE ? 'CompX' : 'SONiX');
}

export async function scanExtraBetaBattery(
  runner: HelperRunner, source: ExtraBetaSource, now = () => new Date()
): Promise<BatteryDeviceSnapshot[]> {
  const { stdout } = await runner([`--${source}`]);
  return parseSystemBatteryResult(stdout, now(), source, undefined, source);
}

function parseSystemBatteryResult(
  stdout: string,
  now: Date,
  source: typeof WINDOWS_BLUETOOTH_SOURCE | typeof STANDARD_HID_SOURCE | CommonHidSource | ExtraBetaSource,
  defaultTransport: 'bluetooth' | 'usb' | undefined,
  label: string
): BatteryDeviceSnapshot[] {
  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new HelperExecutionError(`${label} helper returned invalid JSON.`);
  }
  if (!isRecord(result) || result.source !== source ||
    !Array.isArray(result.devices) || result.devices.length > 64) {
    throw new HelperExecutionError(`${label} helper returned an invalid device list.`);
  }

  const seen = new Set<string>();
  const observedAt = now.toISOString();
  return result.devices.map((device: unknown): BatteryDeviceSnapshot => {
    if (!isRecord(device) || typeof device.containerId !== 'string' ||
      !containerIdPattern.test(device.containerId) || !/[1-9a-f]/i.test(device.containerId) ||
      typeof device.name !== 'string' || !device.name.trim() || device.name.length > 128) {
      throw new HelperExecutionError(`${label} helper returned an invalid device reading.`);
    }
    const percent = device.percentage;
    const discreteXbox = source === 'xbox' && percent === null;
    if (!discreteXbox && !isPercent(percent)) {
      throw new HelperExecutionError(`${label} helper returned an invalid percentage.`);
    }
    let transport: BatteryDeviceSnapshot['transport'];
    let kind: BatteryDeviceSnapshot['kind'] = 'other';
    let charging: boolean | null = null;
    let stepPercent: number | undefined;
    let level: BatteryDeviceSnapshot['battery']['level'] = isPercent(percent) ? levelFromPercent(percent) : 'unknown';
    if (source === COMPX_MOUSE_SOURCE) {
      if ((device.transport !== 'usb' && device.transport !== 'receiver') || typeof device.charging !== 'boolean') {
        throw new HelperExecutionError('CompX helper returned invalid transport or charging status.');
      }
      transport = device.transport;
      kind = 'mouse';
      charging = device.charging;
    } else if (source === SONIX_KEYBOARD_SOURCE) {
      if (device.transport !== 'receiver' || device.charging !== null || device.percentage === 0) {
        throw new HelperExecutionError('SONiX helper returned invalid wireless battery status.');
      }
      transport = 'receiver';
      kind = 'keyboard';
    } else if (source === 'vendor-hid' || source === 'rapoo-passive' || source === 'gamepad-hid' || source === 'xbox') {
      const validKind = source === 'xbox' || source === 'gamepad-hid' ? device.kind === 'gamepad' :
        device.kind === 'mouse' || (source === 'vendor-hid' && device.kind === 'keyboard');
      if (!validKind ||
        (source === 'xbox' ? device.transport !== 'unknown' : device.transport !== 'usb' && device.transport !== 'receiver') ||
        (source === 'gamepad-hid' && device.transport !== 'usb') ||
        (device.charging !== null && typeof device.charging !== 'boolean')) {
        throw new HelperExecutionError(`${label} helper returned invalid device metadata.`);
      }
      transport = device.transport as BatteryDeviceSnapshot['transport'];
      kind = device.kind as BatteryDeviceSnapshot['kind'];
      charging = device.charging;
      if (device.stepPercent !== undefined) {
        if (!isPercent(percent) || typeof device.stepPercent !== 'number' ||
          ![5, 10, 25].includes(device.stepPercent) || percent % device.stepPercent !== 0) {
          throw new HelperExecutionError(`${label} helper returned invalid measurement resolution.`);
        }
        stepPercent = device.stepPercent;
      }
      if (discreteXbox) {
        if (charging !== null || !xboxLevels.includes(device.level as BatteryLevel)) {
          throw new HelperExecutionError('XInput returned an invalid battery level.');
        }
        level = device.level as BatteryLevel;
      }
    } else {
      transport = defaultTransport ?? 'unknown';
    }
    const id = `${source}:${device.containerId.toLowerCase()}`;
    if (seen.has(id)) throw new HelperExecutionError(`${label} helper returned a duplicate container.`);
    seen.add(id);
    return {
      id,
      name: device.name.trim(),
      vendor: '',
      model: '',
      kind,
      transport,
      battery: {
        percent: isPercent(percent) ? percent : null,
        level,
        status: charging === null ? 'unknown' : charging ? 'charging' : 'discharging',
        charging: charging === true,
        ...(stepPercent ? { stepPercent, approximate: true } : {})
      },
      availability: 'online',
      source,
      beta: true,
      observedAt
    };
  });
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
