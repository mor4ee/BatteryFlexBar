import assert from 'node:assert/strict';
import test from 'node:test';
import type { BatteryDeviceSnapshot } from '../../src/core/battery-device';
import { CHARGING_GLYPH } from '../../src/core/battery-icons';
import {
  batteryDisplayStatus,
  batteryTitle,
  initialBatteryMonitorState,
  recordBatteryFailure,
  recordBatterySuccess
} from '../../src/core/battery-state';

const snapshot: BatteryDeviceSnapshot = {
  id: 'logitech-hidpp:0xb042:a1b2c3d4',
  name: 'MX Master 4',
  vendor: 'Logitech',
  model: '0xB042',
  kind: 'mouse',
  transport: 'receiver',
  battery: {
    percent: 70,
    level: 'high',
    status: 'discharging',
    charging: false
  },
  availability: 'online',
  source: 'logitech-hidpp',
  observedAt: '2026-08-07T12:00:00.000Z'
};

test('retains the last measurement but hides its number when a read fails', () => {
  let state = recordBatterySuccess(initialBatteryMonitorState(), snapshot);
  state = recordBatteryFailure(state, new Error('mouse asleep'));
  assert.equal(state.snapshot?.availability, 'stale');
  assert.equal(state.snapshot?.battery.percent, 70);
  assert.equal(batteryDisplayStatus(state), 'unavailable');
  assert.equal(batteryTitle(state), '');
});

test('distinguishes loading from unavailable before the first snapshot', () => {
  assert.equal(batteryDisplayStatus(initialBatteryMonitorState()), 'loading');
  assert.equal(batteryTitle(initialBatteryMonitorState()), '--');
  const state = recordBatteryFailure(
    initialBatteryMonitorState(),
    new Error('device is offline')
  );

  assert.equal(batteryDisplayStatus(state), 'unavailable');
  assert.equal(batteryTitle(state), '');
});

test('marks the snapshot offline after three consecutive failures', () => {
  let state = recordBatterySuccess(initialBatteryMonitorState(), snapshot);
  state = recordBatteryFailure(state, 'failure 1');
  state = recordBatteryFailure(state, 'failure 2');
  state = recordBatteryFailure(state, 'failure 3');
  assert.equal(state.snapshot?.availability, 'offline');
  assert.equal(state.consecutiveFailures, 3);
  assert.equal(batteryDisplayStatus(state), 'unavailable');
  assert.equal(batteryTitle(state), '');
});

test('replaces the percent suffix with a lightning icon glyph while charging', () => {
  const charging = recordBatterySuccess(initialBatteryMonitorState(), {
    ...snapshot,
    battery: { ...snapshot.battery, charging: true, status: 'charging' }
  });
  assert.equal(batteryDisplayStatus(charging), 'charging');
  assert.equal(batteryTitle(charging), `70${CHARGING_GLYPH}`);
});

test('offline state overrides the last known charging status', () => {
  let state = recordBatterySuccess(initialBatteryMonitorState(), {
    ...snapshot,
    battery: { ...snapshot.battery, charging: true, status: 'charging' }
  });

  state = recordBatteryFailure(state, new Error('device switched off'));

  assert.equal(state.snapshot?.availability, 'stale');
  assert.equal(batteryDisplayStatus(state), 'unavailable');
  assert.equal(batteryTitle(state), '');

  state = recordBatterySuccess(state, snapshot);
  assert.equal(batteryDisplayStatus(state), 'online');
  assert.equal(batteryTitle(state), '70%');
});
