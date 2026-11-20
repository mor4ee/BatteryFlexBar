import assert from 'node:assert/strict';
import test from 'node:test';
import { STATUS_ICON_FONT, UNAVAILABLE_GLYPH } from '../../src/core/battery-icons';
import { initialBatteryMonitorState, recordBatteryFailure, recordBatterySuccess } from '../../src/core/battery-state';
import { batteryDrawKey } from '../../src/v1/battery-presentation';
import type { V1BatteryKey } from '../../src/v1/battery-runtime';
import type { BatteryDeviceSnapshot } from '../../src/core/battery-device';

const snapshot: BatteryDeviceSnapshot = {
  id: 'test', name: 'Mouse', vendor: 'Test', model: 'test', kind: 'mouse',
  transport: 'receiver', availability: 'online', source: 'test',
  observedAt: '2026-09-13T12:00:00Z',
  battery: { percent: 45, level: 'medium', status: 'discharging', charging: false }
};

test('unavailable title preserves user icon, images, emoji and all geometry/style fields', () => {
  for (const icon of ['mdi mdi-mouse', 'data:image/png;base64,dGVzdA==']) {
    for (const showIcon of [true, false]) {
      const key: V1BatteryKey = {
        uid: 1, cid: 'com.mor4ee.battery.level', title: 'saved',
        style: {
          icon, showIcon, showEmoji: true, emoji: '🐁',
          showImage: true, image: 'data:image/png;base64,Ymc=',
          iconPos: { X: 18, Y: 40 }, iconSize: 21, iconRotate: 35,
          showTitle: true, font: 'Digital-7', fontSize: 33,
          titlePos: { X: 72, Y: 55 }, titleRotate: 12,
          fontWeight: 'bold', fontStyle: 'italic', fgColor: '#ffaa0080',
          bgColor: '#010203', foregroundOutline: true, borderWidth: 2, width: 110
        }
      };
      const saved = structuredClone(key);
      const state = recordBatteryFailure(recordBatterySuccess(initialBatteryMonitorState(), snapshot), new Error('off'));
      for (let repeat = 0; repeat < 3; repeat++) {
        const draw = batteryDrawKey(key, state);
        assert.equal(draw.title, UNAVAILABLE_GLYPH);
        assert.deepEqual(draw.style, { ...saved.style, font: `"${STATUS_ICON_FONT}"` });
        assert.deepEqual(key, saved);
      }
      assert.deepEqual(batteryDrawKey(key, recordBatterySuccess(state, snapshot)).style, saved.style);
      assert.equal(batteryDrawKey(key, recordBatterySuccess(state, snapshot)).title, '45%');
    }
  }
});

test('offline title respects hidden text and missing/default styles', () => {
  const state = recordBatteryFailure(initialBatteryMonitorState(), new Error('off'));
  for (const style of [undefined, {}, { showTitle: false, showIcon: false, font: '' }]) {
    const key: V1BatteryKey = { uid: 2, cid: 'com.mor4ee.battery.level', style };
    const saved = structuredClone(key);
    const draw = batteryDrawKey(key, state);
    assert.equal(draw.title, UNAVAILABLE_GLYPH);
    assert.deepEqual(draw.style, { ...style, font: `"${STATUS_ICON_FONT}"` });
    assert.deepEqual(key, saved);
  }
});

test('stale/offline/unsupported status replaces the whole title even after charging', () => {
  const key: V1BatteryKey = { uid: 3, cid: 'com.mor4ee.battery.level', style: { icon: 'mdi mdi-mouse', showTitle: true } };
  for (const availability of ['stale', 'offline', 'unsupported'] as const) {
    const state = recordBatterySuccess(initialBatteryMonitorState(), {
      ...snapshot, availability, battery: { ...snapshot.battery, charging: true, status: 'charging' }
    });
    assert.equal(batteryDrawKey(key, state).title, UNAVAILABLE_GLYPH);
    assert.equal(batteryDrawKey(key, state).style?.icon, key.style?.icon);
  }
  assert.equal(batteryDrawKey(key, initialBatteryMonitorState()).title, '--');
});
