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
import { createRequire } from 'node:module';
import z from '@deepseek-ai/schemastery';
import { buildElectronArgs, DESKTOP_HEIGHT_ENV, DESKTOP_URL_ENV, DESKTOP_WIDTH_ENV, resolveElectronBinary, resolveTargetUrl, spawnElectron, } from "./launcher.js";
/**
 * Cordis `FiberState.ACTIVE`. FiberState is a compile-time const enum: tsc
 * inlines it, but the self-contained `prepare` build (oxc, no type info)
 * cannot, and the enum is erased from cordis's runtime export. Mirror the
 * numeric value so both builds stay correct.
 */
const FIBER_ACTIVE = 2;
/** Stable Cordis plugin name. */
export const name = 'desktop-runner';
/** Services required before the desktop can launch. */
export const inject = ['desktopStartup'];
export const Config = z.object({
    // Object fields are optional by default in schemastery; `required()` would
    // reject an absent value, and these intentionally accept absence.
    url: z.string(),
    electronPath: z.string(),
    width: z.natural(),
    height: z.natural(),
    electronArgs: z.array(String).default([]),
});
/** Process-facing effects, injectable so tests exercise launch without a real Electron binary. */
export const internals = {
    stderr: process.stderr,
    spawn: spawnElectron,
    resolveElectronBinary,
};
/** The diagnostic printed when Electron cannot be resolved; it names the recovery actions. */
function missingElectronMessage() {
    return 'dsh desktop: Electron is not available, so no window was opened. '
        + 'Install Electron for this profile (`dsh plugin --profile desktop add electron`) '
        + 'or set `electronPath` in the desktop-runner row config, then re-run.\n';
}
/**
 * Resolve the window target and the Electron binary, then spawn the window in
 * an isolated child process. The child owns its environment and globals; the
 * dsh process only retains the handle so tree teardown kills it and so its
 * exit can request a clean shutdown.
 * @param ctx - plugin context carrying the settled tree and the launch request.
 * @param config - validated {@link Config}.
 */
async function launch(ctx, config) {
    // Register the teardown disposer while the fiber is active; it closes over
    // the mutable child handle, so the spawn below is covered by teardown too.
    let child;
    ctx.effect(() => () => { if (child !== undefined)
        killChild(child); }, 'desktop-runner.kill-child');
    // The Web server binds in its own fiber init; await full settlement so the
    // port read below is the bound one. A bare (test) context has no Loader and
    // proceeds at once. A sibling failure (e.g. the port is already in use)
    // settles the tree with a failed row and then disposes it; the boot reports
    // that failure, so the runner stays quiet and does not spawn.
    try {
        await ctx.get('loader')?.await();
    }
    catch {
        return;
    }
    if (ctx.fiber.state !== FIBER_ACTIVE)
        return;
    const webServer = ctx.get('webServer');
    const targetUrl = resolveTargetUrl({
        url: config.url,
        webServerPort: typeof webServer?.port === 'number' ? webServer.port : undefined,
    });
    const binary = internals.resolveElectronBinary(config.electronPath, specifier => createRequire(ctx.baseUrl ?? import.meta.url)(specifier));
    if (binary === undefined) {
        internals.stderr.write(missingElectronMessage());
        return;
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
    });
    child.on('exit', (code) => {
        if (code === 0) {
            // The window closed normally; shut the desktop app down cleanly.
            ctx.get('appExit')?.(0);
        }
        else if (code !== null) {
            // Electron crashed; keep the Web server serving and tell the user how to
            // recover (the switch list comes from the electronArgs config).
            internals.stderr.write(electronExitMessage(code, targetUrl));
        }
    });
}
/**
 * The diagnostic printed when the Electron child exits abnormally. The Web
 * UI stays reachable at `url`, so the message names it as a browser fallback.
 */
function electronExitMessage(code, url) {
    return `dsh desktop: Electron exited with code ${String(code)}, so no window is open. `
        + `The Web UI is still available at ${url} — open it in a browser, or fix the window `
        + 'with `electronArgs` in the desktop-runner row config (for example ["--no-sandbox", "--disable-gpu"]).\n';
}
/** Terminate the Electron child on tree teardown; a no-op once it has exited. */
function killChild(child) {
    if (child.exitCode === null && child.signalCode === null)
        child.kill();
}
/**
 * Mount the desktop runner: resolve the launch request and spawn Electron once
 * the tree settles. A failed launch is reported to stderr and contained — it
 * never fails the fiber, so other commands and the Web server keep running.
 * @param ctx - plugin context carrying the launch request.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
    void launch(ctx, config).catch((error) => {
        internals.stderr.write(`dsh desktop: failed to launch Electron: ${error instanceof Error ? error.message : String(error)}\n`);
    });
}
