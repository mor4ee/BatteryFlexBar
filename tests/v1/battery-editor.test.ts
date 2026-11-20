import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise the actual Vue options script without introducing a browser renderer
// or pretending that this harness validates FlexDesigner's template compiler.
type EditorInstance = Record<string, any>;
type EditorOptions = {
  data: () => Record<string, unknown>;
  methods: Record<string, (...args: any[]) => unknown>;
  computed: Record<string, () => unknown>;
  mounted: () => void;
};

const filename = path.resolve('com.mor4ee.battery.plugin/ui/level.vue');
const source = readFileSync(filename, 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'Battery editor must contain a Vue options script');
const moduleContext = { exports: {} as EditorOptions };
runInNewContext(source.replace('export default', 'module.exports ='), {
  module: moduleContext
}, { filename, timeout: 1000 });
const options = moduleContext.exports;

function editorHarness(modelValue: EditorInstance) {
  const emissions: Array<{ event: string; payload: EditorInstance }> = [];
  const editor: EditorInstance = {
    ...options.data(), modelValue,
    $t: (key: string) => key,
    $emit: (event: string, payload: EditorInstance) => emissions.push({ event, payload })
  };
  for (const [name, method] of Object.entries(options.methods)) {
    editor[name] = method.bind(editor);
  }
  for (const [name, computed] of Object.entries(options.computed)) {
    Object.defineProperty(editor, name, { get: computed.bind(editor) });
  }
  return { editor, emissions };
}

test('Function editor labels the Windows Bluetooth source in the selector and selected device details', () => {
  const { editor } = editorHarness({ title: '', data: { deviceId: 'bt' }, style: {} });
  editor.devices = [{
    id: 'bt', name: 'Keyboard', vendor: '', transport: 'bluetooth', source: 'windows-bluetooth',
    beta: true, availability: 'online', battery: { percent: 0, charging: false }
  }];
  assert.equal(editor.deviceOptions[0].title, 'Keyboard · BatteryLevel.UI.WindowsBluetoothBeta · 0%');
  assert.equal(editor.selectedDeviceDescription, 'BatteryLevel.UI.Bluetooth · BatteryLevel.UI.WindowsBluetoothBeta');
});

test('Function editor shows a lightning icon, then only plug-off for cached charging data', () => {
  const modelValue = {
    title: '', data: { deviceId: 'mouse', schemaVersion: 3 },
    style: { fgColor: '#ff9800', font: 'Digital-7' }
  };
  const { editor } = editorHarness(modelValue);
  editor.devices = [{
    id: 'mouse', name: 'MX Master 4', availability: 'online',
    battery: { percent: 70, charging: true }
  }];
  assert.equal(editor.selectedBatteryText, '70');
  assert.equal(editor.selectedBatteryIcon, 'mdi-lightning-bolt');
  assert.equal(editor.selectedStatusLabel, 'BatteryLevel.UI.Charging');
  assert.equal(editor.statusColor.color, '#ff9800');
  editor.syncPreview();
  assert.equal(modelValue.title, '70');

  for (const availability of ['stale', 'offline']) {
    editor.devices[0].availability = availability;
    assert.equal(editor.selectedBatteryText, '');
    assert.equal(editor.selectedBatteryIcon, 'mdi-power-plug-off');
    assert.equal(editor.selectedStatusLabel, 'BatteryLevel.UI.Unavailable');
    assert.equal(editor.deviceOptions[0].title, 'MX Master 4 · BatteryLevel.UI.Unavailable');
    editor.syncPreview();
    assert.equal(modelValue.title, '');
  }

  editor.devices[0].availability = 'online';
  editor.devices[0].battery.charging = false;
  assert.equal(editor.selectedBatteryText, '70%');
  assert.equal(editor.selectedBatteryIcon, '');
  assert.equal(editor.selectedStatusLabel, '');
});

test('editor emits only functional data and title, preserving native Foreground references', () => {
  const hostKey = {
    title: 'old', data: { deviceId: 'mouse', schemaVersion: 3 },
    style: { fgColor: '#123456', fontSize: 31, titlePos: { X: 63, Y: 47 } },
    cfg: { clickable: true }
  };
  const editingStyleRef = hostKey.style;
  const titlePosRef = editingStyleRef.titlePos;
  const cfgRef = hostKey.cfg;
  const { editor, emissions } = editorHarness(structuredClone(hostKey));
  editor.modelValue.title = '45%';
  editor.emitChange();
  const emission = emissions[0]!;
  assert.equal(emission.event, 'update:modelValue');
  assert.deepEqual(Object.keys(emission.payload).sort(), ['data', 'title']);
  Object.assign(hostKey, emission.payload);
  assert.equal(hostKey.title, '45%');
  assert.strictEqual(hostKey.style, editingStyleRef);
  assert.strictEqual(hostKey.style.titlePos, titlePosRef);
  assert.strictEqual(hostKey.cfg, cfgRef);
  assert.equal(hostKey.style.fgColor, '#123456');
});

test('imported old keys retain their Foreground when functional settings migrate', () => {
  const key = {
    title: 'Battery', data: { deviceId: 'mouse', schemaVersion: 1 },
    style: {
      showIcon: true, showTitle: false, fgColor: '#654321',
      font: 'Consolas', fontSize: 33, iconPos: { X: 20, Y: 50 }
    },
    cfg: { clickable: false }
  };
  const styleRef = key.style;
  const originalStyle = structuredClone(key.style);
  const { editor, emissions } = editorHarness(key);
  let loads = 0;
  editor.loadDevices = () => { loads += 1; };
  options.mounted.call(editor);

  assert.equal(key.data.schemaVersion, 3);
  assert.equal(key.cfg.clickable, true);
  assert.equal(loads, 1);
  assert.strictEqual(key.style, styleRef);
  assert.deepEqual(key.style, originalStyle);
  assert.ok(emissions.every(({ payload }) => !Object.hasOwn(payload, 'style')));
  assert.ok(emissions.some(({ payload }) => payload.cfg?.clickable === true));
});

function dualSenseEditor(enabled = false) {
  const key = {
    title: '--',
    data: {
      deviceId: 'sony-dualsense:controller-a', schemaVersion: 3,
      dualSenseEnhancedBluetooth: enabled
    },
    style: { fgColor: '#ff9800', fontSize: 30, showIcon: true, icon: 'user-icon' }
  };
  const harness = editorHarness(key);
  harness.editor.devices = [{
    id: key.data.deviceId, name: 'DualSense', vendor: 'Sony', kind: 'gamepad',
    transport: 'bluetooth', availability: 'unsupported',
    battery: { percent: null, charging: false, status: 'unknown' },
    diagnostic: 'bluetooth-simple-mode'
  }];
  return { ...harness, key };
}

test('DualSense basic Bluetooth mode remains selectable without a fictitious battery percentage', () => {
  const { editor } = dualSenseEditor();
  assert.equal(editor.isDualSense, true);
  assert.equal(editor.dualSenseSimpleMode, true);
  assert.equal(editor.selectedBatteryText, '');
  assert.equal(editor.selectedBatteryIcon, 'mdi-power-plug-off');
  assert.equal(editor.selectedStatusLabel, 'BatteryLevel.UI.DualSenseSimpleModeLabel');
  assert.equal(editor.deviceOptions[0].value, 'sony-dualsense:controller-a');
  assert.equal(editor.deviceOptions[0].title, 'DualSense · BatteryLevel.UI.DualSenseSimpleModeLabel');
  editor.syncPreview();
  assert.equal(editor.modelValue.title, '');
  editor.devices[0].availability = 'online';
  assert.equal(editor.selectedBatteryText, '--', 'null is unknown, never 0%');
});

test('only explicit DualSense opt-in enables enhanced Bluetooth once and emits no native style', async () => {
  const { editor, key, emissions } = dualSenseEditor();
  const styleRef = key.style;
  const calls: Array<EditorInstance> = [];
  editor.$fd = {
    sendToBackend: async (request: EditorInstance) => {
      calls.push(request.data);
      return { ok: true, data: { devices: editor.devices } };
    }
  };
  await editor.setDualSenseEnhancedBluetooth(true);
  assert.equal(key.data.dualSenseEnhancedBluetooth, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.action, 'battery.dualsense.enable');
  assert.equal(calls[0]!.deviceId, key.data.deviceId);
  assert.equal(calls[1]!.action, 'battery.devices.list');
  assert.equal(editor.loading, false);
  await editor.setDualSenseEnhancedBluetooth(true);
  assert.equal(calls.length, 2, 'repeating the same switch value is not another enable request');
  await editor.setDualSenseEnhancedBluetooth(false);
  assert.equal(key.data.dualSenseEnhancedBluetooth, false);
  assert.equal(calls.length, 2, 'revoking permission never changes controller mode');
  assert.strictEqual(key.style, styleRef);
  assert.ok(emissions.every(({ payload }) =>
    Object.keys(payload).every((field) => field === 'data' || field === 'title')));
});

test('mount and refresh never enable enhanced Bluetooth even with a saved opt-in', async () => {
  for (const enabled of [false, true]) {
    const { editor, key } = dualSenseEditor(enabled);
    const actions: string[] = [];
    editor.$fd = {
      sendToBackend: async (request: EditorInstance) => {
        actions.push(request.data.action);
        return { ok: true, data: { devices: editor.devices } };
      }
    };
    options.mounted.call(editor);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await editor.loadDevices();
    assert.deepEqual(actions, ['battery.devices.list', 'battery.devices.list']);
    assert.equal(key.data.dualSenseEnhancedBluetooth, enabled);
  }
});

test('changing device selection clears controller-specific Bluetooth consent', () => {
  const { editor, key } = dualSenseEditor(true);
  editor.selectDevice('sony-dualsense:controller-a');
  assert.equal(key.data.dualSenseEnhancedBluetooth, true, 'same device retains consent');
  editor.selectDevice('sony-dualsense:controller-b');
  assert.equal(key.data.dualSenseEnhancedBluetooth, false);
  assert.equal(editor.isDualSense, true, 'Sony controls remain available for an offline saved selection');
  assert.equal(editor.selectedDevice, undefined);
  key.data.dualSenseEnhancedBluetooth = true;
  editor.selectDevice('logitech:mouse');
  assert.equal(key.data.dualSenseEnhancedBluetooth, false);
  assert.equal(editor.isDualSense, false);
});

test('automatic first-device selection does not transfer orphaned Bluetooth consent', async () => {
  const { editor, key } = dualSenseEditor(true);
  key.data.deviceId = '';
  editor.$fd = {
    sendToBackend: async () => ({ ok: true, data: { devices: editor.devices } })
  };
  await editor.loadDevices();
  assert.equal(key.data.deviceId, 'sony-dualsense:controller-a');
  assert.equal(key.data.dualSenseEnhancedBluetooth, false);
});

test('enhanced Bluetooth action is guarded while loading and for non-Sony devices', async () => {
  const { editor, key } = dualSenseEditor();
  let requests = 0;
  editor.$fd = { sendToBackend: async () => { requests += 1; return { ok: true }; } };
  editor.loading = true;
  await editor.setDualSenseEnhancedBluetooth(true);
  assert.equal(key.data.dualSenseEnhancedBluetooth, false);
  editor.loading = false;
  editor.selectDevice('mouse');
  await editor.setDualSenseEnhancedBluetooth(true);
  assert.equal(key.data.dualSenseEnhancedBluetooth, false);
  assert.equal(requests, 0);
});

test('failed enhanced Bluetooth request shows an error and releases the loading guard', async () => {
  const { editor, key } = dualSenseEditor();
  let requests = 0;
  editor.$fd = {
    sendToBackend: async () => { requests += 1; return { ok: false, error: 'Controller unavailable' }; }
  };
  await editor.setDualSenseEnhancedBluetooth(true);
  assert.equal(editor.loading, false);
  assert.equal(editor.errorMessage, 'Controller unavailable');
  assert.equal(requests, 1, 'failed activation does not silently refresh away its error');
  assert.equal(key.data.dualSenseEnhancedBluetooth, true, 'explicit permission remains the user choice');
});
