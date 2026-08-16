/**
 * The desktop surface's command-line provider: it parses the `dsh desktop`
 * flag family and the explicit `desktop` subcommand, then provides both the
 * Web-server startup values (the `webStartup` service the dsh-web-app rows
 * inject) and the desktop launch request (`desktopStartup`). The desktop
 * bundle disables web-app's own `web-startup` row and mounts this provider
 * instead, so one parser owns the surface's inner arguments.
 * @module dsh-desktop/startup
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable Cordis plugin name. */
export declare const name = "desktop-startup";
/** Services required before the command line can be resolved. */
export declare const inject: string[];
/** Service carrying the desktop launch request to the runner row. */
export declare const DESKTOP_STARTUP_SERVICE = "desktopStartup";
/** Service name the dsh-web-app rows inject; this provider supplies it on the desktop surface. */
export declare const WEB_STARTUP_SERVICE = "webStartup";
/** What the runner row reads from {@link DESKTOP_STARTUP_SERVICE}. */
export interface DesktopStartupValues {
    /** Explicit `--url` override, absent when the window should auto-detect its target. */
    url?: string;
}
/** What the dsh-web-app rows read from {@link WEB_STARTUP_SERVICE} (mirrors `WebStartupValues`). */
export interface WebStartupValues {
    /** `--host`, absent when the invocation did not name one. */
    host?: string;
    /** `--port`, absent when the invocation did not name one. */
    port?: number;
    /** Explicit `--trusted-host` authorities, in argument order. */
    trustedHosts: string[];
}
/**
 * Parse and provide the desktop invocation as two ordinary Cordis services.
 * The command action publishes the flags this invocation named; an unsafe
 * `--host 0.0.0.0` or a non-numeric `--port` is a usage error, so on rejection
 * (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export declare function apply(ctx: Context): void;
