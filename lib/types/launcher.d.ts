/**
 * Electron process resolution and launch for `dsh-desktop`.
 * The pure resolution helpers live here so tests exercise them without an
 * Electron installation; only the thin {@link spawnElectron} wrapper touches
 * the process boundary.
 * @module dsh-desktop/launcher
 */
import { spawn, type ChildProcess } from 'node:child_process';
/** Absolute path of the bundled Electron main-process script (package root, a sibling of src/ and lib/). */
export declare const ELECTRON_MAIN_SCRIPT: string;
/** `file:` URL of the bundled fallback dashboard, loaded when no Web server or explicit URL exists. */
export declare const DASHBOARD_URL: string;
/** Launch-resolution inputs. */
export interface LaunchOptions {
    /** Explicit `--url` override; wins over server auto-detection and the dashboard. */
    readonly url?: string | undefined;
    /** Bound Web-server port, when this surface shares a tree with the Web server. */
    readonly webServerPort?: number | undefined;
}
/**
 * Resolve the URL the Electron window loads, in precedence order: an explicit
 * URL, the bound Web server, then the bundled dashboard.
 * @param options - the resolution inputs.
 * @returns the resolved URL.
 */
export declare function resolveTargetUrl(options: LaunchOptions): string;
/**
 * Resolve the Electron binary path, or `undefined` when Electron is
 * unavailable. Precedence: an explicit path, the `electron` package resolved
 * from the caller's module tree, then a `PATH` lookup. A missing explicit path
 * is a resolution failure, not a silent fallback.
 * @param explicit - optional absolute path supplied by composition config.
 * @param requireElectron - injectable module resolver; defaults to the caller's own `createRequire`.
 * @param platform - injectable platform, for binary basenames.
 * @param pathEntries - injectable `PATH` value, for the fallback lookup.
 * @returns the absolute binary path, or `undefined`.
 */
export declare function resolveElectronBinary(explicit: string | undefined, requireElectron?: (specifier: string) => unknown, platform?: NodeJS.Platform, pathEntries?: string): string | undefined;
/**
 * Build the argument vector handed to the Electron binary: the main-process
 * script, then any deployment-supplied Chromium/Electron switches (e.g.
 * `--no-sandbox`). The window target and geometry deliberately travel as
 * environment variables ({@link DESKTOP_URL_ENV} and friends), not as `--url`
 * flags: Chromium's argv parser misreads a `--flag value` pair that follows
 * `--url <value>`, aborting the process before the main script runs.
 * @param extraArgs - extra Electron/Chromium switches appended verbatim.
 * @param script - the main-process script path; defaults to {@link ELECTRON_MAIN_SCRIPT}.
 * @returns the argument vector.
 */
export declare function buildElectronArgs(extraArgs?: readonly string[], script?: string): string[];
/** Environment key carrying the window URL to the Electron main script. */
export declare const DESKTOP_URL_ENV = "DSH_DESKTOP_URL";
/** Environment key carrying the window width to the Electron main script. */
export declare const DESKTOP_WIDTH_ENV = "DSH_DESKTOP_WIDTH";
/** Environment key carrying the window height to the Electron main script. */
export declare const DESKTOP_HEIGHT_ENV = "DSH_DESKTOP_HEIGHT";
/**
 * Spawn the Electron binary as an isolated child process with inherited
 * stdio and the given environment. The child owns its own environment and
 * globals; the dsh process only holds the returned handle for teardown.
 * @param binary - the resolved Electron binary path.
 * @param args - the argument vector from {@link buildElectronArgs}.
 * @param env - the child environment; the runner adds the {@link DESKTOP_URL_ENV} family.
 * @param spawnImpl - injectable spawn; defaults to `node:child_process.spawn`.
 * @returns the child-process handle.
 */
export declare function spawnElectron(binary: string, args: readonly string[], env: NodeJS.ProcessEnv, spawnImpl?: typeof spawn): ChildProcess;
