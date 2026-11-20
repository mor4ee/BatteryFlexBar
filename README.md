# Battery for FlexBar

**English** · [Русский](README.ru.md) · [Español](README.es.md) · [简体中文](README.zh-CN.md)

![Battery for FlexBar, with an illustrative panel showing battery level, charging and an unavailable peripheral](.marketplace/repository-cover.svg)

See the battery level of a mouse, keyboard or controller on your FlexBar. Add
one **Battery level** Unit per device, choose the device in **Function**, and
style its text and icon in **Foreground**.

[Setup](docs/SETUP.md) · [Supported devices](#supported-devices) · [Build from source](#build-from-source)

## On your FlexBar

- See the percentage, or a discrete level where the device only reports levels.
- A lightning icon replaces the percent sign during charging. When the device
  is unavailable, a crossed-out plug replaces the reading. Your chosen icon
  and style stay in place.
- The Unit refreshes about once a minute. Tap it to read again sooner.
- Monitor several devices at once by adding several Units.

## Requirements

Windows 10/11 (x64), FlexBar, and FlexDesigner **Plugin API v1**. The verified
host baseline is FlexDesigner **2.2.3**. The full hardware regression on 2.2.5
Pre-release is still pending. This is not a FlexStudio SDK v2 plugin.

Download the Windows x64 package from [GitHub Releases](https://github.com/mor4ee/BatteryFlexBar/releases/latest)
and import it in FlexDesigner, or build from source below. Profiles marked
**Beta** have not been verified on hardware for the listed connections.

## Supported devices

**Hardware-tested:** These checks apply to the specific models and connections below.

| Device | Tested connection |
| --- | --- |
| Logitech MX Master 4 | Logi Bolt |
| Logitech G305 LIGHTSPEED | Original LIGHTSPEED receiver, including with G HUB closed |
| Keychron M6 | 1K Keychron Link receiver |
| Lamzu Paro | 2.4 GHz receiver and USB cable; on-panel disconnect and recovery tested with the receiver |
| Sony DualSense | USB and Bluetooth with extended reports; percentage is an estimate |

**Beta profiles:** Implemented, but not confirmed on our hardware for these routes.

| Category | Beta examples |
| --- | --- |
| Mice | Logitech G502 LIGHTSPEED, Keychron M7 and other selected Keychron RF models, Lamzu Aurora models, and selected Glorious, Rapoo, Razer, Corsair, HyperX, SteelSeries, ASUS ROG and CompX models |
| Keyboards | Selected SONiX, BY and wired Evision models; includes specific AULA, MCHOSE, ATK, VGN and VXE profiles, plus Razer BlackWidow V3 Pro and ASUS ROG Azoth |
| Controllers | DualSense Edge, DualShock 4 over USB, Nintendo Switch Pro over USB in full-report mode, and compatible Xbox controllers |
| Other sources | Windows Bluetooth battery data, standard HID Battery Strength, and optional HeadsetControl for compatible headsets |

See the [full compatibility table](docs/COMPATIBILITY.md) for supported model
variants, receivers, connection requirements and known limits. A brand name
alone does not imply compatibility. For Sony Bluetooth reports, see
[the setup notes](docs/SETUP.md#dualsense-over-bluetooth).

## Build from source

From a clean checkout on Windows with Node.js 22.17+ and Windows PowerShell 5.1:

```powershell
npm ci
npm run native:restore
npm run typecheck
npm test
npm run build
.\native\bin\BatteryHidHelper.exe --self-test
npm run validate
npm run pack
npm run release:stage
```

Install the resulting `Battery.win32.x64.flexplugin` from `release/v<version>/`
through FlexDesigner. The build uses public npm and NuGet dependencies and does
not require FlexDesigner, hardware, or adjacent projects. The companion
`SHA256SUMS.txt` records the archive checksum.

## Privacy and license

Battery reads from Windows, local HID devices and, for the G305 fallback,
the local G HUB service. The plugin does not send battery data to a cloud
service. HeadsetControl and the extended DualSense Bluetooth report mode are
optional; see [setup](docs/SETUP.md).

[MIT License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [Security](SECURITY.md).
Battery is an independent community plugin.
