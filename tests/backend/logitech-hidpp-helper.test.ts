import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HelperExecutionError,
  isLogitechDeviceUnavailableError,
  LogitechHidppHelperClient,
  type HelperRunner
} from '../../src/backend/adapters/logitech-hidpp-helper';

const helperPayload = {
  source: 'logitech-hidpp-2.0',
  transport: 'logi-bolt',
  receiver: { vendorId: '0x046D', productId: '0xC548' },
  device: {
    name: 'MX Master 4',
    modelId: '0xB042',
    slot: 2,
    unitId: 'a1b2c3d4',
    transportFlags: 2,
    modelIds: [45122, 0, 0],
    extendedModelId: 1
  },
  battery: {
    percentage: 70,
    level: 'full',
    levelCode: 8,
    status: 'discharging',
    statusCode: 0
  },
  protocol: {
    featureId: '0x1004',
    featureIndex: 9,
    featureVersion: 5,
    rawResponse: '11 02 09 1D 46 08 00'
  }
};

const g305Payload = {
  ...helperPayload,
  transport: 'lightspeed',
  receiver: { vendorId: '0x046D', productId: '0xC53F' },
  device: {
    ...helperPayload.device,
    name: 'G305 Lightspeed Wireless Gaming Mouse',
    modelId: '0x4074',
    slot: 1,
    unitId: '10203040',
    transportFlags: 4,
    modelIds: [16500, 0, 0],
    extendedModelId: 0
  },
  battery: {
    percentage: 90,
    level: 'unknown',
    levelCode: 0,
    status: 'discharging',
    statusCode: 0,
    nextLevel: 50
  },
  protocol: {
    featureId: '0x1000',
    featureIndex: 5,
    featureVersion: 0,
    rawResponse: '11 01 05 0D 5A 32 00'
  }
};

test('G502 keeps the hardware identity and marks voltage-derived charge as an estimate', async () => {
  const client = new LogitechHidppHelperClient({
    runner: async () => ({
      stdout: JSON.stringify({
        ...g305Payload,
        device: { ...g305Payload.device, name: 'G502 LIGHTSPEED Wireless Gaming Mouse', modelId: '0x407F' },
        protocol: { ...g305Payload.protocol, featureId: '0x1001' },
        battery: { ...g305Payload.battery, status: 'not-charging' }
      }),
      stderr: ''
    }),
    initialSlot: 1
  });
  const mouse = await client.read();
  assert.equal(mouse.id, 'logitech-hidpp:0x407f:10203040');
  assert.equal(mouse.battery.charging, false);
  assert.equal(mouse.battery.approximate, true);
  assert.equal(mouse.beta, true);
});

test('normalizes the helper result without treating HID++ level full as 100%', async () => {
  const runner: HelperRunner = async () => ({
    stdout: JSON.stringify(helperPayload),
    stderr: ''
  });
  const client = new LogitechHidppHelperClient({
    runner,
    now: () => new Date('2026-08-07T12:00:00.000Z')
  });

  const snapshot = await client.read();

  assert.equal(snapshot.id, 'logitech-hidpp:0xb042:a1b2c3d4');
  assert.equal(snapshot.battery.percent, 70);
  assert.equal(snapshot.battery.level, 'high');
  assert.equal(snapshot.battery.status, 'discharging');
  assert.equal(snapshot.battery.charging, false);
  assert.equal(snapshot.observedAt, '2026-08-07T12:00:00.000Z');
});

test('caches the discovered slot for subsequent reads', async () => {
  const calls: string[][] = [];
  const runner: HelperRunner = async (args) => {
    calls.push([...args]);
    return { stdout: JSON.stringify(helperPayload), stderr: '' };
  };
  const client = new LogitechHidppHelperClient({ runner });

  await client.read();
  await client.read();

  assert.deepEqual(calls, [[], ['--slot', '2']]);
});

test('passes a device profile to the helper and preserves the existing G305 ID', async () => {
  const calls: string[][] = [];
  const runner: HelperRunner = async (args) => {
    calls.push([...args]);
    return { stdout: JSON.stringify(g305Payload), stderr: '' };
  };
  const client = new LogitechHidppHelperClient({
    runner,
    helperArguments: [
      '--receiver-pid',
      '0xC53F',
      '--model-id',
      '0x4074',
      '--battery-feature',
      '0x1000'
    ],
    initialSlot: 1
  });

  const snapshot = await client.read();

  assert.deepEqual(calls, [[
    '--receiver-pid',
    '0xC53F',
    '--model-id',
    '0x4074',
    '--battery-feature',
    '0x1000',
    '--slot',
    '1'
  ]]);
  assert.equal(snapshot.id, 'logitech-ghub:g305:270544960');
  assert.equal(snapshot.vendor, 'Logitech G');
  assert.equal(snapshot.kind, 'mouse');
  assert.equal(snapshot.source, 'logitech-hidpp-2.0');
  assert.equal(snapshot.battery.percent, 90);
});

test('restores a persisted slot before the first read', async () => {
  const calls: string[][] = [];
  const runner: HelperRunner = async (args) => {
    calls.push([...args]);
    return { stdout: JSON.stringify(helperPayload), stderr: '' };
  };
  const client = new LogitechHidppHelperClient({ runner, initialSlot: 2 });

  await client.read();

  assert.deepEqual(calls, [['--slot', '2']]);
});

test('clears a failed cached slot and retries discovery', async () => {
  const calls: string[][] = [];
  const runner: HelperRunner = async (args) => {
    calls.push([...args]);
    if (calls.length === 2) {
      throw new HelperExecutionError('sleeping', 3);
    }
    return { stdout: JSON.stringify(helperPayload), stderr: '' };
  };
  const client = new LogitechHidppHelperClient({ runner });

  await client.read();
  const snapshot = await client.read();

  assert.equal(snapshot.battery.percent, 70);
  assert.deepEqual(calls, [[], ['--slot', '2'], []]);
});

test('does not rediscover a fixed receiver slot after an offline response', async () => {
  const calls: string[][] = [];
  const client = new LogitechHidppHelperClient({
    runner: async (args) => {
      calls.push([...args]);
      throw new HelperExecutionError(
        'Model 0x4074 was not found on Logitech receiver 0xC53F.',
        3
      );
    },
    initialSlot: 1,
    rediscoverOnFailure: false
  });

  await assert.rejects(() => client.read(), /Model 0x4074 was not found/);
  assert.deepEqual(calls, [['--slot', '1']]);
});

test('recognizes an offline HID++ device without invoking a stale fallback', () => {
  assert.equal(
    isLogitechDeviceUnavailableError(
      new HelperExecutionError(
        'Model 0x4074 was not found on Logitech receiver 0xC53F.'
      ),
      '0x4074'
    ),
    true
  );
  assert.equal(
    isLogitechDeviceUnavailableError(
      new HelperExecutionError('HidSharp.dll could not be loaded.'),
      '0x4074'
    ),
    false
  );
});

test('rejects malformed JSON and out-of-range percentages', async () => {
  const invalidJson = new LogitechHidppHelperClient({
    runner: async () => ({ stdout: 'not-json', stderr: '' })
  });
  await assert.rejects(() => invalidJson.read(), /invalid JSON/);

  const invalidPercentage = structuredClone(helperPayload);
  invalidPercentage.battery.percentage = 101;
  const invalidValue = new LogitechHidppHelperClient({
    runner: async () => ({ stdout: JSON.stringify(invalidPercentage), stderr: '' })
  });
  await assert.rejects(() => invalidValue.read(), /integer from 0 to 100/);
});
