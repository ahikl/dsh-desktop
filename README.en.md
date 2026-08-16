# dsh-desktop

[中文](README.md) | English

A dsh desktop bundle: an Electron shell over the dsh Web UI, with a system tray and a dsh-styled custom title bar. Installed as an out-of-tree plugin — it changes no dsh source and keeps Electron out of the dsh dependency tree.

## What it is

A **bundle** (it declares `dsh.bundle.patch`): when added to a profile, it lays the desktop surface over `dsh-web-app`. It mounts two rows — `desktop-startup` (parses the `desktop` command) and `desktop-runner` (spawns Electron once the tree settles).

The Electron window is frameless with a custom title bar that reads the dsh design tokens (`--dsw-alias-*`), so it follows the current light/dark theme and re-paints on theme switches. Closing the window hides it to the system tray; the tray menu shows the window, opens the Web UI in a browser, or quits.

## Compatibility

Built against dsh `0.1.0-rc.5`. The dsh framework packages are `peerDependencies`: they resolve from the receiver's dsh installation at runtime, never from this package's own install.

## Install (receiver side)

A desktop profile stacks `dsh-base` + `dsh-web-app` + this bundle:

```sh
# from npm (once published)
dsh plugin --profile desktop add @ahikl/dsh-desktop @deepseek-ai/dsh-web-app
# or straight from git
dsh plugin --profile desktop add github:ahikl/dsh-desktop @deepseek-ai/dsh-web-app

# Electron is a per-profile runtime requirement (platform binary, not bundled)
dsh plugin --profile desktop add electron

dsh --profile desktop desktop
```

## Develop and build

Inside the dsh monorepo checkout, the `tsconfig.json` `paths` map the framework packages to source, so the following run without published copies:

```sh
pnpm install
pnpm run typecheck   # tsc -p tsconfig.json --noEmit
pnpm run test        # vitest run (pure unit tests in tests/)
pnpm run build       # tsc emits lib/types, tsdown bundles lib/{index,startup}.js
```

`lib/` is gitignored; publish runs `build` via `prepack`.

## Publish

```sh
# npm
pnpm publish         # runs prepack -> build first

# or GitHub only: push, then receivers install github:you/dsh-desktop#tag
```

Before publishing, drop the `paths` block in `tsconfig.json` and add the framework packages as `devDependencies` with their real published versions (they are currently `@deepseek-ai/*` pre-release packages).

## Configuration

The `desktop-runner` row (the bundle's `plugins.electron`-equivalent namespace) accepts:

```yaml
- id: desktop-runner
  config:
    url: https://example.com   # optional; override Web-UI auto-detection
    electronPath: /opt/electron/electron   # optional; override resolution
    width: 1280                # optional; omit for a display-relative default
    height: 800
    electronArgs: ["--no-sandbox", "--disable-gpu"]   # optional Electron switches
```

## License

MIT
