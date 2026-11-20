import assert from 'node:assert/strict';
import test from 'node:test';
import { KeychronRfHelperClient } from '../../src/backend/adapters/keychron-rf-helper';
import type { HelperRunner } from '../../src/backend/adapters/logitech-hidpp-helper';

const payload = {
  source: 'keychron-rf-hid',
  transport: 'keychron-link-2.4ghz',
  receiver: { vendorId: '0x3434', productId: '0xD030' },
  device: { name: 'Keychron M6', model: 'M6' },
  battery: { percentage: 87, status: 'discharging', charging: false },
  protocol: {
    featureReportId: '0x51',
    inputReportId: '0x54',
    rawResponse: '54 E3 00 02 02 57 00'
  }
};

test('reads and normalizes a real Keychron M6 RF response', async () => {
  const calls: string[][] = [];
  const runner: HelperRunner = async (args) => {
    calls.push([...args]);
    return { stdout: JSON.stringify(payload), stderr: '' };
  };
  const client = new KeychronRfHelperClient({
    runner,
    now: () => new Date('2026-08-23T18:00:00.000Z')
  });

  const snapshot = await client.read();

  assert.deepEqual(calls, [[
    '--keychron-rf',
    '--receiver-pid',
    '0xD030',
    '--timeout-ms',
    '500',
    '--attempts',
    '2'
  ]]);
  assert.equal(snapshot.id, 'keychron-rf:m6:0x3434:0xd030');
  assert.equal(snapshot.name, 'Keychron M6');
  assert.equal(snapshot.vendor, 'Keychron');
  assert.equal(snapshot.kind, 'mouse');
  assert.equal(snapshot.battery.percent, 87);
  assert.equal(snapshot.battery.charging, false);
  assert.equal(snapshot.source, 'keychron-rf-hid');
  assert.equal(snapshot.beta, undefined);
});

test('binds beta Keychron mice by model and receiver while preserving the old M6 ID', async () => {
  for (const [receiverProductId, model] of [
    ['0xD030', 'M7'], ['0xD031', 'M6'], ['0xD038', 'M6 4K'], ['0xD028', 'Ultra-Link 8K (D049)']
  ]) {
    const client = new KeychronRfHelperClient({
      receiverProductId,
      runner: async (args) => {
        assert.equal(args[2], receiverProductId);
        const result = { ...payload, receiver: { ...payload.receiver, productId: receiverProductId },
          device: { model, name: `Keychron ${model}` } };
        return { stdout: JSON.stringify(result), stderr: '' };
      }
    });
    const device = await client.read();
    assert.equal(device.id, `keychron-rf:${model.toLowerCase()}:0x3434:${receiverProductId.toLowerCase()}`);
    assert.equal(device.beta, true);
  }
});

test('rejects a Keychron helper reading from a different receiver or an incompatible model', async () => {
  const client = new KeychronRfHelperClient({
    receiverProductId: '0xD031',
    runner: async () => ({ stdout: JSON.stringify(payload), stderr: '' })
  });
  await assert.rejects(() => client.read(), /different receiver/);
  const wrongModel = { ...payload, receiver: { ...payload.receiver, productId: '0xD038' } };
  const link4k = new KeychronRfHelperClient({
    receiverProductId: '0xD038',
    runner: async () => ({ stdout: JSON.stringify(wrongModel), stderr: '' })
  });
  await assert.rejects(() => link4k.read(), /identity or status/);
});

test('rejects malformed Keychron battery values', async () => {
  const invalid = structuredClone(payload);
  invalid.battery.percentage = 128;
  const client = new KeychronRfHelperClient({
    runner: async () => ({ stdout: JSON.stringify(invalid), stderr: '' })
  });

  await assert.rejects(() => client.read(), /integer from 0 to 100/);
});
