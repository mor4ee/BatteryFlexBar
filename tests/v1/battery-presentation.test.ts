import assert from 'node:assert/strict';
import test from 'node:test';
import type { BatteryDeviceSnapshot } from '../../src/core/battery-device';
import { CHARGING_GLYPH, STATUS_ICON_FONT } from '../../src/core/battery-icons';
import { initialBatteryMonitorState, recordBatterySuccess } from '../../src/core/battery-state';
import { batteryDrawKey } from '../../src/v1/battery-presentation';
import { chargingTitlePosition } from '../../src/v1/charging-title-layout';
import type { V1BatteryKey } from '../../src/v1/battery-runtime';

const snapshot: BatteryDeviceSnapshot = {
  id: 'test', name: 'Test mouse', vendor: 'Logitech', model: 'test',
  kind: 'mouse', transport: 'receiver', availability: 'online', source: 'test',
  observedAt: '2026-09-12T12:00:00.000Z',
  battery: { percent: 70, level: 'high', status: 'charging', charging: true }
};

test('charging replaces percent with a lightning glyph and preserves every other Foreground setting', () => {
  const key: V1BatteryKey = {
    uid: 1, cid: 'com.mor4ee.battery.level', title: 'original',
    style: {
      icon: 'mdi mdi-mouse', showIcon: true, showTitle: true, showEmoji: true,
      iconPos: { X: 20, Y: 50 }, titlePos: { X: 65, Y: 47 },
      iconSize: 22, iconRotate: 20, titleRotate: 35, font: 'Digital-7', fontSize: 28,
      fontWeight: 'bold', fontStyle: 'italic', fontStretch: 'condensed', titleAlign: 'right',
      fgColor: '#00aaff', foregroundOutline: true, width: 120
    }
  };
  const original = structuredClone(key);
  const state = recordBatterySuccess(initialBatteryMonitorState(), snapshot);
  const draw = batteryDrawKey(key, state);

  assert.equal(draw.title, `70${CHARGING_GLYPH}`);
  assert.ok(!draw.title.includes('%') && !draw.title.includes('+'));
  assert.deepEqual(draw.style, { ...original.style, font: `Digital-7, "${STATUS_ICON_FONT}"` });
  assert.deepEqual(key, original);
});

test('charging preserves custom PNG icons and background images', () => {
  const key: V1BatteryKey = {
    uid: 1, cid: 'com.mor4ee.battery.level',
    style: {
      icon: 'data:image/png;base64,dXNlci1pY29u', showIcon: true,
      image: 'data:image/png;base64,dXNlci1iYWNrZ3JvdW5k', showImage: true,
      showTitle: true, showEmoji: false, emoji: '🐁',
      bgColor: '#102030', fgColor: '#ff980080', borderColor: '#abcdef',
      borderStyle: 'double', borderWidth: 2,
      iconSize: 38, iconPos: { X: 15, Y: 44 }, iconRotate: 73,
      titlePos: { X: 63, Y: 45 }, titleRotate: 90,
      font: 'Consolas', fontSize: 31, width: 180
    }
  };
  const original = structuredClone(key);
  const state = recordBatterySuccess(initialBatteryMonitorState(), snapshot);
  const draw = batteryDrawKey(key, state);

  assert.equal(draw.title, `70${CHARGING_GLYPH}`);
  assert.deepEqual(draw.style, {
    ...original.style, font: `Consolas, "${STATUS_ICON_FONT}"`,
    titlePos: chargingTitlePosition(original.style!, '70')
  });
  assert.deepEqual(key, original);
});

test('charging preserves hidden icons and text geometry without cumulative drift', () => {
  for (const width of [60, 90, 120, 180]) {
    for (const percent of [0, 45, 100]) {
      const key: V1BatteryKey = {
        uid: 1, cid: 'com.mor4ee.battery.level',
        style: {
          width, icon: 'mdi mdi-mouse', showIcon: false, showTitle: true, fontSize: 28,
          iconSize: 25, iconPos: { X: 20, Y: 51 }, iconRotate: 12,
          fgColor: '#ff9800', font: 'Consolas', titlePos: { X: 50, Y: 48 }
        }
      };
      const original = structuredClone(key);
      const state = recordBatterySuccess(initialBatteryMonitorState(), {
        ...snapshot, battery: { ...snapshot.battery, percent }
      });
      const firstDraw = batteryDrawKey(key, state);
      assert.deepEqual(firstDraw.style, {
        ...original.style, font: `Consolas, "${STATUS_ICON_FONT}"`,
        titlePos: chargingTitlePosition(original.style!, String(percent))
      });
      assert.equal(firstDraw.title, `${percent}${CHARGING_GLYPH}`);
      for (let count = 0; count < 5; count += 1) {
        assert.deepEqual(batteryDrawKey(key, state), firstDraw);
      }
      assert.deepEqual(key, original);

      const onlineState = recordBatterySuccess(state, {
        ...snapshot,
        battery: { ...snapshot.battery, percent, charging: false, status: 'discharging' }
      });
      assert.deepEqual(batteryDrawKey(key, onlineState).style, original.style);
    }
  }
});

test('charging supplies an icon-font fallback for default or missing title fonts', () => {
  for (const font of [undefined, '', '   ']) {
    const key: V1BatteryKey = {
      uid: 1, cid: 'com.mor4ee.battery.level', style: { font, showTitle: false }
    };
    const original = structuredClone(key);
    const state = recordBatterySuccess(initialBatteryMonitorState(), snapshot);
    const draw = batteryDrawKey(key, state);

    assert.equal(draw.style?.font, `sans-serif, "${STATUS_ICON_FONT}"`);
    assert.equal(draw.style?.showTitle, false);
    assert.deepEqual(key, original);
  }

  const key: V1BatteryKey = { uid: 1, cid: 'com.mor4ee.battery.level' };
  const state = recordBatterySuccess(initialBatteryMonitorState(), snapshot);
  assert.deepEqual(batteryDrawKey(key, state).style, { font: `sans-serif, "${STATUS_ICON_FONT}"` });
  assert.equal(key.style, undefined);
});
