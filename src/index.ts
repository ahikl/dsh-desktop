/**
 * dsh-desktop — the desktop-surface bundle's runtime
 * glue plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin owns the Electron launch: it
 * waits for the composed tree to settle, resolves the window URL (explicit
 * `--url`, the bound Web server, or an auto-started `dsh web`), resolves the
 * Electron binary, and spawns it as an isolated child process. A missing
 * Electron installation is a clear stderr diagnostic, never a tree failure.
 * @module dsh-desktop
 */

import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  buildElectronArgs,
  DESKTOP_HEIGHT_ENV,
  DESKTOP_URL_ENV,
  DESKTOP_WIDTH_ENV,
  resolveElectronBinary,
  resolveTargetUrl,
  spawnElectron,
} from './launcher.ts'

/**
 * Cordis `FiberState.ACTIVE`. FiberState is a compile-time const enum: tsc
 * inlines it, but the self-contained `prepare` build (oxc, no type info)
 * cannot, and the enum is erased from cordis's runtime export. Mirror the
 * numeric value so both builds stay correct.
 */
const FIBER_ACTIVE = 2

/** Stable Cordis plugin name. */
export const name = 'desktop-runner'

/** Services required before the desktop can launch. */
export const inject = ['desktopStartup']

/**
 * Plugin config. `url` is normally supplied per invocation from the
 * `desktopStartup` provider (`--url`); the rest are composition-level
 * deployment settings changeable from cordis.yml.
 */
export interface Config {
  /** Explicit URL the window loads; overrides Web-server auto-detection and the dashboard. */
  url?: string
  /** Absolute Electron binary path; overrides module and PATH resolution. */
  electronPath?: string
  /** Initial window width in CSS pixels; omit for a display-relative default. */
  width?: number
  /** Initial window height in CSS pixels; omit for a display-relative default. */
  height?: number
  /** Extra Electron/Chromium switches appended to the launch (e.g. `--no-sandbox`, `--disable-gpu`). */
  electronArgs: string[]
}

export const Config: z<Config> = z.object({
  // Object fields are optional by default in schemastery; `required()` would
  // reject an absent value, and these intentionally accept absence.
  url: z.string(),
  electronPath: z.string(),
  width: z.natural(),
  height: z.natural(),
  electronArgs: z.array(String).default([]),
})

/**
 * Structural view of the bound Web server, read through `ctx.get('webServer')`
 * so this bundle stays decoupled from `dsh-host-webserver` and can run beside
 * dsh-web-app or standalone. The real service exposes `port` after it listens.
 */
interface BoundWebServer {
  readonly port: number
}

/**
 * The child-process surface the runner uses: exit observation and termination.
 * Decoupled from `node:child_process`'s full `ChildProcess` so tests can
 * substitute a minimal stand-in.
 */
export interface ElectronChild {
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  on(event: 'exit', listener: (code: number | null) => void): unknown
  kill(): boolean
}

/** Process-facing effects, injectable so tests exercise launch without a real Electron binary. */
export const internals: {
  stderr: { write(chunk: string): unknown }
  spawn: (binary: string, args: readonly string[], env: NodeJS.ProcessEnv) => ElectronChild
  spawnWebUi: (commandLine: string) => ChildProcess
  resolveElectronBinary: typeof resolveElectronBinary
} = {
  stderr: process.stderr,
  spawn: spawnElectron,
  spawnWebUi: (commandLine) => spawn(commandLine, { stdio: ['ignore', 'pipe', 'pipe'], shell: true }),
  resolveElectronBinary,
}

/** The diagnostic printed when Electron cannot be resolved; it names the recovery actions. */
function missingElectronMessage(): string {
  return 'dsh desktop: Electron is not available, so no window was opened. '
    + 'Install Electron for this profile (`dsh plugin --profile desktop add electron`) '
    + 'or set `electronPath` in the desktop-runner row config, then re-run.\n'
}

/**
 * Resolve the window target and the Electron binary, then spawn the window in
 * an isolated child process. The child owns its environment and globals; the
 * dsh process only retains the handle so tree teardown kills it and so its
 * exit can request a clean shutdown.
 * @param ctx - plugin context carrying the settled tree and the launch request.
 * @param config - validated {@link Config}.
 */
async function launch(ctx: Context, config: Config): Promise<void> {
  // Register the teardown disposer while the fiber is active; it closes over
  // the mutable child handles, so any spawned Electron/Web UI process is
  // covered by teardown too.
  let child: ElectronChild | undefined
  let webUiChild: ChildProcess | undefined
  ctx.effect(() => () => {
    if (child !== undefined) killChild(child)
    if (webUiChild !== undefined) killChild(webUiChild)
  }, 'desktop-runner.kill-child')

  // When no Web server is already bound and no explicit URL was supplied,
  // spawn `dsh web` ourselves, parse the printed loopback URL, and keep the
  // child alive for the lifetime of the desktop session.
  const startWebUiAndResolveUrl = async (): Promise<string> => {
    const candidates = [
      process.platform === 'win32' ? 'dsh.cmd web --port 0' : 'dsh web --port 0',
        process.platform === 'win32' ? 'pnpm.cmd dsh web --port 0' : 'pnpm dsh web --port 0',
      process.platform === 'win32' ? 'npx.cmd --yes @deepseek-ai/dsh web --port 0' : 'npx --yes @deepseek-ai/dsh web --port 0',
    ]
    let lastError: unknown
    for (const commandLine of candidates) {
      try {
        return await new Promise<string>((resolve, reject) => {
          const proc = internals.spawnWebUi(commandLine)
          webUiChild = proc
          let settled = false
                        let output = ''
          let cleanup: () => void = () => {}
          const timeout = setTimeout(() => {
            if (settled) return
            settled = true
            cleanup()
            killChild(proc)
            reject(new Error(`Timed out waiting for ${commandLine} to print a Web UI URL${output ? `\n${output}` : ''}`))
          }, 30_000)
          cleanup = (): void => {
            clearTimeout(timeout)
            proc.stdout?.off('data', onData)
            proc.stderr?.off('data', onData)
            proc.off('error', onError)
            proc.off('exit', onExit)
          }
          const onData = (chunk: Buffer | string): void => {
            const text = chunk.toString()
              output += text
              const match = /https?:\/\/[^\s]+/.exec(text)
            if (match !== null && !settled) {
              settled = true
              cleanup()
              resolve(match[0])
            }
          }
          const onError = (error: Error): void => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
          }
          const onExit = (code: number | null): void => {
            if (settled) return
            settled = true
            cleanup()
            reject(new Error(`dsh web exited with code ${String(code)}${output ? `\n${output}` : ''}`))
          }
          proc.stdout?.on('data', onData)
          proc.stderr?.on('data', onData)
          proc.on('error', onError)
          proc.on('exit', onExit)
        })
      } catch (error) {
        lastError = error
        if (webUiChild !== undefined) {
          killChild(webUiChild)
          webUiChild = undefined
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // The Web server binds in its own fiber init; await full settlement so the
  // port read below is the bound one. A bare (test) context has no Loader and
  // proceeds at once. A sibling failure (e.g. the port is already in use)
  // settles the tree with a failed row and then disposes it; the boot reports
  // that failure, so the runner stays quiet and does not spawn.
  try {
    await ctx.get('loader')?.await()
  } catch {
    return
  }
  if (ctx.fiber.state !== FIBER_ACTIVE) return
  const webServer = ctx.get('webServer') as BoundWebServer | undefined
  const targetUrl = config.url !== undefined || typeof webServer?.port === 'number'
    ? resolveTargetUrl({
        url: config.url,
        webServerPort: typeof webServer?.port === 'number' ? webServer.port : undefined,
      })
    : await startWebUiAndResolveUrl()
  const binary = internals.resolveElectronBinary(
    config.electronPath,
    specifier => createRequire(ctx.baseUrl ?? import.meta.url)(specifier),
  )
  if (binary === undefined) {
    internals.stderr.write(missingElectronMessage())
    return
  }
  child = internals.spawn(binary, buildElectronArgs(config.electronArgs), {
    ...process.env,
    // The window target and geometry cross the process boundary as environment
    // variables: a `--url <value>` argv pattern followed by another `--flag
    // value` pair makes Chromium abort before the main script runs. Geometry is
    // forwarded only when explicitly configured; the main script otherwise
    // sizes the window relative to the display (scale-aware).
    [DESKTOP_URL_ENV]: targetUrl,
    ...config.width !== undefined ? { [DESKTOP_WIDTH_ENV]: String(config.width) } : {},
    ...config.height !== undefined ? { [DESKTOP_HEIGHT_ENV]: String(config.height) } : {},
  })
  child.on('exit', (code) => {
    if (code === 0) {
      // The window closed normally; shut the desktop app down cleanly.
      ctx.get('appExit')?.(0)
    } else if (code !== null) {
      // Electron crashed; keep the Web server serving and tell the user how to
      // recover (the switch list comes from the electronArgs config).
      internals.stderr.write(electronExitMessage(code, targetUrl))
    }
  })
}

/**
 * The diagnostic printed when the Electron child exits abnormally. The Web
 * UI stays reachable at `url`, so the message names it as a browser fallback.
 */
function electronExitMessage(code: number, url: string): string {
  return `dsh desktop: Electron exited with code ${String(code)}, so no window is open. `
    + `The Web UI is still available at ${url} — open it in a browser, or fix the window `
    + 'with `electronArgs` in the desktop-runner row config (for example ["--no-sandbox", "--disable-gpu"]).\n'
}

/** Terminate the Electron child on tree teardown; a no-op once it has exited. */
function killChild(child: ElectronChild): void {
  if (child.exitCode === null && child.signalCode === null) child.kill()
}

/**
 * Mount the desktop runner: resolve the launch request and spawn Electron once
 * the tree settles. A failed launch is reported to stderr and contained — it
 * never fails the fiber, so other commands and the Web server keep running.
 * @param ctx - plugin context carrying the launch request.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  void launch(ctx, config).catch((error: unknown) => {
    internals.stderr.write(`dsh desktop: failed to launch Electron: ${error instanceof Error ? error.message : String(error)}\n`)
  })
}
