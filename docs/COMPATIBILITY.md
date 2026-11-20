# Device compatibility

The plugin supports specific models **and** connection types. A brand listed
here does not imply support for its other products. Windows 10/11 x64 and
FlexDesigner Plugin API v1 are the target. FlexDesigner 2.2.3 is the verified
baseline; the full 2.2.5 Pre-release regression is still pending.

## Hardware-tested routes

| Peripheral | Connection | What was verified |
| --- | --- | --- |
| Logitech MX Master 4 | Logi Bolt | Battery reading on FlexBar; direct HID++ with no required Options+ |
| Logitech G305 LIGHTSPEED | Original receiver | Direct HID++ with G HUB closed, including manual refresh after reconnect |
| Keychron M6 | 1K Keychron Link receiver | RF battery reading and text Unit |
| Lamzu Paro | 2.4 GHz receiver; USB cable | Both read via HID; on-panel disconnect and recovery checked with the receiver |
| Sony DualSense | USB; Bluetooth with extended reports | Battery read on both connections; the report provides a range, not an exact percentage |

DualSense Edge uses a beta profile. For Bluetooth setup and the optional
extended mode, see [Setup](SETUP.md#dualsense-over-bluetooth).

## Beta routes

These routes implement known reports or operating-system APIs. Some have
been verified by upstream projects but are not hardware-certified here.

| Source | Scope and limits |
| --- | --- |
| Windows Bluetooth | Connected devices for which Windows exposes a battery property. Charging state may be unavailable. |
| Standard HID Battery Strength | Compatible USB devices/receivers that declare usage `06:20`. |
| Logitech HID++ | G502 LIGHTSPEED (`C539`, model `407F`); percentage is estimated from voltage. |
| Extended Keychron RF | Selected M1, M2, M2 mini, M3, M3 mini, M4, M6 and M7 routes through supported 1K/4K/8K receivers. Firmware and receiver matter. |
| Lamzu Aurora | Known USB profiles for Maya, Maya X, Tachi, Inca, Thorn, Thorn V2, Atlantis OG Champion, Atlantis Mini, and the alternate Paro receiver. |
| CompX HID | Selected VXE, VGN, Pulsar, Hitscan, ATK, Redragon, Taidu, HECATE and Corsair mice. |
| SONiX HID | Selected AJAZZ, AULA, EPOMAKER, NuPhy, Lofree and Royal Kludge receivers. Charging state may be unavailable. |
| Glorious | Selected Model O/D/O−/D− Wireless, Model O 2 Wireless and Model D 2 PRO routes. |
| BY | AULA and MCHOSE receivers with known `FF02:0002` interfaces and supported product IDs. |
| Evision | Wired `320F:5055` profiles for selected ATK V75X, VGN S99/V98pro/N75 and VXE keyboards. The wireless receiver is not polled. |
| Rapoo | Selected VT1 Pro Max, VT3 Pro, VT3 Pro Max, VT3 Max Gen 2 and VT9 Gen 2 routes. Passive reports can miss a poll. |
| Razer | Viper Ultimate (USB/receiver) and BlackWidow V3 Pro (receiver). |
| Corsair | Scimitar Elite SE Wireless on the supported Slipstream receiver/channel. |
| HyperX | Pulsefire Haste 2, Core Wireless and Mini via their supported receivers. A Core can temporarily report 40% after power-on. |
| SteelSeries | Aerox 3 Wireless (original and Gen 2) and Aerox 5 Wireless, USB or dedicated receiver. |
| ASUS ROG | Azoth and Harpe Ace Aim Lab via USB or an eligible dedicated receiver. Shared Omni receivers are not generally supported. |
| DualShock 4 | USB, in 10% steps; Bluetooth is outside this profile. |
| Nintendo Switch Pro | USB, in 25% steps, only if the host already enabled full input reports. Battery does not switch the mode. |
| Xbox | Windows.Gaming.Input when capacity is available; otherwise XInput levels `EMPTY`, `LOW`, `MID`, `FULL`, keyed by player slot. |
| HeadsetControl | Optional, separately installed command-line tool. See [Setup](SETUP.md#optional-headsets). |

USB and receiver paths can appear as separate entries. Windows Bluetooth may
show a second reading alongside a specialized reader. No response is not the
same as 0%; a sleeping or disconnected peripheral can look unavailable.

Protocol references: [BatteryHub route notes](https://github.com/krisgfx9/Wireless-Device-Battery-Monitor/tree/d91490de7fb4a4032119168c43cdb49a5a1cbaab/src/drivers),
[HaloBattery captures](https://github.com/HeyOkay/HaloBattery/blob/main/docs/protocols.md) and
[Windows XInput battery API](https://learn.microsoft.com/windows/win32/api/xinput/ns-xinput-xinput_battery_information).
