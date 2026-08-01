# Luna production app icon

This package contains the production macOS icon artwork for the Luna Electron app.

- `icon.icns` — use for the packaged macOS application.
- `icon.png` — transparent 1024 × 1024 master PNG.
- `icon-source-1254.png` — full-resolution transparent source.
- `Luna.iconset/` — complete standard and Retina macOS PNG size set.

For electron-builder, place `icon.icns` in your build resources folder and point the macOS icon setting to it. For Electron Forge, use this file as the macOS packager icon.
