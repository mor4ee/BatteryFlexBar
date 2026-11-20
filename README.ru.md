# Battery для FlexBar

[English](README.md) · **Русский** · [Español](README.es.md) · [简体中文](README.zh-CN.md)

![Battery для FlexBar: примеры отображения заряда, зарядки и отключённого устройства](.marketplace/repository-cover.svg)

Показывает заряд мыши, клавиатуры или геймпада на FlexBar. Добавьте по
одному юниту **Уровень заряда** на устройство, выберите устройство во
вкладке **Function**, а шрифт, цвет и иконку настройте во **Foreground**.

[Установка и настройка](docs/SETUP.md) · [Совместимость](docs/COMPATIBILITY.md) · [Сборка из исходников](README.md#build-from-source)

- Показывает проценты или дискретный уровень, если устройство не сообщает процент.
- При зарядке вместо `%` появляется молния. Когда устройство недоступно,
  показание заменяет перечёркнутая вилка. Выбранная иконка и оформление остаются.
- Данные обновляются примерно раз в минуту; тап запускает внеочередной опрос.
- Для нескольких устройств можно разместить несколько юнитов.

Нужны Windows 10/11 (x64), FlexBar и FlexDesigner с **Plugin API v1**.
Проверенная базовая версия — **2.2.3**. Полный тест на 2.2.5 Pre-release
ещё не проведён. FlexStudio SDK v2 не используется.

## Поддерживаемые устройства

| Проверено | Способ подключения |
| --- | --- |
| Logitech MX Master 4 | Logi Bolt |
| Logitech G305 LIGHTSPEED | Родной донгл, в том числе с закрытым G HUB |
| Keychron M6 | Приёмник 1K Keychron Link |
| Lamzu Paro | Донгл 2,4 ГГц и USB; отключение и восстановление на панели проверены с донглом |
| Sony DualSense | USB и Bluetooth с расширенными отчётами; процент приблизительный |

**Beta:** G502 LIGHTSPEED, Keychron M7 и другие отдельные модели Keychron RF,
Lamzu Aurora, отдельные профили мышей и клавиатур Glorious, Rapoo, Razer,
Corsair, HyperX, SteelSeries, ASUS ROG и других производителей.
Для геймпадов в Beta: DualSense Edge, DualShock 4, Switch Pro и Xbox.
Windows Bluetooth, стандартный HID и опциональный HeadsetControl тоже в Beta.
Сверяйте конкретную модель и способ подключения по
[таблице совместимости](docs/COMPATIBILITY.md).

Готовый пакет можно скачать из [GitHub Releases](https://github.com/mor4ee/BatteryFlexBar/releases/latest)
и импортировать во FlexDesigner. Также доступна [локальная сборка из исходников](README.md#build-from-source).
Данные читаются локально и не отправляются в облако.

[Лицензия MIT](LICENSE) · [Сторонние компоненты](THIRD_PARTY_NOTICES.md).
