import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plugin = new URL('../com.mor4ee.battery.plugin/', import.meta.url);
const read = (url) => JSON.parse(readFileSync(url, 'utf8'));
const manifest = read(new URL('manifest.json', plugin));
const pkg = read(new URL('../package.json', import.meta.url));

assert.deepEqual(read(new URL('config.json', plugin)), {}, 'Refusing to package a non-default config');
assert.equal(manifest.uuid, 'com.mor4ee.battery');
assert.equal(manifest.version, pkg.version, 'Manifest and npm version must match');
assert.deepEqual(manifest.keyLibrary.children.map((key) => key.cid), ['com.mor4ee.battery.level']);
for (const key of manifest.keyLibrary.children) {
  assert.equal(key.data.deviceId, '', 'A release Unit must not be bound to a peripheral');
  assert.equal(key.data.dualSenseEnhancedBluetooth, false, 'Extended reports require explicit consent');
}
