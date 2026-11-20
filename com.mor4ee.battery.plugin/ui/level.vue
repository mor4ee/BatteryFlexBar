<template>
  <v-container class="battery-editor pa-4">
    <div class="selector-row">
      <v-select
        :model-value="deviceId"
        :items="deviceOptions"
        :label="$t('BatteryLevel.UI.Device')"
        item-title="title"
        item-value="value"
        variant="solo-filled"
        density="compact"
        :loading="loading"
        :disabled="loading || deviceOptions.length === 0"
        hide-details
        @update:model-value="selectDevice"
      />
      <v-btn
        icon="mdi-refresh"
        variant="text"
        :loading="loading"
        :title="$t('BatteryLevel.UI.Refresh')"
        @click="loadDevices"
      />
    </div>

    <v-alert v-if="errorMessage" type="error" variant="tonal" density="compact">
      {{ errorMessage }}
    </v-alert>

    <v-alert
      v-else-if="!loading && devices.length === 0"
      type="info"
      variant="tonal"
      density="compact"
    >
      {{ $t('BatteryLevel.UI.NoDevices') }}
    </v-alert>

    <div v-else-if="selectedDevice" class="device-summary">
      <div>
        <div class="device-name">{{ selectedDevice.name }}</div>
        <div class="device-meta">
          {{ selectedDeviceDescription }}
        </div>
      </div>
      <v-chip color="primary" variant="tonal" size="large">
        <span class="battery-status" :style="statusColor" :title="selectedStatusLabel">
          <span v-if="selectedBatteryText">{{ selectedBatteryText }}</span>
          <v-icon v-if="selectedBatteryIcon" :icon="selectedBatteryIcon" size="24" />
        </span>
      </v-chip>
    </div>

    <div v-if="isDualSense" class="dualsense-options">
      <div class="device-meta">{{ $t('BatteryLevel.UI.DualSenseEstimate') }}</div>
      <v-alert
        v-if="dualSenseSimpleMode"
        type="info"
        variant="tonal"
        density="compact"
      >
        {{ $t('BatteryLevel.UI.DualSenseSimpleMode') }}
      </v-alert>
      <v-switch
        :model-value="dualSenseEnhancedBluetooth"
        :label="$t('BatteryLevel.UI.DualSenseEnhancedBluetooth')"
        :disabled="loading"
        color="primary"
        density="compact"
        hide-details
        @update:model-value="setDualSenseEnhancedBluetooth"
      />
      <div class="device-meta">{{ $t('BatteryLevel.UI.DualSenseEnhancedWarning') }}</div>
    </div>

    <div class="foreground-hint">
      <v-icon icon="mdi-format-font" size="18" />
      <span>{{ $t('BatteryLevel.UI.ForegroundHint') }}</span>
    </div>
  </v-container>
</template>

<script>
export default {
  props: {
    modelValue: {
      type: Object,
      required: true
    }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      devices: [],
      loading: false,
      errorMessage: ''
    };
  },
  computed: {
    deviceId() {
      return this.modelValue.data?.deviceId ?? '';
    },
    isDualSense() {
      return typeof this.deviceId === 'string' && this.deviceId.startsWith('sony-dualsense:');
    },
    dualSenseEnhancedBluetooth() {
      return this.isDualSense && this.modelValue.data?.dualSenseEnhancedBluetooth === true;
    },
    dualSenseSimpleMode() {
      return this.isDualSense && this.selectedDevice?.diagnostic === 'bluetooth-simple-mode';
    },
    selectedDevice() {
      return this.devices.find((device) => device.id === this.deviceId);
    },
    selectedDeviceDescription() {
      const device = this.selectedDevice;
      if (!device) return '';
      if (device.source === 'standard-hid') return this.betaLabel(device);
      return [device.vendor, this.transportTitle(device.transport), this.betaLabel(device)]
        .filter(Boolean).join(' · ');
    },
    selectedBatteryText() {
      return this.selectedDevice ? this.batteryText(this.selectedDevice) : '--';
    },
    selectedBatteryIcon() {
      if (!this.selectedDevice) return '';
      if (this.selectedDevice.availability !== 'online') return 'mdi-power-plug-off';
      return this.selectedDevice.battery?.charging ? 'mdi-lightning-bolt' : '';
    },
    selectedStatusLabel() {
      return this.selectedDevice ? this.statusLabel(this.selectedDevice) : '';
    },
    statusColor() {
      return { color: this.modelValue.style?.fgColor || 'currentColor' };
    },
    deviceOptions() {
      return this.devices.map((device) => {
        const details = [this.betaLabel(device), this.batteryText(device), this.statusLabel(device)].filter(Boolean);
        return { title: [device.name, ...details].join(' · '), value: device.id };
      });
    }
  },
  methods: {
    betaLabel(device) {
      if (device.source === 'windows-bluetooth') return this.$t('BatteryLevel.UI.WindowsBluetoothBeta');
      if (device.source === 'standard-hid') return this.$t('BatteryLevel.UI.StandardHidBeta');
      return device.beta ? this.$t('BatteryLevel.UI.Beta') : '';
    },
    batteryText(device) {
      if (device.availability !== 'online') return '';
      const percent = device.battery?.percent;
      if (device.source === 'xbox' && percent === null) {
        return { critical: 'EMPTY', low: 'LOW', medium: 'MID', full: 'FULL' }[device.battery?.level] || '--';
      }
      if (typeof percent !== 'number' || !Number.isFinite(percent)) return '--';
      return device.battery?.charging ? `${percent}` : `${percent}%`;
    },
    statusLabel(device) {
      if (device.diagnostic === 'bluetooth-simple-mode') {
        return this.$t('BatteryLevel.UI.DualSenseSimpleModeLabel');
      }
      if (device.availability !== 'online') return this.$t('BatteryLevel.UI.Unavailable');
      return device.battery?.charging ? this.$t('BatteryLevel.UI.Charging') : '';
    },
    transportTitle(transport) {
      const key = {
        receiver: 'Receiver',
        bluetooth: 'Bluetooth',
        ble: 'Bluetooth',
        usb: 'USB'
      }[transport] ?? 'UnknownTransport';
      return this.$t(`BatteryLevel.UI.${key}`);
    },
    selectDevice(deviceId) {
      const nextDeviceId = deviceId ?? '';
      if (nextDeviceId !== this.deviceId) {
        // Consent belongs to this controller, never to the next selection.
        this.modelValue.data.dualSenseEnhancedBluetooth = false;
      }
      this.modelValue.data.deviceId = nextDeviceId;
      this.syncPreview();
      this.emitChange();
    },
    async setDualSenseEnhancedBluetooth(value) {
      if (this.loading || !this.isDualSense) return;
      const enabled = value === true;
      if (enabled === this.dualSenseEnhancedBluetooth) return;
      this.modelValue.data.dualSenseEnhancedBluetooth = enabled;
      this.emitChange();
      // Disabling permission cannot undo a controller's enhanced mode; it lasts
      // until power-cycle. Merely mounting or refreshing never requests it.
      if (!enabled) return;
      this.loading = true;
      this.errorMessage = '';
      try {
        const response = await this.$fd.sendToBackend({
          data: { action: 'battery.dualsense.enable', deviceId: this.deviceId }
        });
        if (!response?.ok) {
          throw new Error(response?.error || this.$t('BatteryLevel.UI.DualSenseEnableFailed'));
        }
        await this.loadDevices();
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    syncPreview() {
      this.modelValue.title = this.selectedDevice
        ? this.batteryText(this.selectedDevice)
        : '--';
    },
    emitChange() {
      // Keep the native Foreground editor's style object attached. Status icons
      // are transient runtime draws; only the numeric title is a saved preview.
      this.$emit('update:modelValue', {
        data: this.modelValue.data,
        title: this.modelValue.title
      });
    },
    async loadDevices() {
      this.loading = true;
      this.errorMessage = '';
      try {
        const response = await this.$fd.sendToBackend({
          data: { action: 'battery.devices.list' }
        });
        if (!response?.ok) {
          throw new Error(response?.error || this.$t('BatteryLevel.UI.ActionFailed'));
        }
        this.devices = Array.isArray(response.data?.devices)
          ? response.data.devices
          : [];
        if (!this.deviceId && this.devices.length > 0) {
          this.modelValue.data.deviceId = this.devices[0].id;
          this.modelValue.data.dualSenseEnhancedBluetooth = false;
        }
        this.syncPreview();
        this.emitChange();
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    }
  },
  mounted() {
    this.modelValue.data ??= {};
    const schemaVersion = Number(this.modelValue.data.schemaVersion) || 0;
    this.modelValue.data.deviceId ??= '';
    this.modelValue.data.dualSenseEnhancedBluetooth = this.modelValue.data.dualSenseEnhancedBluetooth === true;
    // Existing Foreground choices also belong to the user on imported old keys.
    // New keys receive their presentation defaults from the manifest.
    if (schemaVersion < 3) {
      this.modelValue.cfg ??= {};
      this.modelValue.cfg.clickable = true;
      this.$emit('update:modelValue', { cfg: this.modelValue.cfg });
    }
    this.modelValue.data.schemaVersion = 3;
    if (schemaVersion < 3) this.emitChange();
    void this.loadDevices();
  }
};
</script>

<style scoped>
.battery-editor {
  display: grid;
  gap: 12px;
  width: 100%;
}

.selector-row,
.device-summary,
.foreground-hint,
.battery-status {
  display: flex;
  align-items: center;
}

.battery-status {
  gap: 4px;
}

.selector-row {
  gap: 8px;
}

.selector-row .v-select {
  flex: 1;
}

.device-summary {
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.045);
}

.device-name {
  font-size: 14px;
  font-weight: 600;
}

.device-meta,
.foreground-hint {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 12px;
}

.foreground-hint {
  gap: 8px;
}

.dualsense-options {
  display: grid;
  gap: 8px;
}
</style>
