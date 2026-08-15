/**
 * Pure Electron-resolution helpers: target-URL precedence, binary resolution
 * across explicit/module/PATH sources, and the argument vector. No Electron
 * installation is required — resolution probes real files in a temp directory.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildElectronArgs,
  DASHBOARD_URL,
  resolveElectronBinary,
  resolveTargetUrl,
} from '../src/launcher.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Create a real empty file inside a fresh temp directory and keep it for cleanup. */
function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-'))
  tempDirs.push(dir)
  const file = join(dir, name)
  writeFileSync(file, '')
  return file
}

describe('resolveTargetUrl', () => {
  it('prefers the explicit URL', () => {
    expect(resolveTargetUrl({ url: 'https://example.com', webServerPort: 8080 })).toBe('https://example.com')
  })

  it('uses the bound Web-server port', () => {
    expect(resolveTargetUrl({ webServerPort: 9090 })).toBe('http://127.0.0.1:9090')
  })

  it('falls back to the bundled dashboard', () => {
    expect(resolveTargetUrl({})).toBe(DASHBOARD_URL)
  })
})

describe('resolveElectronBinary', () => {
  it('returns an existing explicit path', () => {
    const path = tempFile('electron')
    expect(resolveElectronBinary(path, () => { throw new Error('unused') })).toBe(path)
  })

  it('returns undefined for a missing explicit path', () => {
    expect(resolveElectronBinary(join(tmpdir(), 'does-not-exist-electron'), () => { throw new Error('unused') })).toBeUndefined()
  })

  it('uses the module resolver result when it names an existing file', () => {
    const path = tempFile('electron')
    expect(resolveElectronBinary(undefined, () => path)).toBe(path)
  })

  it('falls back to a PATH lookup when the module resolver throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'electron'), '')
    expect(resolveElectronBinary(undefined, () => { throw new Error('not installed') }, 'linux', dir)).toBe(join(dir, 'electron'))
  })

  it('probes the Windows basenames on win32', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'electron.cmd'), '')
    expect(resolveElectronBinary(undefined, () => { throw new Error('not installed') }, 'win32', dir)).toBe(join(dir, 'electron.cmd'))
  })

  it('returns undefined when neither the module nor the PATH resolves', () => {
    expect(resolveElectronBinary(undefined, () => { throw new Error('not installed') }, 'linux', '')).toBeUndefined()
  })
})

describe('buildElectronArgs', () => {
  it('passes only the main script and any supplied switches', () => {
    expect(buildElectronArgs([], '/main.cjs')).toEqual(['/main.cjs'])
  })

  it('appends deployment-supplied Electron switches', () => {
    expect(buildElectronArgs(['--no-sandbox', '--disable-gpu'], '/main.cjs')).toEqual([
      '/main.cjs', '--no-sandbox', '--disable-gpu',
    ])
  })
})
