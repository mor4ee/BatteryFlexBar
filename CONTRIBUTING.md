# Contributing

For a device or transport request, include the exact model, connection type,
Windows version and whether vendor software reports the battery. Do not post
serial numbers, full device-instance paths, or unredacted logs.

Please run the [Windows build and verification checklist](README.md#build-from-source)
before proposing code. New profiles must distinguish fresh readings from
disconnected devices, restrict active queries to the intended HID interface,
and include protocol sources and test fixtures. Mark a route as beta until it
has been checked on hardware.

Battery targets FlexDesigner Plugin API v1. Keep the native text unit and
layout lifecycle safeguards unless a change is explicitly tested on FlexBar.
