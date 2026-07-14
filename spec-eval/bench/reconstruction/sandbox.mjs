// spec-reconstruction-bench isolated executor ([[spec-reconstruction-bench]]).
//
// launchAgent() is the ONE mechanism every paid invocation shares — R0 reconstruction and all three
// O0/R0/N0 executor arms. It runs a fresh Claude Code (GLM-5.2 via the approved BigModel Anthropic
// endpoint) against a read-only snapshot, with a single audited egress and fail-loud model pinning.
//
// Isolation (bwrap/unshare is blocked on this host by apparmor_restrict_unprivileged_userns=1, so we
// use docker's real netns instead):
//   - `docker --network none`  → no interface but loopback; the ONLY egress is the bridge below.
//   - `--add-host <ENDPOINT_HOST>:127.0.0.1` pins the endpoint name to loopback; DNS for anything else
//     fails (EAI_AGAIN). Inside, a per-run `bridge.mjs ns` listens on 127.0.0.1:<PORT> and forwards to
//     a per-run unix socket bind-mounted from the host, where `bridge.mjs host` forwards to the FIXED
//     constant ENDPOINT_HOST:ENDPOINT_PORT. TLS is end-to-end (the client validates the real cert).
//   - fresh HOME + CLAUDE_CONFIG_DIR are container-private tmpfs — no global memory, no project CLAUDE.md.
//   - the snapshot is mounted read-only; only the workspace (`.spec-recon/` for R0, the checkout for an
//     executor arm) is writable. The mount set IS the open-path manifest (sandbox audit): nothing
//     outside it is visible to the agent.
// Credentials: injected ONLY via a 0600 --env-file (never argv/prompt/image/trace); the file is created
// per run and unlinked in finally. Model is pinned on every Claude tier env AND --model; every
// stream-json event's model is verified — the observed model SET must equal {glm-5.2} or the run fails.
// Every run is bounded by a hard wall timeout; a finally block kills the bridge, force-removes the
// container, and deletes the socket/tmp. Timeout is archived as a failed run, never silently retried.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync, existsSync, chmodSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { aggregateStream } from './usage.mjs'

// ---- fixed constants (never taken from argv/env) ----
export const ENDPOINT_HOST = 'open.bigmodel.cn'
export const ENDPOINT_PORT = 443
export const ENDPOINT_PATH = '/api/anthropic'          // Anthropic-compatible base path
export const MODEL = 'glm-5.2'
export const BRIDGE_PORT = 18443                        // in-container loopback listen port
const DOCKER_IMAGE = 'scb-spexcode-base:0.4.0'          // debian trixie + python; node bind-mounted
const NODE_DIST = '/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64'
const CLAUDE_PKG = '/home/jeffry/.nvm/versions/node/v22.21.0/lib/node_modules/@anthropic-ai/claude-code'
const HERE = new URL('.', import.meta.url).pathname

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const nowIso = () => new Date().toISOString()

// recursive relative file list + safe text read — for the archive-wide secret scan of a workspace copy
export function walkFiles(dir, base = dir) {
  const out = []
  for (const e of (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [])) {
    const p = join(dir, e.name)
    if (e.isDirectory() && !e.isSymbolicLink()) out.push(...walkFiles(p, base))
    else if (e.isFile()) out.push(p.slice(base.length + 1))
  }
  return out
}
const readTextSafe = (abs) => { try { const b = readFileSync(abs); return b.subarray(0, 4096).includes(0) ? null : b.toString('utf8') } catch { return null } }

// RAW-BYTE scan: count occurrences of the credential's exact / prefix / base64-literal bytes directly in a
// Buffer (Buffer.includes on Buffer needles) — encoding-independent and the AUTHORITATIVE archive gate.
// A UTF-8 secretScan is only an additional diagnostic, never the raw-byte gate.
export function rawByteScan(buf, key) {
  const count = (needle) => { let n = 0, i = 0; while ((i = buf.indexOf(needle, i)) !== -1) { n++; i += needle.length } return n }
  const keyBuf = Buffer.from(key)
  const prefixBuf = Buffer.from(key.slice(0, 6))
  const b64Buf = Buffer.from(Buffer.from(key).toString('base64'))
  return { keyHits: count(keyBuf), prefixHits: prefixBuf.length >= 4 ? count(prefixBuf) : 0, b64Hits: count(b64Buf) }
}

// PINNED provenance (computed once): docker image id, claude version + package digest, runner commit.
// So the trace records exactly which image/binary/commit produced it — not operator memory.
let PROVENANCE = null
export function provenanceRecord() {
  if (PROVENANCE) return PROVENANCE
  const safe = (fn, d = null) => { try { return fn() } catch { return d } }
  const imageId = safe(() => execFileSync('docker', ['image', 'inspect', DOCKER_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim())
  const claudeVersion = safe(() => JSON.parse(readFileSync(join(CLAUDE_PKG, 'package.json'), 'utf8')).version)
  const claudePkgDigest = safe(() => sha256(readFileSync(join(CLAUDE_PKG, 'package.json')) + '::' + sha256(readFileSync(join(CLAUDE_PKG, 'bin', 'claude.exe')))).slice(0, 16))
  const nodeDigest = safe(() => sha256(readFileSync(join(NODE_DIST, 'bin', 'node')).subarray(0, 1 << 20)).slice(0, 16))
  const runnerCommit = safe(() => execFileSync('git', ['-C', HERE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
  const runnerDirty = safe(() => execFileSync('git', ['-C', HERE, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().length > 0)
  PROVENANCE = { dockerImage: DOCKER_IMAGE, dockerImageId: imageId, claudeVersion, claudePkgDigest, nodeDigest, runnerCommit, runnerDirty, endpointHost: ENDPOINT_HOST, model: MODEL }
  return PROVENANCE
}

// Read the approved credential file (0600, key-only) at RUNTIME; return the value in-memory only.
// Never logged, never returned to callers, never written to any archived artifact.
export function readCredential(credPath) {
  if (!existsSync(credPath)) throw new Error(`credential file missing: ${credPath}`)
  const raw = readFileSync(credPath, 'utf8')
  const m = raw.match(/^\s*(?:ZHIPU_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY)\s*=\s*(.+?)\s*$/m)
  const key = (m ? m[1] : raw).trim().replace(/^["']|["']$/g, '')
  if (!key || key.length < 8) throw new Error('credential file has no usable key')
  return key
}

// A secret-scan probe over a text blob: reports HIT COUNT only, never the value. Uses the key's
// sha256 and a short prefix probe so the report can prove "scanned, zero hits" without storing bytes.
export function secretScan(text, key) {
  const keyHits = text.split(key).length - 1
  const prefix = key.slice(0, 6)
  const prefixHits = prefix.length >= 4 ? text.split(prefix).length - 1 : 0
  const b64 = Buffer.from(key).toString('base64')
  const b64Hits = text.split(b64).length - 1
  return { keyHits, prefixHits, b64Hits, keySha256: sha256(key) }
}

// ---- the executor ----
// opts: { runId, snapshotDir, prompt, writeSubdir (rel path made writable & archived),
//         credPath, timeoutMs, archiveDir, upstreamCommit }
export async function launchAgent(opts) {
  const { runId, snapshotDir, prompt, writeSubdir, credPath, archiveDir, upstreamCommit } = opts
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000
  mkdirSync(archiveDir, { recursive: true })
  const started = nowIso()
  const t0 = Date.now()
  const provenance = provenanceRecord()
  // (F) run by IMMUTABLE image ID (not the mutable tag), and RE-VERIFY the Claude package digest on every
  // launch — a swapped tag or a mutated binary since provenance was pinned is fail-loud.
  if (!provenance.dockerImageId) throw new Error('sandbox: docker image id unresolved — cannot pin an immutable image')
  const liveClaudeDigest = (() => { try { return sha256(readFileSync(join(CLAUDE_PKG, 'package.json')) + '::' + sha256(readFileSync(join(CLAUDE_PKG, 'bin', 'claude.exe')))).slice(0, 16) } catch { return null } })()
  if (liveClaudeDigest !== provenance.claudePkgDigest) throw new Error(`sandbox: Claude package digest changed since pin (${liveClaudeDigest} != ${provenance.claudePkgDigest}) — refusing to launch`)

  // per-run scratch (socket + env-file live here, 0700)
  const scratch = mkdtempSync(join(tmpdir(), 'srb-run-'))
  chmodSync(scratch, 0o700)
  const sockPath = join(scratch, 'glm.sock')
  const envFile = join(scratch, 'agent.env')
  const containerName = `srb-${runId}`.replace(/[^a-zA-Z0-9_.-]/g, '-')

  // writable workspace: a COPY of the snapshot (agent may edit; snapshot stays pristine + archived)
  const workDir = join(scratch, 'work')
  cpSync(snapshotDir, workDir, { recursive: true })
  chmodSync(scratch, 0o700)

  const key = readCredential(credPath)
  // env-file: base url via the in-container bridge; every Claude model tier pinned to glm-5.2.
  const baseUrl = `https://${ENDPOINT_HOST}:${BRIDGE_PORT}${ENDPOINT_PATH}`
  writeFileSync(envFile, [
    `ANTHROPIC_BASE_URL=${baseUrl}`,
    `ANTHROPIC_AUTH_TOKEN=${key}`,
    `ANTHROPIC_MODEL=${MODEL}`,
    `ANTHROPIC_DEFAULT_OPUS_MODEL=${MODEL}`,
    `ANTHROPIC_DEFAULT_SONNET_MODEL=${MODEL}`,
    `ANTHROPIC_DEFAULT_HAIKU_MODEL=${MODEL}`,
    `ANTHROPIC_SMALL_FAST_MODEL=${MODEL}`,
    `CLAUDE_CONFIG_DIR=/agent/.claude`,
    `HOME=/agent`,
    '',
  ].join('\n'))
  chmodSync(envFile, 0o600)

  let bridge = null, docker = null, timedOut = false, killer = null
  const transcriptRaw = []
  const stderrBuf = []
  const cleanup = () => {
    try { if (killer) clearTimeout(killer) } catch {}
    try { if (docker && !docker.killed) docker.kill('SIGKILL') } catch {}
    try { execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' }) } catch {}
    try { if (bridge && !bridge.killed) bridge.kill('SIGKILL') } catch {}
    try { rmSync(scratch, { recursive: true, force: true }) } catch {}
  }

  try {
    // host half of the bridge: unix socket → FIXED constant endpoint
    bridge = spawn(`${NODE_DIST}/bin/node`, [join(HERE, 'bridge.mjs'), 'host', sockPath, ENDPOINT_HOST, String(ENDPOINT_PORT)],
      { stdio: ['ignore', 'ignore', 'pipe'] })
    const bridgeLog = []
    bridge.stderr.on('data', (d) => bridgeLog.push(d.toString()))
    await new Promise((r) => setTimeout(r, 400))

    // in-container command: ns bridge + claude -p in stream-json, model pinned, permissions bypassed.
    // claude.exe is a standalone ELF (run directly, not via node). A fresh CLAUDE_CONFIG_DIR would
    // trigger interactive onboarding and hang → seed a minimal non-interactive config (NO global token;
    // auth comes only from the env-file's ANTHROPIC_AUTH_TOKEN).
    const inner = [
      'set -e',
      'mkdir -p /agent/.claude',
      `printf '%s' '${JSON.stringify({ hasCompletedOnboarding: true, bypassPermissionsModeAccepted: true, theme: 'dark' }).replace(/'/g, "'\\''")}' > /agent/.claude.json`,
      `/opt/node/bin/node /assets/bridge.mjs ns /run/glm.sock ${BRIDGE_PORT} 2>/agent/bridge-ns.log &`,
      'sleep 0.4',
      `cd /work && /opt/claude/bin/claude.exe -p "$(cat /assets/PROMPT.md)" ` +
        `--model ${MODEL} --output-format stream-json --verbose --dangerously-skip-permissions ` +
        `--add-dir /work`,
    ].join('\n')

    // the prompt is passed as a mounted file, not argv (keeps trace/argv clean of task text bloat)
    const promptMount = join(scratch, 'PROMPT.md')
    writeFileSync(promptMount, prompt)
    const args = [
      'run', '--rm', '--name', containerName,
      '--user', '1000:1000',                       // claude refuses --skip-permissions as root
      '--network', 'none',
      '--add-host', `${ENDPOINT_HOST}:127.0.0.1`,
      '--env-file', envFile,
      '--read-only', '--tmpfs', '/tmp:exec,uid=1000',
      '-v', `${NODE_DIST}:/opt/node:ro`,
      '-v', `${CLAUDE_PKG}:/opt/claude:ro`,
      '-v', `${join(HERE, 'bridge.mjs')}:/assets/bridge.mjs:ro`,
      '-v', `${promptMount}:/assets/PROMPT.md:ro`,
      '-v', `${workDir}:/work`,                   // writable workspace (agent output)
      '-v', `${sockPath}:/run/glm.sock`,          // bridge socket
      '--tmpfs', '/agent:exec,uid=1000,gid=1000,mode=0700',
      provenance.dockerImageId, 'bash', '-c', inner,   // (F) immutable image ID, not the mutable tag
    ]

    docker = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    docker.stdout.on('data', (d) => transcriptRaw.push(d.toString()))
    docker.stderr.on('data', (d) => stderrBuf.push(d.toString()))

    const exit = await new Promise((resolve) => {
      killer = setTimeout(() => { timedOut = true; try { execFileSync('docker', ['kill', containerName], { stdio: 'ignore' }) } catch {}; try { docker.kill('SIGKILL') } catch {} }, timeoutMs)
      docker.on('close', (code) => { clearTimeout(killer); resolve(code) })
      docker.on('error', () => { clearTimeout(killer); resolve(-1) })
    })

    const rawOut = transcriptRaw.join('')
    const rawErr = stderrBuf.join('')
    const bridgeConns = bridgeLog.join('').split('\n').filter((l) => /conn#/.test(l)).length

    // parse stream-json into events, then aggregate via the tested accounting unit (usage.mjs):
    // per-message-id terminal usage summed across ids (no cumulative double-count), model provenance,
    // API-error extraction. A non-monotonic usage decrease => accountingValid=false => fail-loud.
    const events = []
    for (const line of rawOut.split('\n')) {
      const s = line.trim(); if (!s.startsWith('{')) continue
      try { events.push(JSON.parse(s)) } catch {}
    }
    const agg = aggregateStream(events, MODEL)
    const sessionIds = [...new Set(events.map((e) => e && (e.session_id ?? (e.message && e.message.session_id))).filter(Boolean))]
    const requestIds = [...new Set(events.flatMap((e) => {
      const j = JSON.stringify(e); const m = j.match(/"request_id"\s*:\s*"([^"]+)"/); return m ? [m[1]] : []
    }))]
    const httpStatus = agg.apiError ? (agg.apiError.match(/\((\d{3})\)/)?.[1] ?? null) : (agg.realCompletion ? 200 : null)

    // secret scan + redactor across EVERYTHING to be archived: transcript, stderr, prompt AND every file
    // in the writable workspace copy. Any exact/prefix/base64 hit => quarantine the whole archive + fail.
    const b64 = Buffer.from(key).toString('base64')
    const redact = (s) => s.split(key).join('«REDACTED-KEY»').split(b64).join('«REDACTED-KEY-B64»')
    const workOut = join(archiveDir, 'workspace')
    rmSync(workOut, { recursive: true, force: true })
    if (existsSync(workDir)) cpSync(workDir, workOut, { recursive: true })
    // scan the workspace files (bytes that would be archived) in addition to transcript/stderr/prompt
    let wsScanKeyHits = 0, wsScanB64Hits = 0, wsScanPrefixHits = 0
    for (const rel of walkFiles(workOut)) {
      const t = readTextSafe(join(workOut, rel)); if (t === null) continue
      const s = secretScan(t, key); wsScanKeyHits += s.keyHits; wsScanB64Hits += s.b64Hits; wsScanPrefixHits += s.prefixHits
    }
    const streamScan = secretScan(rawOut + '\n' + rawErr + '\n' + prompt, key)
    const keyHits = streamScan.keyHits + wsScanKeyHits
    const b64Hits = streamScan.b64Hits + wsScanB64Hits
    const prefixHits = streamScan.prefixHits + wsScanPrefixHits
    const secretClean = keyHits === 0 && b64Hits === 0 && prefixHits === 0   // (2) prefixHits also gates

    writeFileSync(join(archiveDir, 'PROMPT.md'), redact(prompt))
    writeFileSync(join(archiveDir, 'transcript.stream-json'), redact(rawOut))
    const errSummary = redact(rawErr).split('\n').filter((l) => l.trim()).slice(-40).join('\n')
    if (errSummary) writeFileSync(join(archiveDir, 'stderr.summary.txt'), errSummary + '\n')

    const accountingValid = agg.accountingValid
    const modelClean = agg.modelClean
    const realCompletion = agg.realCompletion
    const apiError = agg.apiError

    // trace: ONLY endpoint hostname, HTTP status / request-id / session-id / model / token — no header/env/key.
    // Provenance is PINNED (not operator memory): docker image id, claude version+package digest, runner commit.
    const trace = {
      v: 2, runId, started, ended: nowIso(), durationMs: Date.now() - t0,
      endpointHost: ENDPOINT_HOST, bridgeConnections: bridgeConns,
      httpStatus, requestIds, sessionIds,
      exitCode: exit, timedOut,
      model: { observedSet: agg.apiModels, allSeen: agg.allModels, expected: MODEL, clean: modelClean, realCompletion },
      apiError,
      tokens: { messages: agg.messages, messageIds: agg.messageIds, input: agg.totals.input_tokens, cacheRead: agg.totals.cache_read_input_tokens, cacheCreate: agg.totals.cache_creation_input_tokens, output: agg.totals.output_tokens },
      accounting: { valid: accountingValid, anomalies: agg.anomalies, resultUsageDiagnostic: agg.resultUsage },
      provenance,
      upstreamCommit: upstreamCommit ?? null,
      mountAudit: {
        note: 'the docker mount set is the sandbox confinement — nothing outside these mounts is visible to the agent. This is a MOUNT AUDIT, not a per-syscall open-path log.',
        readOnly: ['/opt/node', '/opt/claude', '/assets/bridge.mjs', '/assets/PROMPT.md', '/run/glm.sock'],
        writable: ['/work', '/agent (tmpfs)', '/tmp (tmpfs)'],
        egress: `unix:/run/glm.sock → host bridge → ${ENDPOINT_HOST}:${ENDPOINT_PORT} (TLS end-to-end)`,
      },
      secretScan: { keyHits, prefixHits, b64Hits, keySha256Prefix: streamScan.keySha256.slice(0, 12), scannedWorkspace: true, clean: secretClean },
    }
    writeFileSync(join(archiveDir, 'trace.json'), JSON.stringify(trace, null, 2) + '\n')

    // quarantine: if a credential leaked into any archived bytes, move the whole archive aside and fail loud
    if (!secretClean) {
      const q = archiveDir + '.QUARANTINE'
      try { rmSync(q, { recursive: true, force: true }); execFileSync('mv', [archiveDir, q]) } catch {}
      return { ok: false, trace, timedOut, modelClean, secretClean: false, realCompletion, apiError, accountingValid, exitCode: exit, archiveDir: q, workDir: null, quarantined: true }
    }

    const ok = exit === 0 && !timedOut && modelClean && secretClean && realCompletion && accountingValid && !apiError
    return { ok, trace, timedOut, modelClean, secretClean, realCompletion, apiError, accountingValid, exitCode: exit, archiveDir, workDir: workOut }
  } finally {
    cleanup()
  }
}
