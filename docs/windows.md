# Windows development and packaging

Luna supports Windows 10 and Windows 11, 64-bit (x64) only.

Build Windows release artifacts on Windows. Build the macOS DMG on macOS. Cross-building is not
supported here, because Electron's packaging and code-signing steps are only verifiable on the
operating system they target.

## Prerequisites

- Node.js version 22 or newer, which includes npm.
- Git for Windows.

You do **not** need Visual Studio or its C++ build tools. Luna has no third-party native Node
addon. The database uses the SQLite support built into Electron's own Node runtime.

## First setup

Run these from PowerShell:

```powershell
npm.cmd install
```

```powershell
npm.cmd run dev
```

### Why `npm.cmd` instead of `npm`

Many Windows PowerShell configurations refuse to run Node's `npm.ps1` script. This is a local
execution-policy setting on your machine. It is not a problem with Luna.

You have three options. Any of them works:

1. Use `npm.cmd` instead of `npm`, as shown above.
2. Use `npm` from Command Prompt instead of PowerShell.
3. Use `npm` from Git Bash.

You do not need to change your machine's execution policy.

### What `npm install` does to Git

`npm install` runs `scripts/setup-hooks.mjs`. That script points Git at the committed
`.githooks/` directory. It is a Node script, so it runs the same way on Windows and macOS.

The hook files themselves are POSIX shell scripts. That is fine on Windows: Git for Windows
supplies the shell and Unix utilities that run them. `sh` does not need to be on PowerShell's
`PATH`.

## Development and checks

```powershell
npm.cmd run dev
```

```powershell
npm.cmd run typecheck
```

```powershell
npm.cmd run lint
```

```powershell
npm.cmd run test
```

Changes to renderer code hot-reload. Changes to main-process or preload code restart Electron.

## Windows-specific interface behavior

Luna uses Electron's Windows title-bar overlay. This puts Luna's sidebar control in the same
strip as the native minimize, maximize, and close buttons. The Fast/Expert mode switch sits in
the composer's bottom toolbar, next to the send button.

The inset title bar and traffic-light positioning are macOS-only and are never applied on
Windows.

## Where Luna stores data on Windows

Luna's data directory is normally:

```text
%APPDATA%\Luna
```

That folder contains `luna.db`, a `backups` folder, and a `provider-keys` folder. API keys in
`provider-keys` are encrypted using DPAPI, the Windows Data Protection API.

Build output never contains that data.

## Build outputs

```powershell
npm.cmd run build
```

```powershell
npm.cmd run package
```

```powershell
npm.cmd run dist
```

| Command   | What it produces                                                    |
| --------- | ------------------------------------------------------------------- |
| `build`   | Type-checked, linted bundles in `out/`                              |
| `package` | An unpacked application at `release/win-unpacked/Luna.exe`          |
| `dist`    | An NSIS installer at `release/Luna-Setup-<version>-x64.exe`         |

Both `out/` and `release/` are ignored by Git. Delete either one whenever you want a clean
rebuild.

## Distribution notes

### SmartScreen

Local builds are not Authenticode-signed. Windows will therefore show a blue "Windows protected
your PC" box when the installer is run, especially after it has been downloaded or copied to
another computer. This is expected for an unsigned installer.

To proceed past it, select **More info**, then **Run anyway**.

Public releases should be signed with a Windows code-signing certificate and tested on a clean
Windows user account before publishing. Signing credentials must be kept outside this
repository.

### Antivirus and packaging time

Electron applications are large. Antivirus software often scans `Luna.exe` while it is being
written during packaging. A first package that takes several minutes is not necessarily a hung
build.

### Icons

The Windows executable icon is `build/icon.ico`, a multi-resolution moon-only icon. Its
transparent 1024-pixel source is `assets/LunaAppIcon/icon-windows.png`. macOS uses
`build/icon.icns` instead.

If Windows Explorer keeps showing an older icon after you change it, rebuild the package.
Explorer also caches icons, so the old one may persist until its cache updates.

## Troubleshooting

### `sh` is not recognized during `npm install`

Your checkout is using the old lifecycle configuration. Confirm that `package.json` runs
`node scripts/setup-hooks.mjs` in its `prepare` script, then run `npm.cmd install` again.

### `npm.ps1 cannot be loaded because running scripts is disabled`

Run the same command with `npm.cmd`, or use Command Prompt or Git Bash. See "Why `npm.cmd`
instead of `npm`" above.

### The Git hooks are not running

Re-enable them:

```powershell
npm.cmd run setup
```

Then confirm. This must print `.githooks`:

```powershell
git config --get core.hooksPath
```
