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
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync, existsSync, chmodSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

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
      DOCKER_IMAGE, 'bash', '-c', inner,
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

    // parse stream-json: collect model set + token totals, per assistant message
    const events = []
    for (const line of rawOut.split('\n')) {
      const s = line.trim(); if (!s.startsWith('{')) continue
      try { events.push(JSON.parse(s)) } catch {}
    }
    const modelSet = new Set()
    let inTok = 0, cacheReadTok = 0, outTok = 0, msgCount = 0, assistantText = ''
    for (const e of events) {
      const msg = e.message ?? e
      if (msg && msg.model) modelSet.add(msg.model)
      const u = msg?.usage
      if (u) { msgCount++; inTok += u.input_tokens ?? 0; cacheReadTok += u.cache_read_input_tokens ?? 0; outTok += u.output_tokens ?? 0 }
      if (e.type === 'result' && typeof e.result === 'string') assistantText += e.result
    }
    const modelClean = modelSet.size === 1 && modelSet.has(MODEL)

    // secret scan across the raw transcript/stderr/prompt BEFORE archiving anything
    const scanBlob = rawOut + '\n' + rawErr + '\n' + prompt
    const scan = secretScan(scanBlob, key)
    const secretClean = scan.keyHits === 0 && scan.b64Hits === 0
    // redactor: mask any credential occurrence (defence-in-depth) before bytes hit disk
    const b64 = Buffer.from(key).toString('base64')
    const redact = (s) => s.split(key).join('«REDACTED-KEY»').split(b64).join('«REDACTED-KEY-B64»')

    // archive: prompt, transcript (redacted), sanitized stderr summary, workspace, trace
    const workOut = join(archiveDir, 'workspace')
    rmSync(workOut, { recursive: true, force: true })
    if (existsSync(workDir)) cpSync(workDir, workOut, { recursive: true })
    writeFileSync(join(archiveDir, 'PROMPT.md'), prompt)
    writeFileSync(join(archiveDir, 'transcript.stream-json'), redact(rawOut))
    // NO raw stderr dump — only a redacted, capped summary (last 40 non-empty lines)
    const errSummary = redact(rawErr).split('\n').filter((l) => l.trim()).slice(-40).join('\n')
    if (errSummary) writeFileSync(join(archiveDir, 'stderr.summary.txt'), errSummary + '\n')

    // trace: ONLY endpoint hostname, status/request-id/model/token — no header/env/key
    const trace = {
      v: 1, runId, started, ended: nowIso(), durationMs: Date.now() - t0,
      endpointHost: ENDPOINT_HOST, bridgeConnections: bridgeConns,
      exitCode: exit, timedOut,
      model: { observedSet: [...modelSet], expected: MODEL, clean: modelClean },
      tokens: { messages: msgCount, input: inTok, cacheRead: cacheReadTok, output: outTok },
      upstreamCommit: upstreamCommit ?? null,
      openPathManifest: {
        note: 'docker mount set is the sandbox audit (nothing outside is visible to the agent)',
        readOnly: ['/opt/node', '/opt/claude', '/assets/bridge.mjs', '/assets/PROMPT.md', '/run/glm.sock'],
        writable: ['/work', '/agent (tmpfs)', '/tmp (tmpfs)'],
        egress: `unix:/run/glm.sock → host bridge → ${ENDPOINT_HOST}:${ENDPOINT_PORT} (TLS end-to-end)`,
      },
      secretScan: { keyHits: scan.keyHits, prefixHits: scan.prefixHits, b64Hits: scan.b64Hits, keySha256Prefix: scan.keySha256.slice(0, 12), clean: secretClean },
    }
    writeFileSync(join(archiveDir, 'trace.json'), JSON.stringify(trace, null, 2) + '\n')

    const ok = exit === 0 && !timedOut && modelClean && secretClean
    return { ok, trace, timedOut, modelClean, secretClean, exitCode: exit, archiveDir, workDir: workOut, assistantText }
  } finally {
    cleanup()
  }
}
