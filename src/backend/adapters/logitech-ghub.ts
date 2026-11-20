import WebSocket, { type RawData } from 'ws';
import type {
  BatteryChargeStatus,
  BatteryDeviceSnapshot
} from '../../core/battery-device';
import { levelFromPercent } from '../../core/battery-device';

const DEFAULT_URL = 'ws://127.0.0.1:9010';

type GHubRequest = {
  msgId: string;
  verb: 'GET';
  path: string;
};

type GHubResponse = {
  msgId: string;
  verb: string;
  path: string;
  result?: { code?: string; what?: string };
  payload?: unknown;
};

export type GHubDeviceInfo = {
  id: string;
  state: string;
  deviceType: string;
  deviceModel: string;
  displayName: string;
  extendedDisplayName: string;
  deviceUnitId: string;
  deviceSignature: string;
  displayConnectionType: string;
  capabilities: { hasBatteryStatus: boolean };
  activeInterfaces: unknown[];
};

export type GHubBatteryState = {
  deviceId: string;
  percentage: number;
  charging: boolean;
  fullyCharged: boolean;
  chargingError: boolean;
  isBatteryRemoved: boolean;
};

export type LogitechGHubClientOptions = {
  url?: string;
  timeoutMs?: number;
  now?: () => Date;
};

export class GHubUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GHubUnavailableError';
  }
}

export class LogitechGHubClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: LogitechGHubClientOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.now = options.now ?? (() => new Date());
  }

  async scan(): Promise<BatteryDeviceSnapshot[]> {
    const connection = await GHubConnection.open(this.url, this.timeoutMs);
    try {
      const devicePayload = await connection.request('GET', '/devices/list');
      const batteryDevices = parseDeviceList(devicePayload).filter(
        isActiveBatteryDevice
      );
      const results = await Promise.allSettled(
        batteryDevices.map(async (device) => {
          const payload = await connection.request(
            'GET',
            `/battery/${device.id}/state`
          );
          return normalizeGHubBattery(
            device,
            parseBatteryState(payload),
            this.now()
          );
        })
      );
      const snapshots = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      if (batteryDevices.length > 0 && snapshots.length === 0) {
        const failed = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
        );
        throw failed?.reason ?? new Error('G HUB returned no battery states.');
      }
      return snapshots;
    } finally {
      connection.close();
    }
  }
}

class GHubConnection {
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;

  private constructor(
    private readonly socket: WebSocket,
    private readonly timeoutMs: number
  ) {
    socket.on('message', (data) => this.handleMessage(data));
    socket.on('close', () =>
      this.rejectAll(new GHubUnavailableError('G HUB WebSocket closed.'))
    );
    socket.on('error', (error) => this.rejectAll(error));
  }

  static open(url: string, timeoutMs: number): Promise<GHubConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, 'json', {
        origin: 'file://',
        headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' }
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new GHubUnavailableError('Timed out connecting to Logitech G HUB.'));
      }, timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve(new GHubConnection(socket, timeoutMs));
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(
          new GHubUnavailableError(
            `Cannot connect to Logitech G HUB: ${error.message}`
          )
        );
      });
    });
  }

  request(verb: 'GET', path: string): Promise<unknown> {
    const msgId = `battery-flexbar-${process.pid}-${Date.now()}-${this.sequence++}`;
    const request: GHubRequest = { msgId, verb, path };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new GHubUnavailableError(`G HUB request timed out: ${path}`));
      }, this.timeoutMs);
      this.pending.set(msgId, { resolve, reject, timer });
      this.socket.send(JSON.stringify(request), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(msgId);
        reject(error);
      });
    });
  }

  close(): void {
    this.rejectAll(new GHubUnavailableError('G HUB connection closed.'));
    this.socket.close();
  }

  private handleMessage(data: RawData): void {
    let response: GHubResponse;
    try {
      response = JSON.parse(data.toString()) as GHubResponse;
    } catch {
      return;
    }
    if (!response.msgId) return;
    const pending = this.pending.get(response.msgId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.msgId);
    if (response.result?.code !== 'SUCCESS') {
      pending.reject(
        new Error(response.result?.what || `G HUB request failed: ${response.path}`)
      );
      return;
    }
    pending.resolve(response.payload);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function parseDeviceList(payload: unknown): GHubDeviceInfo[] {
  if (!isRecord(payload) || !Array.isArray(payload.deviceInfos)) {
    throw new TypeError('G HUB device list is missing deviceInfos.');
  }
  return payload.deviceInfos.filter(isRecord).map((value) => ({
    id: requiredString(value.id, 'device id'),
    state: requiredString(value.state, 'device state'),
    deviceType: requiredString(value.deviceType, 'device type'),
    deviceModel: requiredString(value.deviceModel, 'device model'),
    displayName: requiredString(value.displayName, 'display name'),
    extendedDisplayName:
      typeof value.extendedDisplayName === 'string'
        ? value.extendedDisplayName
        : requiredString(value.displayName, 'display name'),
    deviceUnitId: requiredString(value.deviceUnitId, 'device unit id'),
    deviceSignature:
      typeof value.deviceSignature === 'string' ? value.deviceSignature : '',
    displayConnectionType:
      typeof value.displayConnectionType === 'string'
        ? value.displayConnectionType
        : 'INVALID_DISPLAY_CONNECTION',
    capabilities: {
      hasBatteryStatus:
        isRecord(value.capabilities) &&
        value.capabilities.hasBatteryStatus === true
    },
    activeInterfaces: Array.isArray(value.activeInterfaces)
      ? value.activeInterfaces
      : []
  }));
}

export function parseBatteryState(payload: unknown): GHubBatteryState {
  if (!isRecord(payload)) {
    throw new TypeError('G HUB battery response is invalid.');
  }
  const percentage = payload.percentage;
  if (
    typeof percentage !== 'number' ||
    !Number.isInteger(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    throw new RangeError('G HUB battery percentage must be an integer from 0 to 100.');
  }
  return {
    deviceId: requiredString(payload.deviceId, 'battery device id'),
    percentage,
    charging: payload.charging === true,
    fullyCharged: payload.fullyCharged === true,
    chargingError: payload.chargingError === true,
    isBatteryRemoved: payload.isBatteryRemoved === true
  };
}

export function normalizeGHubBattery(
  device: GHubDeviceInfo,
  battery: GHubBatteryState,
  observedAt: Date
): BatteryDeviceSnapshot {
  if (battery.deviceId !== device.id) {
    throw new TypeError('G HUB battery response belongs to another device.');
  }
  if (battery.isBatteryRemoved) {
    throw new Error('G HUB reports that the device battery is removed.');
  }
  const status: BatteryChargeStatus = battery.chargingError
    ? 'error'
    : battery.charging
      ? 'charging'
      : battery.fullyCharged
        ? 'full'
        : 'discharging';
  return {
    id: `logitech-ghub:${device.deviceModel.toLowerCase()}:${device.deviceUnitId.toLowerCase()}`,
    name: device.extendedDisplayName || device.displayName,
    vendor: 'Logitech G',
    model: device.deviceModel,
    kind: normalizeKind(device.deviceType),
    transport: normalizeTransport(device.displayConnectionType),
    battery: {
      percent: battery.percentage,
      level: levelFromPercent(battery.percentage),
      status,
      charging: battery.charging
    },
    availability: 'online',
    source: 'logitech-ghub-websocket',
    observedAt: observedAt.toISOString()
  };
}

export function isActiveBatteryDevice(device: GHubDeviceInfo): boolean {
  return (
    device.capabilities.hasBatteryStatus &&
    device.state === 'ACTIVE' &&
    device.activeInterfaces.length > 0
  );
}

function normalizeKind(type: string): BatteryDeviceSnapshot['kind'] {
  if (type === 'MOUSE') return 'mouse';
  if (type === 'KEYBOARD') return 'keyboard';
  return 'other';
}

function normalizeTransport(type: string): BatteryDeviceSnapshot['transport'] {
  if (type === 'LIGHTSPEED' || type === 'WIRELESS') return 'receiver';
  if (type === 'BLUETOOTH') return 'bluetooth';
  if (type === 'USB') return 'usb';
  return 'unknown';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`G HUB ${field} is missing.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
