// spec-reconstruction-bench browser/DOM acceptance scorer for the mobile-ui leaf ([[spec-reconstruction-bench]]).
//
// The mobile-ui frozen future task (episode db80b33d) is an async board-poll RACE: several loadBoard()
// fetches can be in flight; only the LATEST-ISSUED may update the board, a superseded (older-issued)
// response must be dropped. Its honest acceptance is a REAL browser/DOM test (YATU), not a source regex.
//
// (B/1) The produced App.jsx is UNTRUSTED agent code, so BOTH the esbuild bundle AND the headless-chromium
// run happen ENTIRELY inside `docker --network none` (browser-incontainer.mjs): produced source + node
// + node_modules + chromium mounted READ-ONLY, only a tmpfs /work/out + /home/agent + /tmp writable, NO
// HOME/checkout mount, network additionally cut in-process via CDP. The container prints SRBVERDICT:{...}.
// Two INDEPENDENT drivers run: a single-refresh driver (board updates on a normal refresh; a never-updates
// impl fails it) and the race driver (latest-issued wins + stale dropped). scoreControlsMobile proves the
// harness PASSES the post-episode App.jsx and REJECTS the pre-state one.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pinMountDigest } from './sandbox.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const NODE_DIST = '/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64'
const CHROME_DIR = '/home/jeffry/.cache/ms-playwright/chromium-1228'     // contains chrome-linux64/chrome
const SCORER_IMAGE = 'scb-scorer:chromium'
const INCONTAINER = join(HERE, 'browser-incontainer.mjs')
const NM = (() => { try { return execFileSync('readlink', ['-f', join(ROOT, 'spec-dashboard/node_modules')], { encoding: 'utf8' }).trim() } catch { return join(ROOT, 'spec-dashboard/node_modules') } })()
// (6) provenance re-verified on EVERY score run: the image is re-inspected each call and must still
// resolve to the FIRST-pinned immutable ID — a tag swapped mid-batch is fail-loud, never silently used.
let IMAGE_ID = null
function scorerImageId() {
  const id = execFileSync('docker', ['image', 'inspect', SCORER_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim()
  if (!IMAGE_ID) IMAGE_ID = id
  else if (id !== IMAGE_ID) throw new Error(`scorer image ${SCORER_IMAGE} changed since pin (${id} != ${IMAGE_ID}) — refusing to score`)
  return IMAGE_ID
}

// run the produced App.jsx through the in-container driver (esbuild + chromium, no network). Returns the
// verdict {single, race} + the mount digests. The produced file is mounted read-only; nothing host-
// writable is exposed. (6) EVERY mutable ro mount (node dist, chromium, node_modules, driver) is content-
// digested on THIS launch and re-verified against its first pin — the image id alone is not the scorer's
// provenance, the mounted executables are part of it.
function runRace(appJsxPath) {
  const mounts = {
    node: pinMountDigest('mobile:node-dist', NODE_DIST),
    chromium: pinMountDigest('mobile:chromium', CHROME_DIR),
    nodeModules: pinMountDigest('mobile:node_modules', NM),
    driver: pinMountDigest('mobile:incontainer-driver', INCONTAINER),
  }
  const out = execFileSync('timeout', ['180', 'docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000',
    '-e', 'HOME=/home/agent',
    '--tmpfs', '/work/out:exec,uid=1000', '--tmpfs', '/tmp:exec,uid=1000', '--tmpfs', '/home/agent:exec,uid=1000',
    '-v', `${NM}:/work/node_modules:ro`, '-v', `${INCONTAINER}:/work/browser-incontainer.mjs:ro`,
    '-v', `${appJsxPath}:/opt/app/App.jsx:ro`, '-v', `${NODE_DIST}:/opt/node:ro`, '-v', `${CHROME_DIR}:/opt/chromium:ro`,
    scorerImageId(), '/opt/node/bin/node', '/work/browser-incontainer.mjs', '/opt/app/App.jsx'],
    { encoding: 'utf8', timeout: 210_000, maxBuffer: 32 * 1024 * 1024 })
  const line = out.split('\n').find((l) => l.startsWith('SRBVERDICT:'))
  if (!line) throw new Error('in-container mobile driver produced no verdict: ' + out.slice(-200))
  return { verdict: JSON.parse(line.slice('SRBVERDICT:'.length)), mounts }
}

export async function scoreMobileUi(workspaceDir) {
  const appPath = join(workspaceDir, 'spec-dashboard/src/App.jsx')
  const { verdict: v, mounts } = runRace(appPath)
  const checks = [
    { name: 'single-refresh-updates', ok: !!v?.single?.updated, evidence: `#srb-sessions="${v?.single?.text}"` },
    { name: 'race-latest-issued-wins', ok: !!v?.race?.freshWins, evidence: `#srb-sessions="${v?.race?.text}"` },
    { name: 'race-stale-dropped', ok: v?.race && !v.race.staleAppeared, evidence: `staleAppeared=${v?.race?.staleAppeared}` },
  ]
  return { scorer: 'behavioral:browser-dom-board-poll-race (docker --network none)', provenance: { image: SCORER_IMAGE, imageId: scorerImageId(), mounts }, checks, passed: checks.filter((c) => c.ok).length, total: checks.length, verdict: v }
}

// (1) NEVER-UPDATES pseudo-implementation: issues the mount reload but never applies the response.
// The independent no-poll single-refresh harness must reject it (board text never becomes 'solo').
const NEVER_UPDATES_APP = `import React from 'react'
import { loadBoard } from './data.js'
import MobileApp from './MobileApp.jsx'
export default function App() {
  React.useEffect(() => { loadBoard() }, [])
  return React.createElement(MobileApp, { sessions: [] })
}
`

// (1) controls: the COMMITTED post-episode tree must pass 3/3; BOTH negatives must be rejected —
// the unchanged pre-state tree (race not fixed) and the never-updates pseudo-impl (no refresh at all).
export async function scoreControlsMobile(repoRoot, positiveSha, negativeSha) {
  const matDir = () => { const d = mkdtempSync(join(tmpdir(), 'srb-app-')); execFileSync('bash', ['-c', `mkdir -p ${d}/spec-dashboard/src`]); return d }
  const mat = (sha) => { const d = matDir(); writeFileSync(join(d, 'spec-dashboard/src/App.jsx'), execFileSync('git', ['-C', repoRoot, 'show', `${sha}:spec-dashboard/src/App.jsx`], { encoding: 'utf8' })); return d }
  const posDir = mat(positiveSha), negDir = mat(negativeSha)
  const nuDir = matDir(); writeFileSync(join(nuDir, 'spec-dashboard/src/App.jsx'), NEVER_UPDATES_APP)
  try {
    const pos = await scoreMobileUi(posDir)
    const negUnchanged = await scoreMobileUi(negDir)
    const negNever = await scoreMobileUi(nuDir)
    const row = (r, extra) => ({ ...extra, passed: r.passed, total: r.total, checks: r.checks })
    return {
      discriminates: pos.passed === pos.total && negUnchanged.passed < negUnchanged.total && negNever.passed < negNever.total,
      provenance: pos.provenance,   // image id + mount digests — recorded by pilot check, re-bound by the phase
      positive: row(pos, { sha: positiveSha }),
      negatives: { unchanged: row(negUnchanged, { sha: negativeSha }), neverUpdates: row(negNever, { impl: 'never-updates' }) },
    }
  } finally { for (const d of [posDir, negDir, nuDir]) rmSync(d, { recursive: true, force: true }) }
}
