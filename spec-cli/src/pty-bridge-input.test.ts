import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('PTY forwarding has no lifecycle side effect', () => {
  const source = readFileSync(new URL('./pty-bridge.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /export function forwardInput[\s\S]*?return accepted\n}/,
  )
  assert.doesNotMatch(source, /markHumanPromptActive/)
})

test('raw-key fallback has no lifecycle side effect', () => {
  const source = readFileSync(new URL('./sessions.ts', import.meta.url), 'utf8')
  assert.match(source, /export async function rawKey[\s\S]*?return sent\n}/)
  const body = source.match(/export async function rawKey[\s\S]*?\n}/)?.[0] || ''
  assert.doesNotMatch(body, /markHumanPromptActive/)
})
