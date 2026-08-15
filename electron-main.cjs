'use strict'

/**
 * Electron main process for dsh-desktop.
 *
 * The dsh desktop runner spawns this script as an isolated child process and
 * passes the window target through environment variables. The window is
 * frameless with a custom dsh-styled title bar (injected by `preload.cjs`),
 * shows a system tray with a context menu, and hides to the tray instead of
 * quitting when its close button is used. The window loads the Web UI URL (or
 * an explicit --url) with retries, and only falls back to the bundled
 * dashboard.html when the target genuinely cannot be reached. Failures are
 * printed to stderr with their cause. This file is CommonJS so it runs under
 * Electron's main-process loader without a bundler.
 */

const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Chromium's GPU/display init is the first thing that fails in RDP, VM, and
// remote sessions; software rendering keeps the window creatable there.
app.disableHardwareAcceleration()

/** The one main window; the tray restores and the title bar drives this. */
let mainWindow = null

/** The system tray instance, kept alive for the lifetime of the app. */
let tray = null

/** Whether the system tray is available in this session. */
let trayActive = false

/** Set once the app is genuinely quitting, so closing really closes. */
let quitting = false

app.on('before-quit', () => {
  quitting = true
})

/** Read one `--name value` pair from process.argv (manual launches only). */
function argvValue(name) {
  const argv = process.argv
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === name && i + 1 < argv.length) return argv[i + 1]
  }
  return undefined
}

/** The window target, handed over by the runner as an environment variable. */
function windowUrl() {
  return process.env.DSH_DESKTOP_URL ?? argvValue('--url')
}

/** The window width: the runner's environment, or a display-relative default. */
function windowWidth() {
  const parsed = Number.parseInt(process.env.DSH_DESKTOP_WIDTH ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  // workArea is in device-independent pixels, so the default keeps the same
  // proportional footprint at every desktop display scale.
  const work = screen.getPrimaryDisplay().workAreaSize
  return Math.min(1280, Math.round(work.width * 0.82))
}

/** The window height: the runner's environment, or a display-relative default. */
function windowHeight() {
  const parsed = Number.parseInt(process.env.DSH_DESKTOP_HEIGHT ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  const work = screen.getPrimaryDisplay().workAreaSize
  return Math.min(800, Math.round(work.height * 0.86))
}

/** The `file:` URL of the bundled fallback dashboard. */
function dashboardUrl() {
  return pathToFileURL(path.join(__dirname, 'dashboard.html')).href
}

/** Open external links in the user's browser instead of inside the window. */
function denyWindowOpen(details) {
  try {
    if (/^https?:$/.test(new URL(details.url).protocol)) void shell.openExternal(details.url)
  } catch {
    // A malformed target is denied without opening anything.
  }
  return { action: 'deny' }
}

/** Report a window failure to the runner's inherited stderr. */
function reportWindowFailure(stage, error) {
  console.error(`dsh desktop: failed to ${stage}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
}

/** Sleep a short delay between load retries. */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Load `url` in the window, retrying while the target (the dsh Web server)
 * may still be coming up. Returns whether a load settled.
 * @param window - the BrowserWindow to load into.
 * @param url - the absolute URL to load.
 * @param attempts - how many times to try.
 * @param delayMs - pause between attempts.
 * @returns true when one attempt settled.
 */
async function loadWithRetry(window, url, attempts = 5, delayMs = 500) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await window.loadURL(url)
      return true
    } catch (error) {
      reportWindowFailure(`load ${url} (attempt ${attempt}/${attempts})`, error)
      if (attempt < attempts) await delay(delayMs)
    }
  }
  return false
}

/** Restore and focus the main window (used by the tray and macOS activate). */
function showWindow() {
  if (mainWindow === null) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Create the main window, loading `url` (or the dashboard when none is
 * given). A throwing `BrowserWindow` construction (a display-less session) is
 * reported and rethrown so the caller can exit with a diagnostic.
 */
function createWindow(url) {
  const width = windowWidth()
  const height = windowHeight()
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: Number.isFinite(width) && width > 0 ? width : 1280,
    height: Number.isFinite(height) && height > 0 ? height : 800,
    title: 'DeepSeek Harness',
    // Custom title bar: frameless on Windows/Linux with the injected bar from
    // preload.cjs; on macOS keep the native traffic lights via a hidden bar.
    ...(isMac ? { titleBarStyle: 'hidden' } : { frame: false }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  mainWindow = window
  window.webContents.setWindowOpenHandler(denyWindowOpen)
  // Close-to-tray: the close button hides the window; the tray menu Quit (or
  // dsh tearing the child down) really ends the app.
  window.on('close', (event) => {
    if (!quitting && trayActive) {
      event.preventDefault()
      window.hide()
    }
  })
  const target = url === undefined ? dashboardUrl() : url
  // The dashboard is the last resort, not the first: a Web server that is
  // still warming up must not swap the UI for the fallback page.
  void loadWithRetry(window, target).then((loaded) => {
    if (!loaded && url !== undefined) {
      reportWindowFailure(`reach ${target}`, new Error('all load attempts failed'))
      return window.loadURL(dashboardUrl())
    }
    return undefined
  })
  return window
}

// Window controls driven by the injected title bar.
ipcMain.on('window:minimize', () => { if (mainWindow !== null) mainWindow.minimize() })
ipcMain.on('window:maximize', () => {
  if (mainWindow === null) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window:close', () => { if (mainWindow !== null) mainWindow.close() })

/** Create the system tray; a session without one logs and continues. */
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip('DeepSeek Harness')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: showWindow },
      {
        label: '打开 Web UI',
        click: () => {
          const url = windowUrl()
          if (url !== undefined) void shell.openExternal(url)
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]))
    // Windows/Linux: a click shows the window; macOS: the menu opens on click.
    if (process.platform !== 'darwin') tray.on('click', showWindow)
    tray.on('double-click', showWindow)
    trayActive = true
  } catch (error) {
    reportWindowFailure('create the system tray', error)
    trayActive = false
  }
}

app.whenReady().then(() => {
  const url = windowUrl()
  try {
    createWindow(url)
  } catch (error) {
    reportWindowFailure('create the Electron window', error)
    app.exit(1)
    return
  }
  createTray()
  // macOS re-creates the window when the dock icon is clicked with none open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        createWindow(url)
      } catch (error) {
        reportWindowFailure('recreate the Electron window', error)
      }
    }
  })
})

app.on('window-all-closed', () => {
  // With a tray the app keeps running in the background; quit via the tray
  // menu or by dsh tearing the child down. Without a tray, follow the
  // platform default (quit outside macOS).
  if (!trayActive && process.platform !== 'darwin') app.quit()
})
