import type { BatteryDeviceSnapshot } from '../core/battery-device';
import { batteryDrawKey } from './battery-presentation';
import {
  batteryTitle,
  initialBatteryMonitorState,
  recordBatteryFailure,
  recordBatterySuccess,
  type BatteryMonitorState
} from '../core/battery-state';

export type V1BatteryKey = {
  uid: number;
  cid: string;
  title?: string;
  width?: number;
  style?: Record<string, unknown>;
  data?: {
    deviceId?: string;
    schemaVersion?: number;
    [key: string]: unknown;
  };
};

export type BatterySourceReadResult =
  | { sourceId: string; snapshots: readonly BatteryDeviceSnapshot[]; expectedDeviceIds?: readonly string[] }
  | {
      sourceId: string;
      error: unknown;
      expectedDeviceIds?: readonly string[];
    };

export type V1BatteryRuntimeOptions = {
  read: () => Promise<readonly BatterySourceReadResult[]>;
  draw: (serialNumber: string, key: V1BatteryKey) => void | Promise<unknown>;
  pollIntervalMs?: number;
  schedule?: (callback: () => void, intervalMs: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
  logger?: {
    debug(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
  };
};

export const BATTERY_CID = 'com.mor4ee.battery.level';

export class V1BatteryRuntime {
  private readonly keys = new Map<string, Map<number, V1BatteryKey>>();
  private readonly states = new Map<string, BatteryMonitorState>();
  private readonly sourceDeviceIds = new Map<string, Set<string>>();
  private readonly disconnectedPanels = new Set<string>();
  private readonly drawingPanels = new Set<string>();
  private readonly pendingDraws = new Map<string, { serialNumber: string; liveKey: V1BatteryKey; frame: V1BatteryKey }>();
  private pollTimer: unknown;
  private refreshTask: { epoch: number; promise: Promise<void> } | undefined;
  private readEpoch = 0;
  private stopped = false;

  constructor(private readonly options: V1BatteryRuntimeOptions) {}

  handleAlive(serialNumber: string, keys: readonly V1BatteryKey[]): void {
    if (!this.canRender(serialNumber)) return;
    const active = this.keys.get(serialNumber) ?? new Map<number, V1BatteryKey>();
    this.keys.set(serialNumber, active);
    for (const key of keys) {
      this.forgetKey(serialNumber, key.uid);
      if (key.cid !== BATTERY_CID) continue;
      active.set(key.uid, key);
      this.options.logger?.debug('Battery live layout activated', {
        serialNumber, uid: key.uid, width: key.width, styleWidth: key.style?.width
      });
      this.render(serialNumber, key);
    }
    if (active.size === 0) this.keys.delete(serialNumber);
    if (!this.hasActiveKeys()) { this.invalidateUnusedRead(); return; }
    this.ensurePolling();
    void this.refresh();
  }

  handleDead(serialNumber: string, keys: readonly V1BatteryKey[]): void {
    const active = this.keys.get(serialNumber);
    if (!active) return;
    for (const key of keys) this.forgetKey(serialNumber, key.uid);
    if (active.size === 0) this.keys.delete(serialNumber);
    this.invalidateUnusedRead();
  }

  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const existing = this.refreshTask;
    if (existing) {
      // Hardware helpers cannot cancel an already issued read. Wait for it,
      // discard its obsolete result, then coalesce callers into one fresh read.
      return existing.epoch === this.readEpoch
        ? existing.promise : existing.promise.then(() => this.refresh());
    }
    const task = { epoch: this.readEpoch, promise: Promise.resolve() };
    this.refreshTask = task;
    task.promise = this.readAndRender(task.epoch).finally(() => {
      if (this.refreshTask === task) this.refreshTask = undefined;
    });
    return task.promise;
  }

  setDeviceConnected(serialNumber: string, connected: boolean): void {
    if (this.stopped) return;
    if (connected) {
      this.disconnectedPanels.delete(serialNumber);
      return; // Connected never revives retained UIDs: wait for alive.
    }
    this.disconnectedPanels.add(serialNumber);
    const active = this.keys.get(serialNumber);
    this.options.logger?.debug('Battery layout invalidated; waiting for fresh alive', {
      serialNumber, keyCount: active?.size ?? 0
    });
    for (const uid of active?.keys() ?? []) this.forgetKey(serialNumber, uid);
    this.keys.delete(serialNumber);
    this.invalidateUnusedRead();
  }

  handleData(serialNumber: string, key: V1BatteryKey): void {
    if (!this.canRender(serialNumber) || key.cid !== BATTERY_CID) return;
    const live = this.keys.get(serialNumber)?.get(key.uid);
    if (!live || (live.data?.deviceId ?? '') !== (key.data?.deviceId ?? '')) return;
    this.render(serialNumber, live); // Input must not replace alive geometry.
    void this.refresh();
  }

  private forgetKey(serialNumber: string, uid: number): void {
    this.keys.get(serialNumber)?.delete(uid);
    this.pendingDraws.delete(`${serialNumber}:${uid}`);
  }

  private invalidateUnusedRead(): void {
    if (this.hasActiveKeys()) return;
    this.stopPolling();
    this.readEpoch++;
  }

  private canRender(serialNumber: string): boolean {
    return !this.stopped && !this.disconnectedPanels.has(serialNumber);
  }

  stop(): void {
    this.stopped = true;
    this.readEpoch++;
    this.stopPolling();
    this.keys.clear();
    this.pendingDraws.clear();
    this.disconnectedPanels.clear();
  }

  currentSnapshots(): BatteryDeviceSnapshot[] {
    return [...this.states.values()]
      .flatMap((state) => (state.snapshot ? [state.snapshot] : []))
      .sort((left, right) => Number(!!left.beta) - Number(!!right.beta) || left.name.localeCompare(right.name));
  }

  selectedDeviceIds(requiredFlag?: string): string[] {
    const ids = new Set<string>();
    for (const keys of this.keys.values()) {
      for (const key of keys.values()) {
        if (key.data?.deviceId && (!requiredFlag || key.data[requiredFlag] === true)) ids.add(key.data.deviceId);
      }
    }
    return [...ids];
  }

  hasActiveKeys(): boolean {
    return this.keys.size > 0;
  }

  private async readAndRender(epoch: number): Promise<void> {
    let results: readonly BatterySourceReadResult[];
    try {
      results = await this.options.read();
    } catch (error) {
      if (this.stopped || epoch !== this.readEpoch) return;
      this.options.logger?.warn('Battery source scan failed', {
        error: errorMessage(error)
      });
      this.renderAll();
      return;
    }

    if (this.stopped || epoch !== this.readEpoch) return;
    for (const result of results) {
      if ('error' in result) {
        this.recordSourceFailure(
          result.sourceId,
          result.error,
          result.expectedDeviceIds
        );
      } else {
        this.recordSourceSuccess(result.sourceId, result.snapshots, result.expectedDeviceIds);
      }
    }
    this.renderAll();
  }

  private recordSourceSuccess(
    sourceId: string,
    snapshots: readonly BatteryDeviceSnapshot[],
    expectedDeviceIds: readonly string[] = []
  ): void {
    const knownIds = this.sourceDeviceIds.get(sourceId) ?? new Set<string>();
    for (const id of expectedDeviceIds) knownIds.add(id);
    const observedIds = new Set(snapshots.map((snapshot) => snapshot.id));

    for (const snapshot of snapshots) {
      const previous = this.states.get(snapshot.id) ?? initialBatteryMonitorState();
      this.states.set(snapshot.id, recordBatterySuccess(previous, snapshot));
      knownIds.add(snapshot.id);
      this.options.logger?.debug('Battery snapshot updated', {
        sourceId,
        adapter: snapshot.source,
        deviceId: snapshot.id,
        percent: snapshot.battery.percent,
        status: snapshot.battery.status
      });
    }

    for (const deviceId of knownIds) {
      if (observedIds.has(deviceId)) continue;
      if (!this.states.has(deviceId)) this.states.set(deviceId, initialBatteryMonitorState());
      this.recordDeviceFailure(
        sourceId,
        deviceId,
        new Error('Device was not reported by its battery source.')
      );
    }
    this.sourceDeviceIds.set(sourceId, knownIds);
  }

  private recordSourceFailure(
    sourceId: string,
    error: unknown,
    expectedDeviceIds: readonly string[] = []
  ): void {
    const deviceIds = this.sourceDeviceIds.get(sourceId) ?? new Set<string>();
    for (const deviceId of expectedDeviceIds) deviceIds.add(deviceId);
    if (deviceIds.size === 0) {
      this.options.logger?.warn('Battery source unavailable', {
        sourceId,
        error: errorMessage(error)
      });
      return;
    }
    this.sourceDeviceIds.set(sourceId, deviceIds);
    for (const deviceId of deviceIds) {
      if (!this.states.has(deviceId)) {
        this.states.set(deviceId, initialBatteryMonitorState());
      }
      this.recordDeviceFailure(sourceId, deviceId, error);
    }
  }

  private recordDeviceFailure(
    sourceId: string,
    deviceId: string,
    error: unknown
  ): void {
    const previous = this.states.get(deviceId);
    if (!previous) return;
    const state = recordBatteryFailure(previous, error);
    this.states.set(deviceId, state);
    this.options.logger?.warn('Battery read failed', {
      sourceId,
      deviceId,
      error: state.lastError,
      failures: state.consecutiveFailures,
      availability: state.snapshot?.availability ?? 'unknown'
    });
  }

  private ensurePolling(): void {
    if (this.stopped || this.pollTimer !== undefined || this.keys.size === 0) return;
    const timer = (this.options.schedule ?? setInterval)(
      () => {
        if (this.stopped || this.pollTimer !== timer || !this.hasActiveKeys()) return;
        void this.refresh();
      },
      this.options.pollIntervalMs ?? 60_000
    );
    this.pollTimer = timer;
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return;
    if (this.options.cancelSchedule) this.options.cancelSchedule(this.pollTimer);
    else clearInterval(this.pollTimer as ReturnType<typeof setInterval>);
    this.pollTimer = undefined;
  }

  private renderAll(): void {
    for (const [serialNumber, keys] of this.keys) {
      for (const key of keys.values()) this.render(serialNumber, key);
    }
  }

  private render(serialNumber: string, key: V1BatteryKey): void {
    if (!this.canRender(serialNumber) || this.keys.get(serialNumber)?.get(key.uid) !== key) return;
    const selectedDeviceId = key.data?.deviceId;
    const state = selectedDeviceId
      ? this.states.get(selectedDeviceId) ?? initialBatteryMonitorState()
      : this.defaultState();
    key.title = batteryTitle(state);
    const frame = structuredClone(batteryDrawKey(key, state));
    this.pendingDraws.set(`${serialNumber}:${key.uid}`, { serialNumber, liveKey: key, frame });
    void this.flushPanel(serialNumber);
  }

  private async flushPanel(serialNumber: string): Promise<void> {
    if (this.drawingPanels.has(serialNumber)) return;
    this.drawingPanels.add(serialNumber);
    try {
      while (!this.stopped) {
        const entry = [...this.pendingDraws].find(([, pending]) => pending.serialNumber === serialNumber);
        if (!entry) break;
        const [signature, pending] = entry;
        this.pendingDraws.delete(signature);
        if (!this.canRender(serialNumber)
          || this.keys.get(serialNumber)?.get(pending.frame.uid) !== pending.liveKey) continue;
        try {
          this.options.logger?.debug('Battery property draw submitted', {
            serialNumber, uid: pending.frame.uid,
            width: pending.frame.width, styleWidth: pending.frame.style?.width
          });
          await this.options.draw(serialNumber, pending.frame);
        } catch (error) {
          if (this.keys.get(serialNumber)?.get(pending.frame.uid) !== pending.liveKey) continue;
          this.options.logger?.warn('FlexDesigner battery draw failed', {
            serialNumber,
            uid: pending.frame.uid,
            error: errorMessage(error)
          });
        }
      }
    } finally {
      this.drawingPanels.delete(serialNumber);
    }
  }

  private defaultState(): BatteryMonitorState {
    const states = [...this.states.values()];
    return (
      states.find((state) => state.snapshot?.availability === 'online' && !state.snapshot.beta) ??
      states.find((state) => state.snapshot?.availability === 'online') ??
      this.states.values().next().value ??
      initialBatteryMonitorState()
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
