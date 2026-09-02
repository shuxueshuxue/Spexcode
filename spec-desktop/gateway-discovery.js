'use strict'

const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

const PACKAGED_HOST_RECORD_MODULE = process.resourcesPath
  ? resolve(process.resourcesPath, 'spexcode', 'node_modules', '@spexcode', 'spec-cli', 'dist', 'host-record.js')
  : resolve(__dirname, '..', 'spec-cli', 'dist', 'host-record.js')
const HOST_RECORD_MODULE = process.env.SPEXCODE_DESKTOP_HOST_RECORD_MODULE || PACKAGED_HOST_RECORD_MODULE
const PROBE_TIMEOUT_MS = 1_000

async function findRunningGateway() {
  const { readHostRecord } = await import(pathToFileURL(HOST_RECORD_MODULE).href)
  const record = readHostRecord()
  if (!record) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    // `/host` stays outside the admin gate and identifies the gateway instance that wrote the record.
    const response = await fetch(`${record.url}/host`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const facts = response.ok ? await response.json().catch(() => null) : null
    return facts?.gateway?.instanceId === record.instanceId ? record.url : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { findRunningGateway }
