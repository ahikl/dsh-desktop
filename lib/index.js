import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
//#region lib/types/launcher.js
/**
* Electron process resolution and launch for `dsh-desktop`.
* The pure resolution helpers live here so tests exercise them without an
* Electron installation; only the thin {@link spawnElectron} wrapper touches
* the process boundary.
* @module dsh-desktop/launcher
*/
/** The `electron` package's entry exports the absolute path of the platform binary. */
const ELECTRON_PACKAGE = "electron";
/** Loopback host the Web server binds on the desktop surface. */
const LOOPBACK_HOST = "127.0.0.1";
/** Absolute path of the bundled Electron main-process script (package root, a sibling of src/ and lib/). */
const ELECTRON_MAIN_SCRIPT = fileURLToPath(new URL("../electron-main.cjs", import.meta.url));
/** `file:` URL of the bundled fallback dashboard, loaded when no Web server or explicit URL exists. */
const DASHBOARD_URL = new URL("../dashboard.html", import.meta.url).href;
/**
* Resolve the URL the Electron window loads, in precedence order: an explicit
* URL, the bound Web server, then the bundled dashboard.
* @param options - the resolution inputs.
* @returns the resolved URL.
*/
function resolveTargetUrl(options) {
	if (options.url !== void 0) return options.url;
	if (options.webServerPort !== void 0) return `http://${LOOPBACK_HOST}:${String(options.webServerPort)}`;
	return DASHBOARD_URL;
}
/** Electron binary basenames to probe on the PATH, per platform. */
function electronBinaryCandidates(platform) {
	return platform === "win32" ? ["electron.exe", "electron.cmd"] : ["electron"];
}
/**
* Locate one basename across a `PATH`-style entry list, returning the first
* existing file. Directories are probed in order; missing entries are skipped.
* @param name - the binary basename to find.
* @param pathEntries - the delimited `PATH` value, empty when unset.
* @returns the absolute path, or `undefined` when no entry holds the file.
*/
function findOnPath(name, pathEntries) {
	if (pathEntries === "") return void 0;
	for (const dir of pathEntries.split(delimiter)) {
		if (dir === "") continue;
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
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
function resolveElectronBinary(explicit, requireElectron = (specifier) => createRequire(import.meta.url)(specifier), platform = process.platform, pathEntries = process.env.PATH ?? "") {
	if (explicit !== void 0) return existsSync(explicit) ? explicit : void 0;
	try {
		const resolved = requireElectron(ELECTRON_PACKAGE);
		if (typeof resolved === "string" && existsSync(resolved)) return resolved;
	} catch {}
	for (const name of electronBinaryCandidates(platform)) {
		const found = findOnPath(name, pathEntries);
		if (found !== void 0) return found;
	}
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
function buildElectronArgs(extraArgs = [], script = ELECTRON_MAIN_SCRIPT) {
	return [script, ...extraArgs];
}
/** Environment key carrying the window URL to the Electron main script. */
const DESKTOP_URL_ENV = "DSH_DESKTOP_URL";
/** Environment key carrying the window width to the Electron main script. */
const DESKTOP_WIDTH_ENV = "DSH_DESKTOP_WIDTH";
/** Environment key carrying the window height to the Electron main script. */
const DESKTOP_HEIGHT_ENV = "DSH_DESKTOP_HEIGHT";
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
function spawnElectron(binary, args, env, spawnImpl = spawn) {
	return spawnImpl(binary, [...args], {
		stdio: "inherit",
		env
	});
}
//#endregion
//#region lib/types/index.js
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
/**
* Cordis `FiberState.ACTIVE`. FiberState is a compile-time const enum: tsc
* inlines it, but the self-contained `prepare` build (oxc, no type info)
* cannot, and the enum is erased from cordis's runtime export. Mirror the
* numeric value so both builds stay correct.
*/
const FIBER_ACTIVE = 2;
/** Stable Cordis plugin name. */
const name = "desktop-runner";
/** Services required before the desktop can launch. */
const inject = ["desktopStartup"];
const Config = z.object({
	url: z.string(),
	electronPath: z.string(),
	width: z.natural(),
	height: z.natural(),
	electronArgs: z.array(String).default([])
});
/** Process-facing effects, injectable so tests exercise launch without a real Electron binary. */
const internals = {
	stderr: process.stderr,
	spawn: spawnElectron,
	resolveElectronBinary
};
/** The diagnostic printed when Electron cannot be resolved; it names the recovery actions. */
function missingElectronMessage() {
	return "dsh desktop: Electron is not available, so no window was opened. Install Electron for this profile (`dsh plugin --profile desktop add electron`) or set `electronPath` in the desktop-runner row config, then re-run.\n";
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
	let child;
	ctx.effect(() => () => {
		if (child !== void 0) killChild(child);
	}, "desktop-runner.kill-child");
	try {
		await ctx.get("loader")?.await();
	} catch {
		return;
	}
	if (ctx.fiber.state !== FIBER_ACTIVE) return;
	const webServer = ctx.get("webServer");
	const targetUrl = resolveTargetUrl({
		url: config.url,
		webServerPort: typeof webServer?.port === "number" ? webServer.port : void 0
	});
	const binary = internals.resolveElectronBinary(config.electronPath, (specifier) => createRequire(ctx.baseUrl ?? import.meta.url)(specifier));
	if (binary === void 0) {
		internals.stderr.write(missingElectronMessage());
		return;
	}
	child = internals.spawn(binary, buildElectronArgs(config.electronArgs), {
		...process.env,
		[DESKTOP_URL_ENV]: targetUrl,
		...config.width !== void 0 ? { [DESKTOP_WIDTH_ENV]: String(config.width) } : {},
		...config.height !== void 0 ? { [DESKTOP_HEIGHT_ENV]: String(config.height) } : {}
	});
	child.on("exit", (code) => {
		if (code === 0) ctx.get("appExit")?.(0);
		else if (code !== null) internals.stderr.write(electronExitMessage(code, targetUrl));
	});
}
/**
* The diagnostic printed when the Electron child exits abnormally. The Web
* UI stays reachable at `url`, so the message names it as a browser fallback.
*/
function electronExitMessage(code, url) {
	return `dsh desktop: Electron exited with code ${String(code)}, so no window is open. The Web UI is still available at ${url} — open it in a browser, or fix the window with \`electronArgs\` in the desktop-runner row config (for example ["--no-sandbox", "--disable-gpu"]).
`;
}
/** Terminate the Electron child on tree teardown; a no-op once it has exited. */
function killChild(child) {
	if (child.exitCode === null && child.signalCode === null) child.kill();
}
/**
* Mount the desktop runner: resolve the launch request and spawn Electron once
* the tree settles. A failed launch is reported to stderr and contained — it
* never fails the fiber, so other commands and the Web server keep running.
* @param ctx - plugin context carrying the launch request.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	launch(ctx, config).catch((error) => {
		internals.stderr.write(`dsh desktop: failed to launch Electron: ${error instanceof Error ? error.message : String(error)}\n`);
	});
}
//#endregion
export { Config, apply, inject, internals, name };
