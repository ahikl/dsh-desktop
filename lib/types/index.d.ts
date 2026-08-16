/**
 * dsh-desktop — the desktop-surface bundle's runtime
 * glue plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin owns the Electron launch: it
 * waits for the composed tree to settle, resolves the window URL (explicit
 * `--url`, the bound Web server, then the bundled dashboard), resolves the
 * Electron binary, and spawns it as an isolated child process. A missing
 * Electron installation is a clear stderr diagnostic, never a tree failure.
 * @module dsh-desktop
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { resolveElectronBinary } from './launcher.ts';
/** Stable Cordis plugin name. */
export declare const name = "desktop-runner";
/** Services required before the desktop can launch. */
export declare const inject: string[];
/**
 * Plugin config. `url` is normally supplied per invocation from the
 * `desktopStartup` provider (`--url`); the rest are composition-level
 * deployment settings changeable from cordis.yml.
 */
export interface Config {
    /** Explicit URL the window loads; overrides Web-server auto-detection and the dashboard. */
    url?: string;
    /** Absolute Electron binary path; overrides module and PATH resolution. */
    electronPath?: string;
    /** Initial window width in CSS pixels; omit for a display-relative default. */
    width?: number;
    /** Initial window height in CSS pixels; omit for a display-relative default. */
    height?: number;
    /** Extra Electron/Chromium switches appended to the launch (e.g. `--no-sandbox`, `--disable-gpu`). */
    electronArgs: string[];
}
export declare const Config: z<Config>;
/**
 * The child-process surface the runner uses: exit observation and termination.
 * Decoupled from `node:child_process`'s full `ChildProcess` so tests can
 * substitute a minimal stand-in.
 */
export interface ElectronChild {
    readonly exitCode: number | null;
    readonly signalCode: NodeJS.Signals | null;
    on(event: 'exit', listener: (code: number | null) => void): unknown;
    kill(): boolean;
}
/** Process-facing effects, injectable so tests exercise launch without a real Electron binary. */
export declare const internals: {
    stderr: {
        write(chunk: string): unknown;
    };
    spawn: (binary: string, args: readonly string[], env: NodeJS.ProcessEnv) => ElectronChild;
    resolveElectronBinary: typeof resolveElectronBinary;
};
/**
 * Mount the desktop runner: resolve the launch request and spawn Electron once
 * the tree settles. A failed launch is reported to stderr and contained — it
 * never fails the fiber, so other commands and the Web server keep running.
 * @param ctx - plugin context carrying the launch request.
 * @param config - validated {@link Config}.
 */
export declare function apply(ctx: Context, config: Config): void;
