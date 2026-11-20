import assert from 'node:assert/strict';
import test from 'node:test';
import type { BatteryDeviceSnapshot } from '../../src/core/battery-device';
import { CHARGING_GLYPH, STATUS_ICON_FONT } from '../../src/core/battery-icons';
import { UNAVAILABLE_GLYPH } from '../../src/core/battery-icons';
import { chargingTitlePosition } from '../../src/v1/charging-title-layout';
import {
  type BatterySourceReadResult,
  V1BatteryRuntime,
  type V1BatteryKey
} from '../../src/v1/battery-runtime';

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
  source: 'logitech-hidpp-2.0',
  observedAt: '2026-08-07T12:00:00.000Z'
};

function batteryKey(uid = 1): V1BatteryKey {
  return { uid, cid: 'com.mor4ee.battery.level', style: {} };
}

function sourceResult(
  ...snapshots: readonly BatteryDeviceSnapshot[]
): readonly BatterySourceReadResult[] {
  return [{ sourceId: 'test', snapshots }];
}

test('renders the current percentage for an alive battery key', async () => {
  const draws: Array<{ serialNumber: string; title?: string }> = [];
  const runtime = new V1BatteryRuntime({
    read: async () => sourceResult(snapshot),
    draw: (serialNumber, key) => {
      draws.push({ serialNumber, title: key.title });
    },
    pollIntervalMs: 60_000
  });

  runtime.handleAlive('FLEXBAR-1', [batteryKey()]);
  await runtime.refresh();

  assert.deepEqual(draws.at(-1), { serialNumber: 'FLEXBAR-1', title: '70%' });
  runtime.stop();
});

test('a Bluetooth beta reading can be selected without taking over an unbound key', async (t) => {
  const beta: BatteryDeviceSnapshot = { ...snapshot, id: 'windows-bluetooth:beta', name: 'AAA mouse',
    beta: true, source: 'windows-bluetooth', transport: 'bluetooth', battery: {
      percent: 0, level: 'critical', status: 'unknown', charging: false
    }
  };
  const unbound = batteryKey();
  const selected = { ...batteryKey(2), data: { deviceId: beta.id } };
  const draws = new Map<number, V1BatteryKey>();
  let bluetooth: BatteryDeviceSnapshot[] = [beta];
  const runtime = new V1BatteryRuntime({
    read: async () => [{ sourceId: beta.source, snapshots: bluetooth, expectedDeviceIds: [beta.id] },
      ...sourceResult(snapshot)],
    draw: (_serial, draw) => { draws.set(draw.uid, draw); }
  });
  t.after(() => runtime.stop());
  runtime.handleAlive('FLEXBAR-1', [unbound, selected]);
  await runtime.refresh();
  assert.deepEqual(runtime.currentSnapshots().map((device) => device.id), [snapshot.id, beta.id]);
  assert.equal(draws.get(1)?.title, '70%');
  assert.equal(draws.get(2)?.title, '0%');

  bluetooth = [];
  await runtime.refresh();
  assert.equal(draws.get(1)?.title, '70%');
  assert.equal(draws.get(2)?.title, UNAVAILABLE_GLYPH);

  bluetooth = [beta];
  await runtime.refresh();
  assert.equal(draws.get(2)?.title, '0%');
});

test('a saved controller absent on the first successful scan renders unavailable, not loading', async (t) => {
  const key = batteryKey();
  key.data = { deviceId: 'sony-dualsense:0x0ce6:aabbccddeeff' };
  const draws: V1BatteryKey[] = [];
  const runtime = new V1BatteryRuntime({
    read: async () => [{ sourceId: 'sony-dualsense', snapshots: [], expectedDeviceIds: [key.data!.deviceId!] }],
    draw: (_serial, draw) => { draws.push(draw); }
  });
  t.after(() => runtime.stop());
  runtime.handleAlive('FLEXBAR-1', [key]);
  await runtime.refresh();
  assert.equal(draws.at(-1)?.title, UNAVAILABLE_GLYPH);
  assert.equal(draws.at(-1)?.style?.icon, key.style?.icon);
});

test('unsupported controller telemetry stays unavailable while another device continues updating', async (t) => {
  const pad: BatteryDeviceSnapshot = { ...snapshot, id: 'sony-dualsense:0x0ce6:aabbccddeeff', kind: 'gamepad',
    availability: 'unsupported', diagnostic: 'bluetooth-simple-mode',
    battery: { percent: null, level: 'unknown', status: 'unknown', charging: false } };
  const padKey = batteryKey(2);
  padKey.data = { deviceId: pad.id, dualSenseEnhancedBluetooth: true };
  const mouseKey = batteryKey(1);
  mouseKey.data = { deviceId: snapshot.id };
  const draws = new Map<number, V1BatteryKey>();
  let current = pad;
  const runtime = new V1BatteryRuntime({
    read: async () => [{ sourceId: 'sony-dualsense', snapshots: [current] }, ...sourceResult(snapshot)],
    draw: (_serial, draw) => { draws.set(draw.uid, draw); }
  });
  t.after(() => runtime.stop());
  runtime.handleAlive('FLEXBAR-1', [mouseKey, padKey]);
  await runtime.refresh();
  assert.equal(draws.get(1)?.title, '70%');
  assert.equal(draws.get(2)?.title, UNAVAILABLE_GLYPH);
  assert.equal(draws.get(2)?.style?.icon, padKey.style?.icon);
  assert.equal(runtime.currentSnapshots().find((item) => item.id === pad.id)?.availability, 'unsupported');
  assert.deepEqual(runtime.selectedDeviceIds('dualSenseEnhancedBluetooth'), [pad.id]);
  current = { ...pad, availability: 'online', diagnostic: undefined,
    battery: { percent: 85, level: 'high', status: 'charging', charging: true } };
  await runtime.refresh();
  assert.equal(draws.get(2)?.title, `85${CHARGING_GLYPH}`);
  assert.equal(draws.get(1)?.title, '70%');
  runtime.handleDead('FLEXBAR-1', [padKey]);
  assert.deepEqual(runtime.selectedDeviceIds('dualSenseEnhancedBluetooth'), []);
});

test('coalesces concurrent refresh requests into one helper read', async () => {
  let reads = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = new V1BatteryRuntime({
    read: async () => {
      reads += 1;
      await gate;
      return sourceResult(snapshot);
    },
    draw: () => undefined
  });

  const first = runtime.refresh();
  const second = runtime.refresh();
  release?.();
  await Promise.all([first, second]);

  assert.equal(reads, 1);
  runtime.stop();
});

test('reports whether any battery keys are active', () => {
  const runtime = new V1BatteryRuntime({
    read: async () => sourceResult(snapshot),
    draw: () => undefined
  });
  const key = batteryKey();

  assert.equal(runtime.hasActiveKeys(), false);
  runtime.handleAlive('FLEXBAR-1', [key]);
  assert.equal(runtime.hasActiveKeys(), true);
  runtime.handleDead('FLEXBAR-1', [key]);
  assert.equal(runtime.hasActiveKeys(), false);
  runtime.stop();
});

test('contains asynchronous host draw failures', async () => {
  const warnings: string[] = [];
  const runtime = new V1BatteryRuntime({
    read: async () => sourceResult(snapshot),
    draw: async () => {
      throw new Error('draw acknowledgement timed out');
    },
    logger: {
      debug: () => undefined,
      warn: (message) => warnings.push(message)
    }
  });

  runtime.handleAlive('FLEXBAR-1', [batteryKey()]);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.ok(warnings.includes('FlexDesigner battery draw failed'));
  runtime.stop();
});

test('renders no data when the key selects another device', async () => {
  const draws: string[] = [];
  const key = batteryKey();
  key.data = { deviceId: 'another-device' };
  const runtime = new V1BatteryRuntime({
    read: async () => sourceResult(snapshot),
    draw: (_serialNumber, renderedKey) => {
      draws.push(renderedKey.title ?? '');
    }
  });

  runtime.handleAlive('FLEXBAR-1', [key]);
  await runtime.refresh();

  assert.equal(draws.at(-1), '--');
  runtime.stop();
});

test('preserves presentation settings owned by the Foreground tab', async () => {
  const key = batteryKey();
  key.style = {
    showIcon: true,
    showTitle: false,
    font: 'Consolas',
    fontSize: 37
  };
  const originalStyle = structuredClone(key.style);
  const runtime = new V1BatteryRuntime({
    read: async () => sourceResult(snapshot),
    draw: () => undefined
  });

  runtime.handleAlive('FLEXBAR-1', [key]);
  await runtime.refresh();

  assert.deepEqual(key.style, originalStyle);
  assert.equal(key.title, '70%');
  runtime.stop();
});

test('renders independently selected devices from multiple sources', async () => {
  const g305: BatteryDeviceSnapshot = {
    ...snapshot,
    id: 'logitech-ghub:g305:test-unit',
    name: 'G305 Lightspeed Wireless Gaming Mouse',
    vendor: 'Logitech G',
    model: 'g305',
    source: 'logitech-ghub-websocket',
    battery: { ...snapshot.battery, percent: 90 }
  };
  const titles = new Map<number, string>();
  const mxKey = batteryKey(1);
  mxKey.data = { deviceId: snapshot.id };
  const g305Key = batteryKey(2);
  g305Key.data = { deviceId: g305.id };
  const runtime = new V1BatteryRuntime({
    read: async () => [
      { sourceId: 'hidpp', snapshots: [snapshot] },
      { sourceId: 'ghub', snapshots: [g305] }
    ],
    draw: (_serialNumber, key) => {
      titles.set(key.uid, key.title ?? '');
    }
  });

  runtime.handleAlive('FLEXBAR-1', [mxKey, g305Key]);
  await runtime.refresh();

  assert.equal(titles.get(1), '70%');
  assert.equal(titles.get(2), '90%');
  assert.deepEqual(
    runtime.currentSnapshots().map(({ id }) => id),
    [g305.id, snapshot.id]
  );
  runtime.stop();
});

test('keeps one source fresh when another source fails', async () => {
  const g305: BatteryDeviceSnapshot = {
    ...snapshot,
    id: 'logitech-ghub:g305:test-unit',
    name: 'G305',
    source: 'logitech-ghub-websocket',
    battery: { ...snapshot.battery, percent: 90 }
  };
  let failHidpp = false;
  const runtime = new V1BatteryRuntime({
    read: async () => [
      failHidpp
        ? { sourceId: 'hidpp', error: new Error('receiver unavailable') }
        : { sourceId: 'hidpp', snapshots: [snapshot] },
      { sourceId: 'ghub', snapshots: [g305] }
    ],
    draw: () => undefined
  });

  await runtime.refresh();
  failHidpp = true;
  await runtime.refresh();

  const devices = new Map(runtime.currentSnapshots().map((item) => [item.id, item]));
  assert.equal(devices.get(snapshot.id)?.availability, 'stale');
  assert.equal(devices.get(g305.id)?.availability, 'online');
  assert.equal(devices.get(g305.id)?.battery.percent, 90);
  runtime.stop();
});

test('renders an offline title glyph without replacing the user icon on first read failure', async (t) => {
  const key = batteryKey();
  key.data = { deviceId: 'logitech-ghub:g305:test-unit' };
  const draws: V1BatteryKey[] = [];
  const runtime = new V1BatteryRuntime({
    read: async () => [{
      sourceId: 'ghub',
      error: new Error('device is offline'),
      expectedDeviceIds: ['logitech-ghub:g305:test-unit']
    }],
    draw: (_serialNumber, renderedKey) => {
      draws.push(renderedKey);
    }
  });
  t.after(() => runtime.stop());

  runtime.handleAlive('FLEXBAR-1', [key]);
  await runtime.refresh();

  assert.equal(draws.at(-1)?.title, UNAVAILABLE_GLYPH);
  assert.deepEqual(draws.at(-1)?.style, { ...key.style, font: `"${STATUS_ICON_FONT}"` });
});

test('restores Foreground settings after charging, stale and offline transitions', async (t) => {
  const key = batteryKey();
  key.data = { deviceId: snapshot.id };
  key.style = {
    icon: 'mdi mdi-mouse', showIcon: true, showTitle: true,
    emoji: 'mouse', showEmoji: true,
    fgColor: '#ff9800', bgColor: '#010203', font: 'Consolas', fontSize: 31,
    iconSize: 24, iconPos: { X: 16, Y: 48 }, iconRotate: 12,
    titlePos: { X: 63, Y: 48 }, titleRotate: 0, width: 180
  };
  const originalStyle = structuredClone(key.style);
  const draws: V1BatteryKey[] = [];
  let result: readonly BatterySourceReadResult[] = sourceResult({
    ...snapshot,
    battery: { ...snapshot.battery, charging: true, status: 'charging' }
  });
  const runtime = new V1BatteryRuntime({
    read: async () => result,
    draw: (_serialNumber, renderedKey) => { draws.push(renderedKey); }
  });
  t.after(() => runtime.stop());
  runtime.handleAlive('FLEXBAR-1', [key]);
  await runtime.refresh();

  const chargingDraw = draws.at(-1)!;
  assert.equal(chargingDraw.title, `70${CHARGING_GLYPH}`);
  assert.equal(chargingDraw.style?.icon, originalStyle.icon);
  assert.equal(chargingDraw.style?.showEmoji, true);
  const expectedChargingStyle: Record<string, unknown> = {
    ...originalStyle, font: `Consolas, "${STATUS_ICON_FONT}"`,
    titlePos: chargingTitlePosition(originalStyle, '70')
  };
  assert.deepEqual(chargingDraw.style, expectedChargingStyle);
  assert.notDeepEqual(chargingDraw.style?.titlePos, originalStyle.titlePos);
  assert.deepEqual(chargingDraw.style?.iconPos, originalStyle.iconPos);
  assert.equal(chargingDraw.style?.fgColor, originalStyle.fgColor);
  assert.notStrictEqual(chargingDraw.style, key.style);
  assert.deepEqual(key.style, originalStyle);

  result = [{ sourceId: 'test', error: new Error('mouse switched off') }];
  for (const availability of ['stale', 'stale', 'offline']) {
    await runtime.refresh();
    assert.equal(runtime.currentSnapshots()[0]?.availability, availability);
    const unavailableDraw = draws.at(-1)!;
    assert.equal(unavailableDraw.title, UNAVAILABLE_GLYPH);
    assert.deepEqual(unavailableDraw.style, { ...originalStyle, font: `"${STATUS_ICON_FONT}"` });
    assert.deepEqual(key.style, originalStyle);
  }

  result = sourceResult(snapshot);
  await runtime.refresh();
  assert.equal(draws.at(-1)?.title, '70%');
  assert.deepEqual(draws.at(-1)?.style, originalStyle);
  assert.deepEqual(key.style, originalStyle);
  assert.equal(chargingDraw.style?.icon, originalStyle.icon);
});
