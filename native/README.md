# Battery Windows helper

`BatteryHidHelper.exe` — узкий Windows helper для чтения батареи Logitech по
HID++, Keychron по RF HID и Sony DualSense / Edge по input HID. Он не требует Python и отдаёт один JSON-объект в
stdout.

## Сборка

Из корня репозитория в Windows PowerShell:

```powershell
.\native\restore-dependencies.ps1
.\native\build.ps1
```

Сборка использует доступный в Windows PowerShell C# compiler и не требует
установленного .NET SDK. Результат находится в `native/bin`:

- `BatteryHidHelper.exe`;
- `HidSharp.dll`;
- `HidSharp.LICENSE.txt`.

## Проверка

```powershell
.\native\bin\BatteryHidHelper.exe --self-test
.\native\bin\BatteryHidHelper.exe
```

По умолчанию helper ищет Logi Bolt `0xC548`, перебирает pairing slots `1..6`,
находит MX Master 4 по model ID `0xB042` и читает Unified Battery `0x1004`.
Для G305 используется LIGHTSPEED receiver `0xC53F`, model ID `0x4074`, slot 1
и Battery Status `0x1000`:

```powershell
.\native\bin\BatteryHidHelper.exe --receiver-pid 0xC53F `
  --model-id 0x4074 --battery-feature 0x1000 --slot 1
```

Для Keychron M6 через Keychron Link `3434:D030` используется RF interface 1,
Feature Report `0x51` и input report `0x54`:

```powershell
.\native\bin\BatteryHidHelper.exe --keychron-rf `
  --receiver-pid 0xD030 --timeout-ms 500 --attempts 2
```

Опции диагностики:

Для всех подключённых DualSense `054C:0CE6` и Edge `054C:0DF2`:

```powershell
.\native\bin\BatteryHidHelper.exe --dualsense --timeout-ms 600 --attempts 2
```

По умолчанию это пассивное чтение. В базовом Bluetooth-режиме возвращается
`availability: unsupported`, `percentage: null`, `diagnostic: bluetooth-simple-mode`.
Для явно разрешённого контроллера можно добавить
`--enable-bt-device <unitId из результата>`. GET Feature `0x09` включает
расширенные отчёты до выключения контроллера и может повлиять на DirectInput.
Не передавайте разрешение автоматически всем обнаруженным устройствам.

Вывод Sony — `{source: "sony-dualsense-hid", devices: [...]}`. Ошибки одного
геймпада не прерывают чтение остальных. Контроллеры идентифицируются по serial
(MAC без разделителей); запасной вариант — SHA-256 пути HID. Полные отчёты с
кнопками/стиками не логируются. BT CRC32 проверяется до разбора батареи;
укороченный BT `0x01`, даже дополненный Windows до 78 байт, не считается USB.

Другие опции диагностики:

```text
--receiver-pid 0xC548
--model-id 0xB042
--battery-feature 0x1004
--slot 2
--timeout-ms 400
--attempts 2
--keychron-rf
```

Коды завершения: `0` — успех, `2` — неверные аргументы, `3` — receiver/model
не найден, `4` — HID/protocol error. stdout зарезервирован для JSON; ошибки
пишутся в stderr.
### Дополнительные режимы расширенной беты

- `--vendor-hid`: целевые команды чтения батареи на известных USB-коллекциях.
- `--rapoo-passive`: только чтение входных отчётов Rapoo; до 6 секунд.
- `--gamepad-hid`: пассивное чтение DualShock 4 / Switch Pro по USB.
- `--xbox`: Windows.Gaming.Input, с дискретным XInput как резервом.
- `--receiver-pid 0xC539 --model-id 0x407F --slot 1 --battery-feature 0x1001`:
  G502 LIGHTSPEED, приблизительная оценка из напряжения.

Вывод содержит идентификаторы устройств. Не публикуйте необработанный вывод
или логи. Совместимость описана в [таблице устройств](../docs/COMPATIBILITY.md).
