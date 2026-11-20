import assert from 'node:assert/strict';
import test from 'node:test';
import { UNAVAILABLE_GLYPH } from '../../src/core/battery-icons';
import { BATTERY_CID, V1BatteryRuntime, type BatterySourceReadResult, type V1BatteryKey,
  type V1BatteryRuntimeOptions } from '../../src/v1/battery-runtime';

function key(uid = 8, width = 180): V1BatteryKey {
  return { uid, cid: BATTERY_CID, width, style: { width }, data: { deviceId: 'mouse-1' } };
}
function result(percent = 70): readonly BatterySourceReadResult[] {
  return [{ sourceId: 'fake', snapshots: [{
    id: 'mouse-1', name: 'Test mouse', vendor: 'Test', model: 'Test', kind: 'mouse',
    transport: 'receiver', battery: { percent, level: 'high', status: 'discharging', charging: false },
    availability: 'online', source: 'logitech-hidpp-2.0', observedAt: '2026-09-13T00:00:00.000Z'
  }] }];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(done => setImmediate(done));
function runtime(options: Partial<V1BatteryRuntimeOptions> = {}) {
  return new V1BatteryRuntime({ read: async () => result(), draw() {},
    schedule: callback => callback, cancelSchedule() {}, ...options });
}

test('disconnect/connect cannot revive old layout; fresh alive supplies a reindexed key', async t => {
  const frames: V1BatteryKey[] = [];
  let reads = 0;
  const subject = runtime({ read: async () => { reads++; return result(); },
    draw: (_panel, frame) => { frames.push(frame); } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key()]);
  await subject.refresh();
  frames.length = 0;
  subject.setDeviceConnected('A', false);
  subject.setDeviceConnected('A', true);
  assert.equal(subject.hasActiveKeys(), false);
  await tick();
  assert.equal(frames.length, 0);
  assert.equal(reads, 1);
  subject.handleAlive('A', [key(9, 120)]);
  await subject.refresh();
  assert.ok(frames.length > 0);
  assert.ok(frames.every(frame => frame.uid === 9 && frame.width === 120));
});

test('post-Upload alive recovers a disconnected panel without connected and replaces the stale charge', async t => {
  const frames: V1BatteryKey[] = [];
  let reads = 0;
  const subject = runtime({
    read: async () => ++reads === 1 ? result(98) : [{ sourceId: 'fake', snapshots: [] }],
    draw: (_panel, frame) => { frames.push(frame); }
  });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key(8)]);
  await subject.refresh();
  assert.equal(frames.at(-1)?.title, '98%');
  frames.length = 0;

  subject.setDeviceConnected('A', false);
  subject.setDeviceConnected('A', false);
  subject.handleData('A', key(8));
  assert.equal(reads, 1);
  assert.equal(frames.length, 0);
  subject.handleAlive('A', [key(9, 130), key(10, 130)]);
  await subject.refresh();
  assert.equal(subject.hasActiveKeys(), true);
  assert.equal(reads, 2);
  assert.ok(frames.every(frame => [9, 10].includes(frame.uid) && frame.width === 130));
  for (const uid of [9, 10]) {
    assert.equal(frames.filter(frame => frame.uid === uid).at(-1)?.title, UNAVAILABLE_GLYPH);
  }

  subject.handleData('A', key(8));
  assert.equal(reads, 2);
  subject.handleData('A', key(10, 999));
  await subject.refresh();
  assert.equal(reads, 3);
  assert.equal(frames.at(-1)?.width, 130);
});

test('after disconnect, empty or invalid alive payloads cannot resume Battery', async t => {
  let reads = 0;
  const frames: V1BatteryKey[] = [];
  const subject = runtime({ read: async () => { reads++; return result(); },
    draw: (_panel, frame) => { frames.push(frame); } });
  t.after(() => subject.stop());
  subject.setDeviceConnected('A', false);
  subject.handleAlive('A', []);
  subject.handleAlive('A', [{ ...key(), cid: 'another.plugin.key' }, key(9, 0), key(-1), key(10, NaN)]);
  subject.handleData('A', key());
  await tick();
  assert.equal(subject.hasActiveKeys(), false);
  assert.equal(reads, 0);
  assert.equal(frames.length, 0);

  subject.handleAlive('A', [key(9, 0), { ...key(11), width: undefined }]);
  await subject.refresh();
  assert.equal(reads, 1);
  assert.ok(frames.length > 0 && frames.every(frame => frame.uid === 11 && frame.style?.width === 180));
});

test('obsolete helper read is discarded; new reads wait without overlapping hardware work', async t => {
  const old = deferred<readonly BatterySourceReadResult[]>();
  const fresh = deferred<readonly BatterySourceReadResult[]>();
  let reads = 0;
  const frames: V1BatteryKey[] = [];
  const subject = runtime({ read: () => ++reads === 1 ? old.promise : fresh.promise,
    draw: (_panel, frame) => { frames.push(frame); } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key()]);
  const first = subject.refresh();
  subject.setDeviceConnected('A', false);
  subject.handleAlive('A', [key(9, 120)]);
  const second = subject.refresh();
  const third = subject.refresh();
  assert.equal(reads, 1);
  old.resolve(result(10));
  await first;
  await tick();
  assert.equal(reads, 2);
  assert.deepEqual(subject.currentSnapshots(), []);
  assert.ok(!frames.some(frame => frame.title === '10%'));
  fresh.resolve(result(80));
  await Promise.all([second, third]);
  assert.equal(frames.at(-1)?.uid, 9);
  assert.equal(frames.at(-1)?.title, '80%');
});

test('one panel draw lane survives UID replacement and does not block a different panel', async t => {
  const gate = deferred<void>();
  const frames: Array<{ panel: string; frame: V1BatteryKey }> = [];
  const subject = runtime({ draw: async (panel, frame) => {
    frames.push({ panel, frame });
    if (panel === 'A' && frame.uid === 8) await gate.promise;
  } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key()]);
  await subject.refresh();
  subject.setDeviceConnected('A', false);
  subject.handleAlive('A', [key(9, 120)]);
  await subject.refresh();
  assert.equal(frames.length, 1);
  subject.handleAlive('B', [key(3, 100)]);
  await subject.refresh();
  assert.ok(frames.some(item => item.panel === 'B'));
  gate.resolve();
  await tick();
  assert.deepEqual(frames.filter(item => item.panel === 'A').map(item => item.frame.width), [180, 120]);
});

test('same-UID replacement drops waiting frames; snapshot includes nested geometry', async t => {
  const gate = deferred<void>();
  const frames: V1BatteryKey[] = [];
  const subject = runtime({ draw: async (_panel, frame) => {
    frames.push(frame);
    if (frames.length === 1) await gate.promise;
  } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key()]);
  await subject.refresh();
  const replacement = key(8, 120);
  subject.handleAlive('A', [replacement]);
  await subject.refresh();
  replacement.style!.width = 999; // Must not mutate already queued/submitted snapshots.
  gate.resolve();
  await tick();
  assert.deepEqual(frames.map(frame => frame.style?.width), [180, 120]);
});

test('dead and replacement with another CID remove queued neighbor images', async t => {
  const gate = deferred<void>();
  const frames: V1BatteryKey[] = [];
  const subject = runtime({ draw: async (_panel, frame) => {
    frames.push(frame);
    if (frames.length === 1) await gate.promise;
  } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key(8), key(9)]);
  await subject.refresh();
  subject.handleAlive('A', [{ ...key(9), cid: 'another.plugin.key' }]);
  subject.handleDead('A', [key(8)]);
  gate.resolve();
  await tick();
  assert.deepEqual(frames.map(frame => frame.uid), [8]);
});

test('panel disconnect leaves other consumers and their shared read working', async t => {
  const gate = deferred<readonly BatterySourceReadResult[]>();
  const panels: string[] = [];
  const subject = runtime({ read: () => gate.promise, draw: panel => { panels.push(panel); } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key()]);
  subject.handleAlive('B', [key()]);
  const pending = subject.refresh();
  subject.setDeviceConnected('A', false);
  panels.length = 0;
  gate.resolve(result());
  await pending;
  assert.deepEqual(panels, ['B']);
  assert.equal(subject.currentSnapshots()[0]?.battery.percent, 70);
});

test('a cancelled interval callback cannot start a read after disconnect', async t => {
  let reads = 0;
  const callbacks: Array<() => void> = [];
  const subject = runtime({ read: async () => { reads++; return result(); },
    schedule: callback => { callbacks.push(callback); return callback; } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key()]);
  await subject.refresh();
  const old = callbacks[0];
  subject.setDeviceConnected('A', false);
  old();
  await tick();
  assert.equal(reads, 1);
  subject.setDeviceConnected('A', true);
  subject.handleAlive('A', [key(9)]);
  await subject.refresh();
  old();
  await tick();
  assert.equal(reads, 2);
});

test('tap uses alive geometry and cannot switch the selected peripheral', async t => {
  const frames: V1BatteryKey[] = [];
  const subject = runtime({ draw: (_panel, frame) => { frames.push(frame); } });
  t.after(() => subject.stop());
  subject.handleAlive('A', [key(8, 120)]);
  await subject.refresh();
  frames.length = 0;
  subject.handleData('A', key(8, 180));
  await subject.refresh();
  assert.ok(frames.length > 0);
  assert.ok(frames.every(frame => frame.width === 120 && frame.style?.width === 120));
  frames.length = 0;
  subject.handleData('A', { ...key(), data: { deviceId: 'wrong-mouse' } });
  await tick();
  assert.deepEqual(frames, []);
});

test('stop is terminal and a late read cannot update state or send a frame', async () => {
  const gate = deferred<readonly BatterySourceReadResult[]>();
  const frames: V1BatteryKey[] = [];
  let reads = 0;
  const subject = runtime({ read: () => { reads++; return gate.promise; },
    draw: (_panel, frame) => { frames.push(frame); } });
  subject.handleAlive('A', [key()]);
  const pending = subject.refresh();
  subject.stop();
  frames.length = 0;
  gate.resolve(result());
  await pending;
  subject.handleAlive('A', [key()]);
  subject.setDeviceConnected('A', true);
  subject.handleData('A', key());
  await subject.refresh();
  assert.deepEqual(subject.currentSnapshots(), []);
  assert.deepEqual(frames, []);
  assert.equal(reads, 1);
});
