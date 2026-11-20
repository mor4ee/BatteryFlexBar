export type BatteryLevel = 'critical' | 'low' | 'medium' | 'high' | 'full';

export type BatteryChargeStatus =
  | 'charging'
  | 'discharging'
  | 'full'
  | 'error'
  | 'unknown';

export type BatteryDeviceSnapshot = {
  id: string;
  name: string;
  vendor: string;
  model: string;
  kind: 'mouse' | 'keyboard' | 'gamepad' | 'other';
  transport: 'ble' | 'bluetooth' | 'usb' | 'receiver' | 'unknown';
  battery: {
    percent: number | null;
    level: BatteryLevel | 'unknown';
    status: BatteryChargeStatus;
    charging: boolean;
    approximate?: boolean;
    stepPercent?: number;
  };
  availability: 'online' | 'offline' | 'stale' | 'unsupported' | 'error';
  source: string;
  beta?: boolean;
  observedAt: string;
  diagnostic?: string;
};

export function levelFromPercent(percent: number): BatteryLevel {
  if (percent <= 5) return 'critical';
  if (percent <= 20) return 'low';
  if (percent <= 50) return 'medium';
  if (percent < 100) return 'high';
  return 'full';
}
