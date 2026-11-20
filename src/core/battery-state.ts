import type { BatteryDeviceSnapshot } from './battery-device';
import { CHARGING_GLYPH } from './battery-icons';

export type BatteryMonitorState = {
  snapshot?: BatteryDeviceSnapshot;
  consecutiveFailures: number;
  lastError?: string;
};

export function initialBatteryMonitorState(): BatteryMonitorState {
  return { consecutiveFailures: 0 };
}

export function recordBatterySuccess(
  state: BatteryMonitorState,
  snapshot: BatteryDeviceSnapshot
): BatteryMonitorState {
  return {
    // A successful scan can discover a controller without usable telemetry
    // (simple Bluetooth mode or a battery fault). Preserve that distinction.
    snapshot: { ...snapshot },
    consecutiveFailures: 0
  };
}

export function recordBatteryFailure(
  state: BatteryMonitorState,
  error: unknown
): BatteryMonitorState {
  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    snapshot: state.snapshot
      ? {
          ...state.snapshot,
          availability: consecutiveFailures >= 3 ? 'offline' : 'stale'
        }
      : undefined,
    consecutiveFailures,
    lastError: error instanceof Error ? error.message : String(error)
  };
}

export function batteryTitle(state: BatteryMonitorState): string {
  const status = batteryDisplayStatus(state);
  if (status === 'unavailable') return '';
  const label = state.snapshot && discreteBatteryTitle(state.snapshot);
  if (label) return label;
  if (status === 'charging') return `${state.snapshot!.battery.percent}${CHARGING_GLYPH}`;
  return state.snapshot ? `${state.snapshot.battery.percent}%` : '--';
}

function discreteBatteryTitle(snapshot: BatteryDeviceSnapshot): string | undefined {
  if (snapshot.battery.percent !== null || snapshot.source !== 'xbox') return;
  switch (snapshot.battery.level) {
    case 'critical': return 'EMPTY';
    case 'low': return 'LOW';
    case 'medium': return 'MID';
    case 'full': return 'FULL';
  }
}

export type BatteryDisplayStatus = 'loading' | 'online' | 'charging' | 'unavailable';

export function batteryDisplayStatus(state: BatteryMonitorState): BatteryDisplayStatus {
  if (!state.snapshot) {
    return state.consecutiveFailures > 0 || state.lastError !== undefined ? 'unavailable' : 'loading';
  }
  if (state.snapshot.availability !== 'online') return 'unavailable';
  if (state.snapshot.battery.percent === null) return discreteBatteryTitle(state.snapshot) ? 'online' : 'unavailable';
  return state.snapshot.battery.charging ? 'charging' : 'online';
}
