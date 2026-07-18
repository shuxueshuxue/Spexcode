// gateway-auth security tests — the unified two-scope authorization mechanism ([[gateway-auth]]).
// Every decision the spec promises is pinned here as an adversarial case: verifier hygiene (no plaintext,
// constant-time scrypt compare), token forgery/tamper/expiry, gen rotation on password set/clear, the
// implicit-loopback rule reading ONLY the socket address, and the projectId claim check that makes a
// project token worthless on any other project's route (cookie names and Paths are client-controlled).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  adminCookieName, authorize, authStorePath, clearAdminPassword, clearProjectPassword, loadAuthStore,
  makeVerifier, mintToken, projectCookieName, setAdminPassword, setProjectPassword, verifyPassword,
  verifyToken,
} from './gateway-auth.js'

const PORT = 9443
beforeEach(() => { process.env.SPEXCODE_HOME = mkdtempSync(join(tmpdir(), 'spex-auth-')) })

test('verifier: roundtrip verifies, wrong password fails, plaintext never stored', () => {
  const v = makeVerifier('s3cret-Пароль')
  assert.equal(verifyPassword(v, 's3cret-Пароль'), true)
  assert.equal(verifyPassword(v, 's3cret-пароль'), false)
  assert.equal(verifyPassword(v, ''), false)
  assert.equal(verifyPassword(undefined, 's3cret-Пароль'), false)
  assert.ok(!JSON.stringify(v).includes('s3cret'), 'verifier serialization must not contain the password')
})

test('store: created 0600 with a persistent random secret', () => {
  const a = loadAuthStore()
  assert.ok(a.secret.length >= 32)
  assert.equal(statSync(authStorePath()).mode & 0o777, 0o600)
  const b = loadAuthStore()
  assert.equal(b.secret, a.secret, 'secret survives reloads (sessions survive restarts)')
})

test('tokens: valid roundtrip; tamper and cross-store forgery rejected', () => {
  const store = setAdminPassword('pw')
  const tok = mintToken(store, { s: 'admin' })
  assert.equal(verifyToken(store, tok)?.s, 'admin')
  // flip one char of the signature and of the payload
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
  assert.equal(verifyToken(store, flip(tok, tok.length - 1)), null)
  assert.equal(verifyToken(store, flip(tok, 1)), null)
  assert.equal(verifyToken(store, 'garbage'), null)
  assert.equal(verifyToken(store, ''), null)
  // a token signed under ANOTHER user's store (different secret) is a forgery here
  const otherHome = mkdtempSync(join(tmpdir(), 'spex-auth-other-'))
  const here = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = otherHome
  const foreign = mintToken(setAdminPassword('pw'), { s: 'admin' })
  process.env.SPEXCODE_HOME = here
  assert.equal(verifyToken(store, foreign), null)
})

test('tokens: expire after the TTL and reject future-dated issue times', () => {
  const store = setAdminPassword('pw')
  const t0 = Date.now()
  const tok = mintToken(store, { s: 'admin' }, t0)
  assert.ok(verifyToken(store, tok, t0 + 29 * 24 * 3600 * 1000))
  assert.equal(verifyToken(store, tok, t0 + 31 * 24 * 3600 * 1000), null)
  assert.equal(verifyToken(store, mintToken(store, { s: 'admin' }, t0 + 3600_000), t0), null)
})

test('gen rotation: re-setting or clearing a password invalidates every session it minted', () => {
  let store = setAdminPassword('pw1')
  const oldTok = mintToken(store, { s: 'admin' })
  store = setAdminPassword('pw2')
  assert.equal(verifyToken(store, oldTok), null, 're-set password → old admin token dead')
  const tok2 = mintToken(store, { s: 'admin' })
  store = clearAdminPassword()
  assert.equal(verifyToken(store, tok2), null, 'cleared password → token dead')

  let s2 = setProjectPassword('projA', 'apw')
  const pTok = mintToken(s2, { s: 'project', p: 'projA' })
  assert.equal(verifyToken(s2, pTok)?.p, 'projA')
  s2 = setProjectPassword('projA', 'apw') // same password, fresh gen — rotation is per SET, not per value
  assert.equal(verifyToken(s2, pTok), null)
  const pTok2 = mintToken(s2, { s: 'project', p: 'projA' })
  s2 = clearProjectPassword('projA')
  assert.equal(verifyToken(s2, pTok2), null)
})

test('admin scope: implicit loopback ONLY while no admin password exists; never from a remote address', () => {
  let store = loadAuthStore()
  for (const addr of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
    assert.deepEqual(authorize(store, { kind: 'admin' }, undefined, addr, PORT), { ok: true, via: 'loopback' }, addr)
  }
  for (const addr of ['203.0.113.9', '::ffff:203.0.113.9', '10.0.0.1', '100.101.115.41', undefined, '']) {
    assert.deepEqual(authorize(store, { kind: 'admin' }, undefined, addr, PORT), { ok: false, reason: 'locked' }, String(addr))
  }
  // once an admin password exists, loopback is no longer implicit — everyone logs in
  store = setAdminPassword('pw')
  assert.deepEqual(authorize(store, { kind: 'admin' }, undefined, '127.0.0.1', PORT), { ok: false, reason: 'admin-login' })
  const cookie = `${adminCookieName(PORT)}=${mintToken(store, { s: 'admin' })}`
  assert.deepEqual(authorize(store, { kind: 'admin' }, cookie, '203.0.113.9', PORT), { ok: true, via: 'admin' })
})

test('project scope: open without a verifier; gated confined to its own projectId claim', () => {
  let store = loadAuthStore()
  assert.deepEqual(authorize(store, { kind: 'project', projectId: 'projA' }, undefined, '203.0.113.9', PORT), { ok: true, via: 'open' })

  store = setProjectPassword('projA', 'apw')
  store = setProjectPassword('projB', 'bpw')
  assert.deepEqual(authorize(store, { kind: 'project', projectId: 'projA' }, undefined, '127.0.0.1', PORT), { ok: false, reason: 'project-login' }, 'gated even from loopback')

  const tokA = mintToken(store, { s: 'project', p: 'projA' })
  const underA = `${projectCookieName(PORT, 'projA')}=${tokA}`
  assert.deepEqual(authorize(store, { kind: 'project', projectId: 'projA' }, underA, '203.0.113.9', PORT), { ok: true, via: 'project' })
  // A's token grants NOTHING on B — under its own cookie name, and even re-labeled as B's cookie
  assert.equal(authorize(store, { kind: 'project', projectId: 'projB' }, underA, '203.0.113.9', PORT).ok, false)
  const relabeled = `${projectCookieName(PORT, 'projB')}=${tokA}`
  assert.equal(authorize(store, { kind: 'project', projectId: 'projB' }, relabeled, '203.0.113.9', PORT).ok, false, 'the claim, not the cookie name, is the authority')
  // and a project token never reaches the admin surface
  assert.equal(authorize(store, { kind: 'admin' }, underA, '203.0.113.9', PORT).ok, false)
  assert.equal(authorize(store, { kind: 'admin' }, relabeled, '203.0.113.9', PORT).ok, false, 'a relabeled project token grants no admin')
  // (from loopback the admin surface is open here anyway — no admin password is set yet — and the
  // stray project cookie neither adds nor subtracts from that)
  assert.deepEqual(authorize(store, { kind: 'admin' }, relabeled, '127.0.0.1', PORT), { ok: true, via: 'loopback' })

  // admin reaches every project
  store = setAdminPassword('pw')
  const adminCookie = `${adminCookieName(PORT)}=${mintToken(store, { s: 'admin' })}`
  assert.deepEqual(authorize(store, { kind: 'project', projectId: 'projA' }, adminCookie, '203.0.113.9', PORT), { ok: true, via: 'admin' })
  assert.deepEqual(authorize(store, { kind: 'project', projectId: 'projB' }, adminCookie, '203.0.113.9', PORT), { ok: true, via: 'admin' })
})

test('scope swap: an admin-shaped claim minted as project (and vice versa) does not cross', () => {
  let store = setAdminPassword('pw')
  store = setProjectPassword('projA', 'apw')
  const adminTok = mintToken(store, { s: 'admin' })
  // an admin token presented under a project cookie name still authorizes the project route (admin cookie
  // name is where admin is read) — but a PROJECT token under the ADMIN cookie name must not become admin.
  const projTok = mintToken(store, { s: 'project', p: 'projA' })
  const projAsAdmin = `${adminCookieName(PORT)}=${projTok}`
  assert.equal(authorize(store, { kind: 'admin' }, projAsAdmin, '203.0.113.9', PORT).ok, false)
  assert.equal(authorize(store, { kind: 'project', projectId: 'projB' }, projAsAdmin, '203.0.113.9', PORT).ok, true, 'projB is open — open stays open')
  const adminUnderProj = `${projectCookieName(PORT, 'projA')}=${adminTok}`
  assert.equal(authorize(store, { kind: 'project', projectId: 'projA' }, adminUnderProj, '203.0.113.9', PORT).ok, false, 'admin token in a project mailbox is not a project claim')
})
