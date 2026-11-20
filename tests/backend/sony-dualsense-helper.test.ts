import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDualSenseHelperResult, SonyDualSenseHelperClient } from '../../src/backend/adapters/sony-dualsense-helper';

const device = {
  productId: '0x0CE6', unitId: 'aabbccddeeff', name: 'DualSense', model: 'dualsense',
  transport: 'bluetooth', availability: 'online',
  battery: { percentage: 85, charging: false, status: 'discharging' },
  protocol: { reportId: 49, reportLength: 78, statusByte: 8 }
};
const source = 'sony-dualsense-hid';
const id = 'sony-dualsense:0x0ce6:aabbccddeeff';
const payload = (...devices: unknown[]) => JSON.stringify({ source, devices });

test('DualSense Bluetooth snapshot uses the observed battery byte shape and marks quantization', async () => {
  const calls: string[][] = [];
  const client = new SonyDualSenseHelperClient({
    runner: async (args) => { calls.push([...args]); return { stdout: payload(device), stderr: '' }; },
    now: () => new Date('2026-09-12T16:00:00.000Z')
  });
  const [snapshot] = await client.scan();
  assert.deepEqual(calls, [['--dualsense', '--timeout-ms', '600', '--attempts', '2']]);
  assert.equal(snapshot.id, id);
  assert.equal(snapshot.kind, 'gamepad');
  assert.equal(snapshot.battery.percent, 85);
  assert.equal(snapshot.battery.charging, false);
  assert.equal(snapshot.battery.approximate, true);
  assert.equal(snapshot.battery.stepPercent, 10);
  assert.equal(snapshot.observedAt, '2026-09-12T16:00:00.000Z');
});

test('DualSense mode switch targets only explicitly permitted device identities', async () => {
  const calls: string[][] = [];
  const client = new SonyDualSenseHelperClient({
    runner: async (args) => { calls.push([...args]); return { stdout: payload(), stderr: '' }; }
  });
  await client.scan([id, id]);
  assert.deepEqual(calls[0].slice(5), ['--enable-bt-device', 'aabbccddeeff']);
  await client.scan();
  assert.ok(!calls[1].includes('--enable-bt-device'), 'permission must not leak to later passive scans');
  for (const invalid of ['all', 'logitech-hidpp:0xb042:test', '--enable-bt-device', 'sony-dualsense:0x0000:aabbccddeeff']) {
    assert.throws(() => client.scan([invalid]), /identity/);
  }
  assert.equal(calls.length, 2);
});

test('DualSense scans serialize and recover after a failed invocation', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const client = new SonyDualSenseHelperClient({ runner: async () => {
    calls += 1;
    if (calls === 1) { await gate; throw new Error('driver timeout'); }
    return { stdout: payload(device), stderr: '' };
  } });
  const first = client.scan();
  const second = client.scan([id]);
  const rejected = assert.rejects(first, /driver timeout/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await rejected;
  assert.equal((await second)[0].id, id);
  assert.equal(calls, 2);
});

test('DualSense Edge shares telemetry but retains distinct identity and model', () => {
  const edge = { ...device, productId: '0x0DF2', model: 'dualsense-edge', transport: 'usb',
    battery: { percentage: 100, status: 'full', charging: false } };
  const [snapshot] = parseDualSenseHelperResult(payload(edge));
  assert.equal(snapshot.id, 'sony-dualsense:0x0df2:aabbccddeeff');
  assert.equal(snapshot.name, 'DualSense Edge');
  assert.equal(snapshot.transport, 'usb');
  assert.equal(snapshot.battery.status, 'full');
  assert.equal(snapshot.battery.charging, false);
});

test('DualSense simple mode and per-device failures remain selectable without fabricated percentages', () => {
  const simple = { ...device, availability: 'unsupported', diagnostic: 'bluetooth-simple-mode',
    battery: { percentage: null, charging: false, status: 'unknown' } };
  const brokenEdge = { ...simple, productId: '0x0DF2', model: 'dualsense-edge',
    availability: 'error', diagnostic: 'charging-error', battery: { ...simple.battery, status: 'error' } };
  const states = parseDualSenseHelperResult(payload(simple, brokenEdge));
  assert.equal(states.length, 2);
  assert.equal(states[0].availability, 'unsupported');
  assert.equal(states[0].battery.percent, null);
  assert.equal(states[0].battery.level, 'unknown');
  assert.equal(states[0].diagnostic, 'bluetooth-simple-mode');
  assert.equal(states[1].availability, 'error');
  assert.deepEqual(parseDualSenseHelperResult(payload()), []);
});

test('DualSense USB/Bluetooth duplicates prefer working telemetry and do not merge distinct pads', () => {
  const usb = { ...device, transport: 'usb', battery: { percentage: 85, charging: true, status: 'charging' } };
  const failed = { ...usb, availability: 'error', battery: { percentage: null, charging: false, status: 'unknown' } };
  for (const duplicates of [[device, usb], [usb, device]]) {
    const [snapshot] = parseDualSenseHelperResult(payload(...duplicates));
    assert.equal(snapshot.transport, 'usb');
    assert.equal(snapshot.battery.charging, true);
  }
  assert.equal(parseDualSenseHelperResult(payload(device, failed))[0].availability, 'online');
  assert.equal(parseDualSenseHelperResult(payload(device, { ...device, unitId: '112233445566' })).length, 2);
});

test('DualSense adapter rejects malformed protocol results and inconsistent battery states', () => {
  for (const invalid of [
    'invalid', '{}', payload(null), payload({ ...device, productId: '0x9999' }),
    payload({ ...device, model: 'dualsense-edge' }), payload({ ...device, unitId: '' }),
    payload({ ...device, transport: 'unknown' }), JSON.stringify({ source: 'other', devices: [device] }),
    ...[-1, 101, null, '85', 85.5].map((percentage) => payload({ ...device, battery: { ...device.battery, percentage } })),
    payload({ ...device, battery: { percentage: 85, charging: true, status: 'full' } }),
    payload({ ...device, availability: 'unsupported' }),
    payload({ ...device, battery: { percentage: 85, charging: 'false', status: 'discharging' } })
  ]) assert.throws(() => parseDualSenseHelperResult(invalid), /DualSense helper/);
});
