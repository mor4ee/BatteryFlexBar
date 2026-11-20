# Install and configure Battery

1. Install the Windows x64 `.flexplugin` through FlexDesigner. Use an official
   [release](https://github.com/mor4ee/BatteryFlexBar/releases/latest), or
   [build an archive](../README.md#build-from-source).
2. Connect a peripheral. In FlexDesigner, add **Battery → Battery level**,
   open **Function**, and select that peripheral. Use the refresh action if it
   just connected.
3. Use **Foreground** to set the font, size and text position, and to select an
   optional icon. Apply the editor changes and upload the layout to FlexBar.
4. Add another Unit for each additional device. Tap a Unit to request a reading.

If a device is missing, check its exact model and connection in the
[compatibility table](COMPATIBILITY.md). Some receivers and cables show as
separate entries. Some devices stop sending battery reports while asleep.

## DualSense over Bluetooth

The basic Bluetooth report does not include battery data. USB is the simplest
alternative. On Bluetooth you can explicitly allow extended reports in Function
for the selected controller. This can change how older DirectInput games see
the controller until it is switched off and back on. Battery does not change
lights or vibration. Unchecking the option prevents future activation; it does
not reverse the mode for the current connection.

## Optional headsets

Install [HeadsetControl](https://github.com/Sapd/HeadsetControl) separately, set
the user environment variable `BATTERY_HEADSETCONTROL_EXE` to its absolute
local executable path, then fully restart FlexDesigner. Battery only requests
the battery reading. It does not install or bundle HeadsetControl. A headset
appears only when a valid percentage is available.

## Reporting an issue

Include the Battery and FlexDesigner versions, Windows version, peripheral
model and connection type. If the issue is on the panel, note whether it
happened during a page change, resize, reconnect or Upload. Don't share device
serial numbers, full hardware IDs, personal paths, or unredacted logs.
