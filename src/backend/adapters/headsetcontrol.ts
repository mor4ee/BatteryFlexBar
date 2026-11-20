import { levelFromPercent, type BatteryDeviceSnapshot } from '../../core/battery-device';
import { type HelperRunner, HelperExecutionError } from './logitech-hidpp-helper';

export const HEADSETCONTROL_SOURCE = 'headsetcontrol';

export function headsetControlExecutable(value: string | undefined): string | undefined {
  const file = value?.trim();
  // Explicit drive path only; don't look in PATH, launch scripts or fetch an executable.
  return file && /^[a-z]:[\\/][^\0\r\n":*?<>|]+\.exe$/i.test(file) ? file : undefined;
}

export async function scanHeadsetControl(runner: HelperRunner, now = () => new Date()): Promise<BatteryDeviceSnapshot[]> {
  const { stdout } = await runner(['-b', '-o', 'json', '--timeout', '1500']);
  return parseHeadsetControlResult(stdout, now());
}

export function parseHeadsetControlResult(stdout: string, now: Date): BatteryDeviceSnapshot[] {
  let json: unknown;
  try { json = JSON.parse(stdout); }
  catch { throw new HelperExecutionError('HeadsetControl returned invalid JSON.'); }
  if (!isRecord(json) || !Array.isArray(json.devices) || json.devices.length > 64) {
    throw new HelperExecutionError('HeadsetControl returned an invalid device list.');
  }
  const devices = new Map<string, BatteryDeviceSnapshot>();
  const seen = new Set<string>();
  for (const device of json.devices as unknown[]) {
    if (!isRecord(device)) continue;
    const vid = hexId(device.id_vendor), pid = hexId(device.id_product);
    if (!vid || !pid) continue;
    const id = `${HEADSETCONTROL_SOURCE}:${vid}:${pid}`;
    // The CLI does not expose a reliable physical unit ID; don't guess which
    // headset to bind to when more than one has the same VID/PID.
    if (seen.has(id)) { devices.delete(id); continue; }
    seen.add(id);
    if (!isRecord(device.battery) || typeof device.device !== 'string' || !device.device.trim()) continue;
    const { level, status } = device.battery;
    if (status !== 'BATTERY_AVAILABLE' && status !== 'BATTERY_CHARGING') continue;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 100) continue;
    const charging = status === 'BATTERY_CHARGING';
    devices.set(id, {
      id, name: device.device.trim().slice(0, 128), vendor: '', model: pid, kind: 'other', transport: 'unknown',
      battery: { percent: level, level: levelFromPercent(level), charging, status: charging ? 'charging' : 'discharging' },
      availability: 'online', source: HEADSETCONTROL_SOURCE, beta: true, observedAt: now.toISOString()
    });
  }
  return [...devices.values()];
}

function hexId(value: unknown): string | undefined {
  if (typeof value === 'string' && /^(?:0x)?[a-f0-9]{1,4}$/i.test(value)) value = Number.parseInt(value, 16);
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffff
    ? value.toString(16).padStart(4, '0') : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
