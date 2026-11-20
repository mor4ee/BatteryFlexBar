import path from 'node:path';
import { startSupervisedPlugin } from './host-lifecycle';
import { logger, plugin, pluginPath } from '@eniac/flexdesigner';
import {
  createExecutableRunner,
  HelperExecutionError,
  isLogitechDeviceUnavailableError,
  LogitechHidppHelperClient
} from '../backend/adapters/logitech-hidpp-helper';
import { KeychronRfHelperClient } from '../backend/adapters/keychron-rf-helper';
import { LamzuParoHelperClient, LAMZU_PARO_ID, LAMZU_AURORA_PREFIX } from '../backend/adapters/lamzu-paro-helper';
import { SonyDualSenseHelperClient, SONY_DUALSENSE_PREFIX, dualSenseUnitId } from '../backend/adapters/sony-dualsense-helper';
import { LogitechGHubClient } from '../backend/adapters/logitech-ghub';
import { HEADSETCONTROL_SOURCE, headsetControlExecutable, scanHeadsetControl } from '../backend/adapters/headsetcontrol';
import {
  scanCommonHidBattery, COMPX_MOUSE_SOURCE, SONIX_KEYBOARD_SOURCE,
  EXTRA_BETA_SOURCES, scanExtraBetaBattery,
  scanStandardHid, STANDARD_HID_PREFIX, STANDARD_HID_SOURCE,
  scanWindowsBluetooth, WINDOWS_BLUETOOTH_PREFIX, WINDOWS_BLUETOOTH_SOURCE
} from '../backend/adapters/system-battery';
import {
  BATTERY_CID,
  type BatterySourceReadResult,
  V1BatteryRuntime,
  type V1BatteryKey
} from './battery-runtime';

type PluginConfig = {
  logitech?: {
    mxMaster4?: {
      slot?: number;
    };
  };
};

type V1UiRequest = {
  action: string;
  deviceId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeUiRequest(value: unknown): V1UiRequest {
  const request = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(request) || typeof request.action !== 'string') {
    throw new TypeError('Battery UI request must include an action');
  }
  return { action: request.action, deviceId: typeof request.deviceId === 'string' ? request.deviceId : undefined };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const runtimeLogger = {
  debug(message: string, data?: Record<string, unknown>): void {
    logger?.debug(message, data);
  },
  warn(message: string, data?: Record<string, unknown>): void {
    logger?.warn(message, data);
  }
};

let config: PluginConfig = {};
let client: LogitechHidppHelperClient | undefined;
let g305Client: LogitechHidppHelperClient | undefined;
let g502Client: LogitechHidppHelperClient | undefined;
let lamzuParoClient: LamzuParoHelperClient | undefined;
let dualSenseClient: SonyDualSenseHelperClient | undefined;
const gHubClient = new LogitechGHubClient();

async function getClient(): Promise<LogitechHidppHelperClient> {
  if (client) return client;
  config = ((await plugin.getConfig()) ?? {}) as PluginConfig;
  const slot = config.logitech?.mxMaster4?.slot;
  const executablePath = path.join(
    pluginPath,
    'native',
    'windows',
    'BatteryHidHelper.exe'
  );
  client = new LogitechHidppHelperClient({
    runner: createExecutableRunner(executablePath),
    initialSlot: slot,
    onSlotChanged: async (nextSlot) => {
      config = {
        ...config,
        logitech: {
          ...config.logitech,
          mxMaster4: { slot: nextSlot }
        }
      };
      try {
        await plugin.setConfig(config);
      } catch (error) {
        runtimeLogger.warn('Cannot persist Logitech receiver slot', {
          slot: nextSlot,
          error: errorMessage(error)
        });
      }
    }
  });
  return client;
}

function getG305Client(): LogitechHidppHelperClient {
  if (g305Client) return g305Client;
  const executablePath = path.join(
    pluginPath,
    'native',
    'windows',
    'BatteryHidHelper.exe'
  );
  g305Client = new LogitechHidppHelperClient({
    runner: createExecutableRunner(executablePath),
    helperArguments: [
      '--receiver-pid',
      '0xC53F',
      '--model-id',
      '0x4074',
      '--battery-feature',
      '0x1000'
    ],
    initialSlot: 1,
    rediscoverOnFailure: false
  });
  return g305Client;
}

async function readG502() {
  g502Client ??= new LogitechHidppHelperClient({
    runner: createExecutableRunner(path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe')),
    helperArguments: ['--receiver-pid', '0xC539', '--model-id', '0x407F', '--battery-feature', '0x1001'],
    initialSlot: 1,
    rediscoverOnFailure: false
  });
  try {
    return [await g502Client.read()];
  } catch (error) {
    if (error instanceof HelperExecutionError && error.exitCode === 3) return [];
    throw error;
  }
}

const headsetControlPath = headsetControlExecutable(process.env.BATTERY_HEADSETCONTROL_EXE);

const keychronReceivers = ['0xD030', '0xD031', '0xD038', '0xD028'] as const;

async function readKeychronReceiver(receiverProductId: string) {
  const client = new KeychronRfHelperClient({
    runner: createExecutableRunner(path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe')),
    receiverProductId
  });
  try {
    return [await client.read()];
  } catch (error) {
    if (error instanceof HelperExecutionError && error.exitCode === 3) return [];
    throw error;
  }
}

function getDualSenseClient(): SonyDualSenseHelperClient {
  dualSenseClient ??= new SonyDualSenseHelperClient({
    runner: createExecutableRunner(path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe'))
  });
  return dualSenseClient;
}

function getLamzuParoClient(): LamzuParoHelperClient {
  lamzuParoClient ??= new LamzuParoHelperClient({
    runner: createExecutableRunner(path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe'))
  });
  return lamzuParoClient;
}

async function readG305WithFallback() {
  try {
    return [await getG305Client().read()];
  } catch (nativeError) {
    if (isLogitechDeviceUnavailableError(nativeError, '0x4074')) {
      throw nativeError;
    }
    runtimeLogger.warn('Native G305 read failed; trying G HUB fallback', {
      error: errorMessage(nativeError)
    });
    const snapshots = (await gHubClient.scan()).filter(
      (snapshot) => snapshot.model.toLowerCase() === 'g305'
    );
    if (snapshots.length === 0) {
      throw new AggregateError(
        [nativeError],
        'G305 was unavailable through Native HID++ and G HUB.'
      );
    }
    return snapshots;
  }
}

let runtime: V1BatteryRuntime;

function selectedDeviceIdsWithPrefix(prefix: string): string[] {
  return runtime?.selectedDeviceIds().filter((id) => id.startsWith(prefix)) ?? [];
}

runtime = new V1BatteryRuntime({
  read: async () =>
    Promise.all([
      readSource('logitech-hidpp-mx-master-4', async () => [
        await (await getClient()).read()
      ], () => selectedDeviceIdsWithPrefix('logitech-hidpp:0xb042:')),
      readSource('logitech-gaming-g305', readG305WithFallback, () =>
        selectedDeviceIdsWithPrefix('logitech-ghub:g305:')
      ),
      readSource('logitech-hidpp-g502', readG502, () => selectedDeviceIdsWithPrefix('logitech-hidpp:0x407f:')),
      ...keychronReceivers.map((pid) => readSource(
        `keychron-rf:${pid.toLowerCase()}`, () => readKeychronReceiver(pid),
        () => selectedDeviceIdsWithPrefix('keychron-rf:').filter((id) => id.endsWith(`:${pid.toLowerCase()}`))
      )),
      readSource('lamzu-aurora-hid', () => getLamzuParoClient().scan(), () =>
        [...selectedDeviceIdsWithPrefix(LAMZU_PARO_ID), ...selectedDeviceIdsWithPrefix(LAMZU_AURORA_PREFIX)]),
      readSource('sony-dualsense', () => getDualSenseClient().scan(
        runtime.selectedDeviceIds('dualSenseEnhancedBluetooth').filter((id) => id.startsWith(SONY_DUALSENSE_PREFIX))
      ), () => selectedDeviceIdsWithPrefix(SONY_DUALSENSE_PREFIX)),
      readSource(WINDOWS_BLUETOOTH_SOURCE, () => scanWindowsBluetooth(
        createExecutableRunner(path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe'), 2_000)
      ), () => selectedDeviceIdsWithPrefix(WINDOWS_BLUETOOTH_PREFIX)),
      readSource(STANDARD_HID_SOURCE, () => scanStandardHid(
        createExecutableRunner(path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe'), 2_500)
      ), () => selectedDeviceIdsWithPrefix(STANDARD_HID_PREFIX)),
      ...([COMPX_MOUSE_SOURCE, SONIX_KEYBOARD_SOURCE] as const).map((source) => readSource(
        source,
        () => scanCommonHidBattery(
          createExecutableRunner(path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe'), 3_500), source
        ),
        () => selectedDeviceIdsWithPrefix(`${source}:`)
      )),
      ...EXTRA_BETA_SOURCES.map((source) => readSource(
        source,
        () => scanExtraBetaBattery(createExecutableRunner(
          path.join(pluginPath, 'native', 'windows', 'BatteryHidHelper.exe'), source === 'rapoo-passive' ? 8_000 : 5_000
        ), source),
        () => selectedDeviceIdsWithPrefix(`${source}:`)
      )),
      ...(headsetControlPath ? [readSource(
        HEADSETCONTROL_SOURCE,
        () => scanHeadsetControl(createExecutableRunner(headsetControlPath, 4_000)),
        () => selectedDeviceIdsWithPrefix(`${HEADSETCONTROL_SOURCE}:`)
      )] : [])
    ]),
  draw: (serialNumber, key) =>
    plugin.draw(
      serialNumber,
      key as Parameters<typeof plugin.draw>[1],
      'draw'
    ),
  logger: runtimeLogger
});

async function readSource(
  sourceId: string,
  read: () => Promise<
    readonly import('../core/battery-device').BatteryDeviceSnapshot[]
  >,
  expectedDeviceIds?: () => readonly string[]
): Promise<BatterySourceReadResult> {
  try {
    return { sourceId, snapshots: await read(), expectedDeviceIds: expectedDeviceIds?.() };
  } catch (error) {
    return { sourceId, error, expectedDeviceIds: expectedDeviceIds?.() };
  }
}

plugin.on('plugin.alive', ({ serialNumber, keys }) => {
  runtime.handleAlive(serialNumber, keys as V1BatteryKey[]);
});

plugin.on('plugin.dead', ({ serialNumber, keys }) => {
  runtime.handleDead(serialNumber, keys as V1BatteryKey[]);
});

plugin.on('plugin.data', (payload) => {
  if (payload.data.key.cid === BATTERY_CID) {
    runtimeLogger.debug('Manual battery refresh requested', {
      serialNumber: payload.serialNumber,
      uid: payload.data.key.uid
    });
    runtime.handleData(payload.serialNumber, payload.data.key as V1BatteryKey);
  }
  return { status: 'success' };
});

plugin.on('device.status', (devices) => {
  for (const { serialNumber, status } of devices) {
    if (status === 'connected' || status === 'disconnected') {
      runtime.setDeviceConnected(serialNumber, status === 'connected');
    }
  }
});

plugin.on('ui.message', async (payload) => {
  try {
    const request = normalizeUiRequest(payload);
    if (request.action === 'battery.dualsense.enable') {
      const deviceId = request.deviceId ?? '';
      dualSenseUnitId(deviceId);
      const devices = await getDualSenseClient().scan([deviceId]);
      const selected = devices.find((device) => device.id === deviceId);
      if (!selected || selected.availability !== 'online') {
        throw new Error(`DualSense is unavailable: ${selected?.diagnostic ?? 'not-connected'}`);
      }
    } else if (request.action !== 'battery.devices.list') {
      throw new Error(`Unknown Battery UI action: ${request.action}`);
    }

    await runtime.refresh();
    return {
      ok: true,
      data: {
        devices: runtime.currentSnapshots()
      }
    };
  } catch (error) {
    runtimeLogger.warn('Battery UI action failed', {
      error: errorMessage(error)
    });
    return {
      ok: false,
      error: errorMessage(error)
    };
  }
});

startSupervisedPlugin(
  plugin as unknown as Parameters<typeof startSupervisedPlugin>[0],
  () => runtime.stop(),
  () => process.exit(0)
);

process.once('SIGTERM', () => runtime.stop());
runtimeLogger.debug('Battery FlexDesigner v1 backend started', {
  pluginPath, lifecycleGuard: 'battery-text-layout-20260913-1'
});
