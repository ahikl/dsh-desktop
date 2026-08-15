/**
 * The desktop surface's command-line provider: it parses the `dsh desktop`
 * flag family and the explicit `desktop` subcommand, then provides both the
 * Web-server startup values (the `webStartup` service the dsh-web-app rows
 * inject) and the desktop launch request (`desktopStartup`). The desktop
 * bundle disables web-app's own `web-startup` row and mounts this provider
 * instead, so one parser owns the surface's inner arguments.
 * @module dsh-desktop/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'desktop-startup'

/** Services required before the command line can be resolved. */
export const inject = ['cmdlineArgs']

/** Service carrying the desktop launch request to the runner row. */
export const DESKTOP_STARTUP_SERVICE = 'desktopStartup'

/** Service name the dsh-web-app rows inject; this provider supplies it on the desktop surface. */
export const WEB_STARTUP_SERVICE = 'webStartup'

/** What the runner row reads from {@link DESKTOP_STARTUP_SERVICE}. */
export interface DesktopStartupValues {
  /** Explicit `--url` override, absent when the window should auto-detect its target. */
  url?: string
}

/** What the dsh-web-app rows read from {@link WEB_STARTUP_SERVICE} (mirrors `WebStartupValues`). */
export interface WebStartupValues {
  /** `--host`, absent when the invocation did not name one. */
  host?: string
  /** `--port`, absent when the invocation did not name one. */
  port?: number
  /** Explicit `--trusted-host` authorities, in argument order. */
  trustedHosts: string[]
}

/** The desktop flag family, as commander parsed it. */
interface DesktopOptions {
  host?: string
  port?: string
  trustedHost?: string[]
  url?: string
}

/**
 * Attach the surface's option family to one command. The same set mounts on
 * the root program and on the explicit `desktop` subcommand so either form
 * accepts the same flags.
 * @param command - the command to extend.
 * @returns the extended command, for chaining.
 */
function withDesktopOptions(command: Command): Command {
  return command
    .option('--host <host>', 'bind host for the Web server')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .option('--url <url>', 'load an explicit URL instead of the auto-detected Web UI or the bundled dashboard')
}

/**
 * This surface's command: its flags, description, and help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function desktopCommand(): Command {
  return withDesktopOptions(new Command()
    .name('dsh desktop')
    .description('Launch the DeepSeek Harness desktop app: an Electron window over the Web UI.')
    .helpOption('-h, --help', 'show this help'))
    .addHelpText('after', `
Examples:
  dsh --profile desktop                 launch the desktop app
  dsh --profile desktop desktop         the same, through the explicit subcommand
  dsh --profile desktop --url https://example.com   load a custom URL
`)
}

/**
 * Parse and provide the desktop invocation as two ordinary Cordis services.
 * The command action publishes the flags this invocation named; an unsafe
 * `--host 0.0.0.0` or a non-numeric `--port` is a usage error, so on rejection
 * (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = desktopCommand()
  // Commander attaches options to the parent program, not to the subcommand,
  // even when they appear after the subcommand token. Both the default action
  // and the explicit `desktop` subcommand therefore read the root opts.
  const publish = (): void => {
    const options = program.opts<DesktopOptions>()
    if (options.host === '0.0.0.0') {
      program.error('error: --host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead')
    }
    if (options.port !== undefined && !/^\d+$/.test(options.port)) {
      program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
    }
    ctx.provide(WEB_STARTUP_SERVICE, {
      ...options.host !== undefined ? { host: options.host } : {},
      ...options.port !== undefined ? { port: Number(options.port) } : {},
      trustedHosts: options.trustedHost ?? [],
    } satisfies WebStartupValues)
    ctx.provide(DESKTOP_STARTUP_SERVICE, {
      ...options.url !== undefined ? { url: options.url } : {},
    } satisfies DesktopStartupValues)
  }
  program.action(publish)
  program.command('desktop').description('launch the desktop app (explicit alias of the default)').action(publish)
  parseCmdline(ctx, program)
}
