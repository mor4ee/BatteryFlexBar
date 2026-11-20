import assert from 'node:assert/strict';
import test from 'node:test';
import { LamzuParoHelperClient, LAMZU_PARO_ID } from '../../src/backend/adapters/lamzu-paro-helper';
import type { HelperRunner } from '../../src/backend/adapters/logitech-hidpp-helper';

const payload = {
  source: 'lamzu-paro-hid',
  transport: 'receiver',
  receiver: { vendorId: '0x37B0', productId: '0x000D' },
  device: { name: 'Lamzu Paro', model: 'Paro' },
  battery: { percentage: 92, status: 'discharging', charging: false }
};

test('reads a Lamzu Paro response from the 2.4 GHz receiver', async () => {
  const calls: string[][] = [];
  const runner: HelperRunner = async (args) => {
    calls.push([...args]);
    return { stdout: JSON.stringify(payload), stderr: '' };
  };
  const client = new LamzuParoHelperClient({
    runner, now: () => new Date('2026-09-24T16:00:00.000Z')
  });
  const snapshot = await client.read();

  assert.deepEqual(calls, [['--lamzu-paro', '--attempts', '2']]);
  assert.equal(snapshot.id, LAMZU_PARO_ID);
  assert.equal(snapshot.name, 'Lamzu Paro');
  assert.equal(snapshot.battery.percent, 92);
  assert.equal(snapshot.battery.charging, false);
  assert.equal(snapshot.transport, 'receiver');
});

test('rejects malformed Lamzu Paro identity, percentage, and charging state', async () => {
  for (const invalid of [
    { ...payload, receiver: { ...payload.receiver, productId: '0x0010' } },
    { ...payload, battery: { ...payload.battery, percentage: 128 } },
    { ...payload, battery: { ...payload.battery, charging: true } }
  ]) {
    const client = new LamzuParoHelperClient({
      runner: async () => ({ stdout: JSON.stringify(invalid), stderr: '' })
    });
    await assert.rejects(() => client.read(), /invalid/);
  }
});

test('keeps the same unit ID when Paro changes to USB and charging', async () => {
  const usb = {
    ...payload,
    transport: 'usb',
    receiver: { vendorId: '0x37B0', productId: '0x0007' },
    battery: { percentage: 100, status: 'charging', charging: true }
  };
  const client = new LamzuParoHelperClient({
    runner: async () => ({ stdout: JSON.stringify(usb), stderr: '' })
  });
  const snapshot = await client.read();
  assert.equal(snapshot.id, LAMZU_PARO_ID);
  assert.equal(snapshot.transport, 'usb');
  assert.equal(snapshot.battery.percent, 100);
  assert.equal(snapshot.battery.charging, true);
});

test('Aurora scan keeps the saved Paro ID and labels the alternate receiver and new models as beta', async () => {
  const paro = { vendorId: '37b0', productId: '000d', model: 'Paro',
    transport: 'receiver', percentage: 92, charging: false, beta: false };
  const inca = { ...paro, model: 'Inca', productId: '0010', beta: true };
  let entry = paro;
  const client = new LamzuParoHelperClient({
    runner: async (args) => {
      assert.deepEqual(args, ['--lamzu-aurora', '--attempts', '2']);
      return { stdout: JSON.stringify({ source: 'lamzu-aurora-hid', devices: [entry, inca] }), stderr: '' };
    }
  });
  let devices = await client.scan();
  assert.equal(devices[0].id, LAMZU_PARO_ID);
  assert.equal(devices[0].beta, undefined);
  assert.equal(devices[1].id, 'lamzu-aurora:37b0:inca');
  assert.equal(devices[1].beta, true);
  entry = { ...paro, productId: '000e', beta: true };
  devices = await client.scan();
  assert.equal(devices[0].id, LAMZU_PARO_ID);
  assert.equal(devices[0].beta, true);
  entry = { ...paro, productId: '0007', transport: 'receiver' };
  await assert.rejects(() => client.scan(), /invalid device route/);
});
