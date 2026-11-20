import assert from 'node:assert/strict';
import test from 'node:test';
import { headsetControlExecutable, parseHeadsetControlResult, scanHeadsetControl } from '../../src/backend/adapters/headsetcontrol';

const now = new Date('2026-11-20T12:00:00Z');
const row = {
  device: 'Corsair VOID Pro', id_vendor: '0x1B1C', id_product: '0x1B27',
  battery: { status: 'BATTERY_AVAILABLE', level: 0 }
};
const stdout = (devices: unknown[]) => JSON.stringify({ name: 'HeadsetControl', api_version: '1.5', devices });

test('HeadsetControl is explicitly enabled with a local EXE path', () => {
  assert.equal(headsetControlExecutable('D:/Utilities/HeadsetControl/headsetcontrol.exe'), 'D:/Utilities/HeadsetControl/headsetcontrol.exe');
  for (const invalid of [undefined, 'headsetcontrol.exe', '//server/battery.exe', 'C:/test.cmd', 'C:/test.exe --flag']) {
    assert.equal(headsetControlExecutable(invalid), undefined);
  }
});

test('only the battery CLI command is run and valid charging/zero values are preserved', async () => {
  const [first, second] = await scanHeadsetControl(async (args) => {
    assert.deepEqual(args, ['-b', '-o', 'json', '--timeout', '1500']);
    return { stderr: '', stdout: stdout([row, { ...row, id_product: 0x1B30, battery: { status: 'BATTERY_CHARGING', level: 52 } }]) };
  }, () => now);
  assert.equal(first.id, 'headsetcontrol:1b1c:1b27');
  assert.equal(first.battery.percent, 0);
  assert.equal(second.battery.charging, true);
  assert.equal(second.beta, true);
});

test('unknown percentages, offline headsets and ambiguous identity never become valid readings', () => {
  assert.deepEqual(parseHeadsetControlResult(stdout([row, row]), now), []);
  for (const battery of [{ status: 'BATTERY_UNAVAILABLE', level: 75 }, { status: 'BATTERY_CHARGING', level: -1 },
    { status: 'BATTERY_AVAILABLE', level: 101 }]) {
    assert.deepEqual(parseHeadsetControlResult(stdout([{ ...row, battery }]), now), []);
  }
  assert.throws(() => parseHeadsetControlResult('not JSON', now), /invalid JSON/);
});
