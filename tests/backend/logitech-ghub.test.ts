import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isActiveBatteryDevice,
  normalizeGHubBattery,
  parseBatteryState,
  parseDeviceList
} from '../../src/backend/adapters/logitech-ghub';

const deviceListPayload = {
  deviceInfos: [
    {
      id: 'dev00000000',
      state: 'ABSENT',
      deviceType: 'MOUSE',
      deviceModel: 'g305',
      displayName: 'G305',
      extendedDisplayName: 'G305 Lightspeed Wireless Gaming Mouse',
      deviceUnitId: 'old-unit',
      deviceSignature: 'MOUSE.g305.0.old-unit',
      displayConnectionType: 'LIGHTSPEED',
      capabilities: { hasBatteryStatus: true },
      activeInterfaces: []
    },
    {
      id: 'dev00000001',
      state: 'ACTIVE',
      deviceType: 'MOUSE',
      deviceModel: 'g305',
      displayName: 'G305',
      extendedDisplayName: 'G305 Lightspeed Wireless Gaming Mouse',
      deviceUnitId: 'test-unit',
      deviceSignature: 'MOUSE.g305.0.test-unit',
      displayConnectionType: 'LIGHTSPEED',
      capabilities: { hasBatteryStatus: true },
      activeInterfaces: [{ path: 'test-interface' }]
    }
  ]
};

test('keeps only the active G HUB record for a battery device', () => {
  const devices = parseDeviceList(deviceListPayload);

  assert.equal(devices.length, 2);
  assert.deepEqual(devices.filter(isActiveBatteryDevice).map(({ id }) => id), [
    'dev00000001'
  ]);
});

test('normalizes a real-shaped G305 battery response', () => {
  const device = parseDeviceList(deviceListPayload).filter(
    isActiveBatteryDevice
  )[0];
  const battery = parseBatteryState({
    deviceId: 'dev00000001',
    percentage: 90,
    charging: false,
    fullyCharged: false,
    chargingError: false,
    isBatteryRemoved: false
  });

  const snapshot = normalizeGHubBattery(
    device,
    battery,
    new Date('2026-08-23T12:00:00.000Z')
  );

  assert.equal(snapshot.id, 'logitech-ghub:g305:test-unit');
  assert.equal(snapshot.name, 'G305 Lightspeed Wireless Gaming Mouse');
  assert.equal(snapshot.vendor, 'Logitech G');
  assert.equal(snapshot.kind, 'mouse');
  assert.equal(snapshot.transport, 'receiver');
  assert.equal(snapshot.battery.percent, 90);
  assert.equal(snapshot.battery.status, 'discharging');
  assert.equal(snapshot.observedAt, '2026-08-23T12:00:00.000Z');
});

test('rejects malformed battery percentages', () => {
  assert.throws(
    () =>
      parseBatteryState({
        deviceId: 'dev00000001',
        percentage: 101
      }),
    /integer from 0 to 100/
  );
});

test('rejects a battery response for another device', () => {
  const device = parseDeviceList(deviceListPayload).filter(
    isActiveBatteryDevice
  )[0];
  const battery = parseBatteryState({
    deviceId: 'dev99999999',
    percentage: 90
  });

  assert.throws(
    () => normalizeGHubBattery(device, battery, new Date()),
    /another device/
  );
});
