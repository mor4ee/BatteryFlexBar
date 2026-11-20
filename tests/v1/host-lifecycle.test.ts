import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { startSupervisedPlugin } from '../../src/v1/host-lifecycle';

test('binds detached SDK callbacks, starts once, and stops/exits on socket close', () => {
  const ws = new EventEmitter();
  let starts = 0;
  const events: string[] = [];
  const transport = { ws, marker: 42, start() { assert.equal(this.marker, 42); starts++; } };
  const client = { transport, start() { this.transport.start(); } };
  const stop = () => { events.push('stop'); };
  const exit = () => { events.push('exit'); };
  startSupervisedPlugin(client, stop, exit);
  startSupervisedPlugin(client, stop, exit);
  assert.equal(starts, 1);
  const detached = transport.start;
  detached();
  assert.equal(starts, 2);
  ws.emit('close');
  ws.emit('close');
  assert.deepEqual(events, ['stop', 'exit']);
});
