import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPX_MOUSE_SOURCE, SONIX_KEYBOARD_SOURCE,
  parseWindowsBluetoothResult, scanCommonHidBattery, scanExtraBetaBattery, scanStandardHid, scanWindowsBluetooth
} from '../../src/backend/adapters/system-battery';
import { batteryDisplayStatus, batteryTitle, initialBatteryMonitorState, recordBatteryFailure } from '../../src/core/battery-state';

const first = { containerId: '12345678-1234-5678-90AB-1234567890AB', name: 'Клавиатура', percentage: 0 };
const second = { ...first, containerId: '12345678-1234-5678-90AB-1234567890AC', percentage: 100 };
const payload = (devices: unknown[]) => JSON.stringify({ source: 'windows-bluetooth', devices });
const now = new Date('2026-11-20T12:00:00Z');

test('scans the Windows source with distinct identities for devices of the same name', async () => {
  const devices = await scanWindowsBluetooth(async (args) => {
    assert.deepEqual(args, ['--windows-bluetooth']);
    return { stdout: payload([first, second]), stderr: '' };
  }, () => now);
  assert.equal(devices[0].id, 'windows-bluetooth:12345678-1234-5678-90ab-1234567890ab');
  assert.notEqual(devices[0].id, devices[1].id);
  assert.deepEqual(devices.map((device) => device.battery.percent), [0, 100]);
  assert.equal(devices[0].name, first.name);
  assert.equal(devices[0].observedAt, now.toISOString());
  assert.equal(devices[0].beta, true);
  assert.equal(devices[0].battery.status, 'unknown');
  assert.equal(devices[0].battery.charging, false);
  assert.deepEqual(parseWindowsBluetoothResult(payload([]), now), []);
});

test('rejects malformed Windows readings and repeated containers', () => {
  for (const devices of [
    [first, { ...first, containerId: first.containerId.toLowerCase() }],
    [{ ...first, containerId: '00000000-0000-0000-0000-000000000000' }],
    [{ ...first, percentage: 101 }],
    [{ ...first, percentage: 12.5 }],
    [{ ...first, percentage: '0' }]
  ]) {
    assert.throws(() => parseWindowsBluetoothResult(payload(devices), now), /Windows Bluetooth helper/);
  }
});

test('a standard HID scan has its own source, identity and USB transport', async () => {
  const [device] = await scanStandardHid(async (args) => {
    assert.deepEqual(args, ['--standard-hid']);
    return { stdout: JSON.stringify({ source: 'standard-hid', devices: [first] }), stderr: '' };
  }, () => now);
  assert.equal(device.id, 'standard-hid:12345678-1234-5678-90ab-1234567890ab');
  assert.equal(device.transport, 'usb');
  assert.equal(device.beta, true);
  assert.equal(device.battery.percent, 0);
  await assert.rejects(() => scanStandardHid(async () => ({ stdout: payload([first]), stderr: '' })),
    /invalid device list/);
});

test('CompX preserves real zero, charging and distinct physical container IDs', async () => {
  const [mouse, otherMouse] = await scanCommonHidBattery(async (args) => {
    assert.deepEqual(args, ['--compx-mouse']);
    const devices = [
      { ...first, name: 'VXE Dragonfly R1 Pro Max', transport: 'usb', charging: true },
      { ...second, name: 'VXE Dragonfly R1 Pro Max', transport: 'receiver', charging: false }
    ];
    return { stdout: JSON.stringify({ source: COMPX_MOUSE_SOURCE, devices }), stderr: '' };
  }, COMPX_MOUSE_SOURCE, () => now);
  assert.equal(mouse.id, 'compx-mouse:12345678-1234-5678-90ab-1234567890ab');
  assert.notEqual(mouse.id, otherMouse.id);
  assert.equal(mouse.kind, 'mouse');
  assert.equal(mouse.transport, 'usb');
  assert.equal(mouse.battery.percent, 0);
  assert.equal(mouse.battery.status, 'charging');
  assert.equal(otherMouse.battery.status, 'discharging');
  assert.equal(otherMouse.beta, true);
});

test('SONiX maps receiver charge with unknown charging status and rejects unsafe sentinels', async () => {
  const sample = { ...first, percentage: 73, name: 'AJAZZ AK820 MAX', transport: 'receiver', charging: null };
  const read = (device: object) => scanCommonHidBattery(async (args) => {
    assert.deepEqual(args, ['--sonix-keyboard']);
    return { stdout: JSON.stringify({ source: SONIX_KEYBOARD_SOURCE, devices: [device] }), stderr: '' };
  }, SONIX_KEYBOARD_SOURCE, () => now);
  const [keyboard] = await read(sample);
  assert.equal(keyboard.id, 'sonix-keyboard:12345678-1234-5678-90ab-1234567890ab');
  assert.equal(keyboard.kind, 'keyboard');
  assert.equal(keyboard.transport, 'receiver');
  assert.equal(keyboard.battery.percent, 73);
  assert.equal(keyboard.battery.status, 'unknown');
  assert.equal(keyboard.battery.charging, false);
  await assert.rejects(() => read({ ...sample, percentage: 0 }), /invalid wireless battery status/);
  await assert.rejects(() => read({ ...sample, charging: true }), /invalid wireless battery status/);
  await assert.rejects(() => read({ ...sample, transport: 'usb' }), /invalid wireless battery status/);
});

test('vendor adapters preserve distinct identities, USB/receiver routes and measured resolution', async () => {
  const read = (rows: unknown[]) => scanExtraBetaBattery(async (args) => {
    assert.deepEqual(args, ['--vendor-hid']);
    return { stdout: JSON.stringify({ source: 'vendor-hid', devices: rows }), stderr: '' };
  }, 'vendor-hid', () => now);
  const mouse = { ...first, name: 'Aerox 3', kind: 'mouse', transport: 'receiver',
    percentage: 85, stepPercent: 5, charging: false };
  const [one, two] = await read([mouse, { ...mouse, containerId: second.containerId, transport: 'usb', charging: true }]);
  assert.notEqual(one.id, two.id);
  assert.equal(one.beta, true);
  assert.equal(one.battery.approximate, true);
  assert.equal(one.battery.stepPercent, 5);
  assert.equal(two.battery.charging, true);
  await assert.rejects(() => read([{ ...mouse, percentage: 87 }]), /measurement resolution/);
  await assert.rejects(() => read([{ ...mouse, kind: 'gamepad' }]), /metadata/);
  await assert.rejects(() => read([mouse, mouse]), /duplicate container/);
});

test('Xbox distinguishes WinRT percentages from XInput levels and does not hold a stale level', async () => {
  const base = { ...first, name: 'Xbox gamepad', kind: 'gamepad', transport: 'unknown' };
  const read = (rows: unknown[]) => scanExtraBetaBattery(async (args) => {
    assert.deepEqual(args, ['--xbox']);
    return { stdout: JSON.stringify({ source: 'xbox', devices: rows }), stderr: '' };
  }, 'xbox', () => now);
  const raw = { ...base, percentage: null, charging: null, level: 'medium' };
  const [discrete, exact] = await read([raw, { ...base, containerId: second.containerId, percentage: 87, charging: false }]);
  const state = { ...initialBatteryMonitorState(), snapshot: discrete };
  assert.equal(discrete.battery.percent, null);
  assert.equal(discrete.battery.level, 'medium');
  assert.equal(batteryDisplayStatus(state), 'online');
  assert.equal(batteryTitle(state), 'MID');
  assert.equal(batteryTitle(recordBatteryFailure(state, new Error('left'))), '');
  assert.equal(batteryTitle({ ...state, snapshot: exact }), '87%');
  await assert.rejects(() => read([{ ...raw, level: 'high' }]), /invalid battery level/);
  await assert.rejects(() => read([{ ...raw, charging: true }]), /invalid battery level/);
});
