/**
 * Electron process resolution and launch for `dsh-desktop`.
 * The pure resolution helpers live here so tests exercise them without an
 * Electron installation; only the thin {@link spawnElectron} wrapper touches
 * the process boundary.
 * @module dsh-desktop/launcher
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** The `electron` package's entry exports the absolute path of the platform binary. */
const ELECTRON_PACKAGE = 'electron';
/** Loopback host the Web server binds on the desktop surface. */
const LOOPBACK_HOST = '127.0.0.1';
/** Absolute path of the bundled Electron main-process script (package root, a sibling of src/ and lib/). */
export const ELECTRON_MAIN_SCRIPT = fileURLToPath(new URL('../electron-main.cjs', import.meta.url));
/** `file:` URL of the bundled fallback dashboard, loaded when no Web server or explicit URL exists. */
export const DASHBOARD_URL = new URL('../dashboard.html', import.meta.url).href;
/**
 * Resolve the URL the Electron window loads, in precedence order: an explicit
 * URL, the bound Web server, then the bundled dashboard.
 * @param options - the resolution inputs.
 * @returns the resolved URL.
 */
export function resolveTargetUrl(options) {
    if (options.url !== undefined)
        return options.url;
    if (options.webServerPort !== undefined)
        return `http://${LOOPBACK_HOST}:${String(options.webServerPort)}`;
    return DASHBOARD_URL;
}
/** Electron binary basenames to probe on the PATH, per platform. */
function electronBinaryCandidates(platform) {
    return platform === 'win32' ? ['electron.exe', 'electron.cmd'] : ['electron'];
}
/**
 * Locate one basename across a `PATH`-style entry list, returning the first
 * existing file. Directories are probed in order; missing entries are skipped.
 * @param name - the binary basename to find.
 * @param pathEntries - the delimited `PATH` value, empty when unset.
 * @returns the absolute path, or `undefined` when no entry holds the file.
 */
function findOnPath(name, pathEntries) {
    if (pathEntries === '')
        return undefined;
    for (const dir of pathEntries.split(delimiter)) {
        if (dir === '')
            continue;
        const candidate = join(dir, name);
        if (existsSync(candidate))
            return candidate;
    }
    return undefined;
}
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
export function resolveElectronBinary(explicit, requireElectron = specifier => createRequire(import.meta.url)(specifier), platform = process.platform, pathEntries = process.env.PATH ?? '') {
    if (explicit !== undefined) {
        return existsSync(explicit) ? explicit : undefined;
    }
    try {
        const resolved = requireElectron(ELECTRON_PACKAGE);
        if (typeof resolved === 'string' && existsSync(resolved))
            return resolved;
    }
    catch {
        // Electron is not installed in the module tree; fall through to PATH.
    }
    for (const name of electronBinaryCandidates(platform)) {
        const found = findOnPath(name, pathEntries);
        if (found !== undefined)
            return found;
    }
    return undefined;
}
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
export function buildElectronArgs(extraArgs = [], script = ELECTRON_MAIN_SCRIPT) {
    return [script, ...extraArgs];
}
/** Environment key carrying the window URL to the Electron main script. */
export const DESKTOP_URL_ENV = 'DSH_DESKTOP_URL';
/** Environment key carrying the window width to the Electron main script. */
export const DESKTOP_WIDTH_ENV = 'DSH_DESKTOP_WIDTH';
/** Environment key carrying the window height to the Electron main script. */
export const DESKTOP_HEIGHT_ENV = 'DSH_DESKTOP_HEIGHT';
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
export function spawnElectron(binary, args, env, spawnImpl = spawn) {
    return spawnImpl(binary, [...args], { stdio: 'inherit', env });
}
