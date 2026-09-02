'use strict'

const { execFile, spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')

const DEFAULT_PROBE = process.env.SPEXCODE_DESKTOP_WSL_PROBE || 'wsl.exe'

function decodeWslOutput(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''))
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le')
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2)
    for (let i = 2; i < buffer.length - 1; i += 2) {
      swapped[i - 2] = buffer[i + 1]
      swapped[i - 1] = buffer[i]
    }
    return swapped.toString('utf16le')
  }
  // WSL emits UTF-16LE even when the console omits its BOM.
  if (buffer.length > 1 && buffer[1] === 0 && buffer.includes(0)) return buffer.toString('utf16le')
  return buffer.toString('utf8')
}

function parseWslList(value) {
  const text = decodeWslOutput(value).replace(/^\uFEFF/, '')
  const distros = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^NAME\s+STATE\s+VERSION/i.test(line)) continue
    const match = line.match(/^(\*)?\s*(\S(?:.*?\S)?)\s+(Running|Stopped|Installing|Uninstalling)\s+([12])\s*$/i)
    if (!match) continue
    distros.push({ name: match[2], state: match[3], version: Number(match[4]), isDefault: Boolean(match[1]) })
  }
  return distros
}

function detectWsl({ probe = DEFAULT_PROBE } = {}) {
  probe = process.env.SPEXCODE_DESKTOP_WSL_PROBE || probe
  const file = /\.js$/i.test(probe) ? (process.env.SPEXCODE_DESKTOP_WSL_NODE || 'node') : probe
  const args = /\.js$/i.test(probe) ? [probe, '-l', '-v'] : ['-l', '-v']
  return new Promise((resolveResult, rejectResult) => {
    execFile(file, args, { encoding: 'buffer', windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = decodeWslOutput(stderr || stdout || error.message).trim()
        const failure = new Error(`WSL2 detection failed: ${detail || error.message}`)
        failure.code = error.code
        rejectResult(failure)
        return
      }
      const distros = parseWslList(stdout)
      const v2 = distros.filter((distro) => distro.version === 2)
      const defaultDistro = distros.find((distro) => distro.isDefault)
      const selected = defaultDistro
        ? (defaultDistro.version === 2 ? defaultDistro : null)
        : (v2.length === 1 ? v2[0] : null)
      if (!selected) {
        const reason = distros.length === 0
          ? 'no WSL distro is installed'
          : distros.every((distro) => distro.version === 1)
            ? 'only WSL version 1 distros are installed'
            : 'no default WSL2 distro is available'
        const failure = new Error(`WSL2 is unavailable: ${reason}`)
        failure.code = 'WSL_UNAVAILABLE'
        rejectResult(failure)
        return
      }
      resolveResult({ ...selected, distros, probe })
    })
  })
}

function runWsl(distro, command, options = {}) {
  return spawn(options.probe || process.env.SPEXCODE_DESKTOP_WSL_PROBE || DEFAULT_PROBE, ['-d', distro, '--', ...command], {
    stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: options.env,
  })
}

function readWslHostRecord(distro, { probe = process.env.SPEXCODE_DESKTOP_WSL_PROBE || DEFAULT_PROBE } = {}) {
  return new Promise((resolveRecord) => {
    execFile(probe, ['-d', distro, '--', 'bash', '-lc', 'cat "$HOME/.spexcode/host.json"'], { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) return resolveRecord(null)
      try {
        const record = JSON.parse(stdout)
        if (record?.version !== 1 || typeof record.url !== 'string' || !Number.isInteger(record.pid) || record.pid <= 0 || typeof record.instanceId !== 'string') return resolveRecord(null)
        const url = new URL(record.url)
        if (!['http:', 'https:'].includes(url.protocol)) return resolveRecord(null)
        resolveRecord(record)
      } catch { resolveRecord(null) }
    })
  })
}

function bootstrapCommand(distro, scriptPath = resolve(__dirname, 'wsl-bootstrap.sh')) {
  const wslScriptPath = windowsPathToWsl(scriptPath)
  const script = `sed 's/\\r$//' ${shellQuote(wslScriptPath)} > /tmp/spexcode-wsl-bootstrap.sh && bash /tmp/spexcode-wsl-bootstrap.sh`
  return { file: process.env.SPEXCODE_DESKTOP_WSL_PROBE || DEFAULT_PROBE, args: ['-d', distro, '--', 'bash', '-lc', script] }
}

function windowsPathToWsl(value) {
  const path = String(value)
  const match = path.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!match) return path
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function translateWslPath(value, distro) {
  const input = String(value || '').replaceAll('/', '\\')
  const prefix = `\\\\wsl$\\${distro}\\`
  if (input.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = input.slice(prefix.length).replaceAll('\\', '/')
    return `/${rest}`.replace(/\/+/g, '/')
  }
  if (/^\\\\wsl\$\\/i.test(input)) throw new Error(`selected WSL path belongs to another distro: ${value}`)
  if (/^\/mnt\/[a-z](?:\/|$)/i.test(String(value)) || /^[a-z]:\\/i.test(String(value))) {
    throw new Error('Projects on /mnt/c use 9p, where git and inotify are slow or unreliable; choose a folder under \\\\wsl$\\<distro>\\home instead.')
  }
  return value
}

function projectRootForPost(value, distro) {
  const root = translateWslPath(value, distro)
  if (!root || !String(root).startsWith('/')) throw new Error('project path must be a Linux-side absolute path')
  return root
}

function wslConfigPath() {
  return join(process.env.USERPROFILE || homedir(), '.wslconfig')
}

function wslConfigStatus() {
  const path = wslConfigPath()
  return { path, present: existsSync(path), recommended: '[wsl2]\nmemory=8GB\n' }
}

module.exports = {
  decodeWslOutput,
  parseWslList,
  detectWsl,
  runWsl,
  readWslHostRecord,
  bootstrapCommand,
  translateWslPath,
  projectRootForPost,
  wslConfigPath,
  wslConfigStatus,
  shellQuote,
  windowsPathToWsl,
}
