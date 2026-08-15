'use strict'

/**
 * Renderer preload for dsh-desktop.
 *
 * Injects the custom title bar into the frameless window and keeps it in the
 * dsh design language: every color is read live from the dsh design tokens
 * (`--dsw-alias-*`), so the bar follows the current light/dark theme and
 * re-paints when the theme switches. The bar is a drag region; outside macOS
 * (which keeps the native traffic lights) it carries minimize/maximize/close
 * buttons that drive the window through IPC. The page itself keeps its own
 * layout and scrollbars: the app root is flexed into the space below the bar,
 * so no extra scrollbar is introduced. All sizes are CSS pixels, which the
 * Chromium zoom pipeline already maps to the desktop display scale. Elements
 * are built with direct DOM property writes so a page Content-Security-Policy
 * cannot block them.
 */

const { ipcRenderer } = require('electron')

/** Height of the injected title bar in CSS pixels. */
const BAR_HEIGHT = 32

/** Dark-session fallbacks used on pages without the dsh token sheets (the bundled dashboard). */
const FALLBACKS = {
  surface: 'rgb(21, 21, 23)', // --dsw-static-neutral-bluish-950
  border: 'rgba(255, 255, 255, 0.12)',
  text: 'rgb(207, 211, 214)', // --dsw-static-neutral-bluish-300
  hover: 'rgba(255, 255, 255, 0.08)',
  accent: 'rgb(65, 118, 230)', // --dsw-static-deepseek-500
  danger: 'rgb(242, 90, 90)', // --dsw-static-red-400
}

/** Read one theme-aware dsh design token from the live stylesheet. */
function token(name, fallback) {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** Snapshot the current palette from the dsh alias tokens (theme-flipping). */
function palette() {
  return {
    surface: token('--dsw-alias-bg-base', FALLBACKS.surface),
    border: token('--dsw-alias-border-l2', FALLBACKS.border),
    text: token('--dsw-alias-label-secondary', FALLBACKS.text),
    hover: token('--dsw-alias-interactive-bg-hover', FALLBACKS.hover),
    accent: token('--dsw-alias-state-business-primary', FALLBACKS.accent),
    danger: token('--dsw-alias-state-error-primary', FALLBACKS.danger),
  }
}

/** Create an element with the given inline styles (CSP-safe property writes). */
function styled(style) {
  const el = document.createElement('div')
  Object.assign(el.style, style)
  return el
}

/** Send one window-control request to the main process. */
function send(channel) {
  return () => ipcRenderer.send(channel)
}

/** Build one window-control button with dsh hover states. */
function makeButton(channel, label) {
  const button = styled({
    width: '40px',
    height: '24px',
    borderRadius: '6px',
    margin: '0 4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitAppRegion: 'no-drag',
    cursor: 'default',
  })
  const glyph = styled({ fontSize: '12px', lineHeight: '1', fontFamily: 'inherit' })
  glyph.textContent = label
  button.append(glyph)
  button.addEventListener('click', send(channel))
  button.addEventListener('mouseenter', () => {
    const colors = palette()
    button.style.background = channel === 'window:close' ? colors.danger : colors.hover
    glyph.style.color = channel === 'window:close' ? '#ffffff' : colors.text
  })
  button.addEventListener('mouseleave', () => {
    const colors = palette()
    button.style.background = 'transparent'
    glyph.style.color = colors.text
  })
  return button
}

/** Build the bar element once and keep the pieces the theme repaint needs. */
function buildBar() {
  const bar = styled({
    position: 'relative',
    flex: '0 0 auto',
    height: `${BAR_HEIGHT}px`,
    display: 'flex',
    alignItems: 'center',
    flexDirection: 'row',
    borderBottom: '1px solid',
    zIndex: '2147483647',
    WebkitAppRegion: 'drag',
    userSelect: 'none',
  })
  bar.id = 'dsh-desktop-titlebar'

  const dot = styled({ width: '8px', height: '8px', borderRadius: '3px', flexShrink: '0' })
  const name = styled({
    fontSize: '12px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: 'inherit',
  })
  name.textContent = 'DeepSeek Harness'
  const brand = styled({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    paddingLeft: '12px',
    flex: '1',
    minWidth: '0',
  })
  brand.append(dot, name)
  bar.append(brand)

  const buttons = styled({
    display: 'flex',
    alignItems: 'center',
    paddingRight: '4px',
    WebkitAppRegion: 'no-drag',
  })
  const minimize = makeButton('window:minimize', '─')
  const maximize = makeButton('window:maximize', '□')
  const close = makeButton('window:close', '✕')
  buttons.append(minimize, maximize, close)
  bar.append(buttons)
  bar.addEventListener('dblclick', send('window:maximize'))

  return { bar, dot, name, buttons, close, maximize, minimize }
}

/** Paint every theme-dependent surface from the current palette. */
function paint(parts) {
  const colors = palette()
  parts.bar.style.background = colors.surface
  parts.bar.style.borderBottomColor = colors.border
  parts.dot.style.background = colors.accent
  parts.name.style.color = colors.text
  for (const glyph of parts.buttons.querySelectorAll('div > div')) {
    glyph.style.color = colors.text
  }
}

/**
 * Attach the bar and fit the page around it. With the dsh app root present,
 * the body becomes a column whose remaining space the root flexes into — the
 * app keeps its own layout and scrollbars, and no page scrollbar appears.
 * Other pages (the bundled dashboard) get a border-box top padding instead.
 */
function installTitleBar() {
  if (document.getElementById('dsh-desktop-titlebar') !== null) return
  const parts = buildBar()
  document.body.prepend(parts.bar)
  paint(parts)

  const root = document.getElementById('root')
  if (root !== null) {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.display = 'flex'
    document.body.style.flexDirection = 'column'
    document.body.style.overflow = 'hidden'
    root.style.height = 'auto'
    root.style.minHeight = '0'
    root.style.flex = '1 1 auto'
  } else {
    document.body.style.boxSizing = 'border-box'
    document.body.style.paddingTop = `${BAR_HEIGHT}px`
    document.body.style.overflow = 'hidden'
  }

  // The persisted theme can land after first paint; follow it live.
  const observer = new MutationObserver(() => paint(parts))
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
}

window.addEventListener('DOMContentLoaded', installTitleBar)
