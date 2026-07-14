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

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const NODE_DIST = '/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64'
const CHROME_DIR = '/home/jeffry/.cache/ms-playwright/chromium-1228'     // contains chrome-linux64/chrome
const SCORER_IMAGE = 'scb-scorer:chromium'
const INCONTAINER = join(HERE, 'browser-incontainer.mjs')
const NM = (() => { try { return execFileSync('readlink', ['-f', join(ROOT, 'spec-dashboard/node_modules')], { encoding: 'utf8' }).trim() } catch { return join(ROOT, 'spec-dashboard/node_modules') } })()
let IMAGE_ID = null
function scorerImageId() {
  if (IMAGE_ID) return IMAGE_ID
  IMAGE_ID = execFileSync('docker', ['image', 'inspect', SCORER_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim()
  return IMAGE_ID
}

// run the produced App.jsx through the in-container driver (esbuild + chromium, no network). Returns the
// verdict {single, race}. The produced file is mounted read-only; nothing host-writable is exposed.
function runRace(appJsxPath) {
  const out = execFileSync('timeout', ['180', 'docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000',
    '-e', 'HOME=/home/agent',
    '--tmpfs', '/work/out:exec,uid=1000', '--tmpfs', '/tmp:exec,uid=1000', '--tmpfs', '/home/agent:exec,uid=1000',
    '-v', `${NM}:/work/node_modules:ro`, '-v', `${INCONTAINER}:/work/browser-incontainer.mjs:ro`,
    '-v', `${appJsxPath}:/opt/app/App.jsx:ro`, '-v', `${NODE_DIST}:/opt/node:ro`, '-v', `${CHROME_DIR}:/opt/chromium:ro`,
    scorerImageId(), '/opt/node/bin/node', '/work/browser-incontainer.mjs', '/opt/app/App.jsx'],
    { encoding: 'utf8', timeout: 210_000, maxBuffer: 32 * 1024 * 1024 })
  const line = out.split('\n').find((l) => l.startsWith('SRBVERDICT:'))
  if (!line) throw new Error('in-container mobile driver produced no verdict: ' + out.slice(-200))
  return JSON.parse(line.slice('SRBVERDICT:'.length))
}

export async function scoreMobileUi(workspaceDir) {
  const appPath = join(workspaceDir, 'spec-dashboard/src/App.jsx')
  const v = runRace(appPath)
  const checks = [
    { name: 'single-refresh-updates', ok: !!v?.single?.updated, evidence: `#srb-sessions="${v?.single?.text}"` },
    { name: 'race-latest-issued-wins', ok: !!v?.race?.freshWins, evidence: `#srb-sessions="${v?.race?.text}"` },
    { name: 'race-stale-dropped', ok: v?.race && !v.race.staleAppeared, evidence: `staleAppeared=${v?.race?.staleAppeared}` },
  ]
  return { scorer: 'behavioral:browser-dom-board-poll-race (docker --network none)', checks, passed: checks.filter((c) => c.ok).length, total: checks.length, verdict: v }
}

export async function scoreControlsMobile(repoRoot, positiveSha, negativeSha) {
  const mat = (sha) => {
    const d = mkdtempSync(join(tmpdir(), 'srb-app-'))
    execFileSync('bash', ['-c', `mkdir -p ${d}/spec-dashboard/src`])
    writeFileSync(join(d, 'spec-dashboard/src/App.jsx'), execFileSync('git', ['-C', repoRoot, 'show', `${sha}:spec-dashboard/src/App.jsx`], { encoding: 'utf8' }))
    return d
  }
  const posDir = mat(positiveSha), negDir = mat(negativeSha)
  try {
    const pos = await scoreMobileUi(posDir)
    const neg = await scoreMobileUi(negDir)
    return { discriminates: pos.passed === pos.total && neg.passed < neg.total, positive: { sha: positiveSha, passed: pos.passed, total: pos.total, checks: pos.checks }, negative: { sha: negativeSha, passed: neg.passed, total: neg.total, checks: neg.checks } }
  } finally { rmSync(posDir, { recursive: true, force: true }); rmSync(negDir, { recursive: true, force: true }) }
}
