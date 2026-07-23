#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SPEX = join(ROOT, 'spec-cli/bin/spex.mjs')
const TMUX_SOCK = 'spexcode'
const SETTLED = new Set(['asking', 'awaiting', 'parked', 'idle', 'review', 'done', 'close-pending'])
const ROUTES = [
  { id: 'launch', label: 'launch first prompt' },
  { id: 'dashboard-note', label: 'dashboard note composer' },
  { id: 'cli-send', label: 'CLI session send' },
]
const TIMINGS = [
  { id: 'idle', label: 'idle/wake' },
  { id: 'in-turn', label: 'in-turn steer/queue' },
]
const LIVE_CONTEXTS = new Set()
const ISSUE_HEADLESS_WORKING = 'headless-session-turn-agent-working-online-242b6'
const ISSUE_OPENCODE_PROVIDER = 'opencode-headless-spawn-turn-no-provider-availab'

const ADAPTERS = [
  { id: 'claude', launcher: 'claude', node: 'harness-adapter', headless: false, wallMs: 300_000 },
  { id: 'codex', launcher: 'codex', node: 'harness-adapter', headless: false, wallMs: 300_000 },
  { id: 'pi', launcher: 'pi', node: 'pi-harness', headless: false, wallMs: 480_000 },
  { id: 'opencode', launcher: 'opencode', node: 'opencode-harness', headless: false, wallMs: 360_000 },
  { id: 'claude-headless', launcher: 'claude-headless', node: 'claude-headless', headless: true, wallMs: 360_000 },
  { id: 'codex-headless', launcher: 'codex-headless', node: 'codex-headless', headless: true, wallMs: 360_000 },
  { id: 'pi-headless', launcher: 'pi-headless', node: 'pi-headless', headless: true, wallMs: 480_000 },
  { id: 'opencode-headless', launcher: 'opencode-headless', node: 'opencode-headless', headless: true, wallMs: 360_000 },
]

const NODE_DIRS = {
  'harness-adapter': '.spec/spexcode/spec-cli/sessions/harness-adapter',
  'pi-harness': '.spec/spexcode/spec-cli/sessions/harness-adapter/pi-harness',
  'opencode-harness': '.spec/spexcode/spec-cli/sessions/harness-adapter/opencode-harness',
  'claude-headless': '.spec/spexcode/spec-cli/sessions/harness-adapter/claude-headless',
  'codex-headless': '.spec/spexcode/spec-cli/sessions/harness-adapter/codex-headless',
  'pi-headless': '.spec/spexcode/spec-cli/sessions/harness-adapter/pi-headless',
  'opencode-headless': '.spec/spexcode/spec-cli/sessions/harness-adapter/opencode-headless',
}

function usage() {
  console.log(`usage: node spec-eval/scenarios/harness-delivery-campaign.mjs [options]

Runs the 8 harness forms x 3 prompt routes x 2 timings delivery campaign through real product surfaces.

  --plan                         print the 42-cell plan and exit
  --sync-scenarios               sync generated cell contracts into adapter eval.md files
  --only <harness,...>           run only the named harness forms
  --cells <route:timing,...>     run only selected cells (a worker launch is still required)
  --profile <harness=launcher>   override a launcher profile (repeatable)
  --api <url>                    backend URL (default SPEXCODE_API_URL or http://127.0.0.1:8787)
  --output <path>                write the final Markdown table/transcript to this path
  --no-file                      measure without filing eval readings
  --help                         show this help

Example for this host:
  node spec-eval/scenarios/harness-delivery-campaign.mjs --profile claude=reclaude`)
}

function parseArgs(argv) {
  const opts = {
    api: process.env.SPEXCODE_API_URL || 'http://127.0.0.1:8787',
    baseline: null,
    cells: null,
    file: true,
    only: null,
    output: null,
    plan: false,
    profiles: new Map(),
    sync: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help') { usage(); process.exit(0) }
    else if (arg === '--plan') opts.plan = true
    else if (arg === '--sync-scenarios') opts.sync = true
    else if (arg === '--no-file') opts.file = false
    else if (arg === '--api') opts.api = argv[++i]
    else if (arg === '--output') opts.output = argv[++i]
    else if (arg === '--only') opts.only = new Set((argv[++i] || '').split(',').filter(Boolean))
    else if (arg === '--cells') opts.cells = new Set((argv[++i] || '').split(',').filter(Boolean))
    else if (arg === '--profile') {
      const [id, launcher, extra] = (argv[++i] || '').split('=')
      if (!id || !launcher || extra) throw new Error('--profile needs <harness=launcher>')
      opts.profiles.set(id, launcher)
    } else throw new Error(`unknown option: ${arg}`)
  }
  return opts
}

function cellName(adapterId, route, timing) {
  return `delivery-combo-${adapterId}-${route}-${timing}`
}

function allCells(adapters = ADAPTERS) {
  return adapters.flatMap((adapter) => ROUTES.flatMap((route) => TIMINGS.map((timing) => ({ adapter, route, timing }))))
}

function generatedScenarioBlock(cells) {
  const rows = []
  for (const { adapter, route, timing } of cells) {
    const name = cellName(adapter.id, route.id, timing.id)
    const destination = route.id === 'dashboard-note' || adapter.headless
      ? 'a timeline status note containing the answer marker'
      : 'the interactive TUI pane containing the answer marker'
    const blocked = route.id === 'launch' && timing.id === 'in-turn'
    rows.push(
      `  - name: ${name}`,
      '    tags: [backend-api, cli]',
      `    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "${adapter.id} / ${route.id} / ${timing.id}" }`,
      '    description: >-',
      `      Through the real ${adapter.id} launcher, measure the ${route.label} path at ${timing.label}: use`,
      '      only `spex session new`, the public `/api/sessions/:id/input` route, or plain',
      '      `spex session send`, then read the public timeline/board and the real pane where applicable.',
      '    expected: >-',
      ...(blocked
        ? [
            '      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be',
            '      injected into a pre-existing in-progress turn. The runner invents no substitute launch or',
            '      private transport, and the remaining launch/idle cell carries launch-path coverage.',
          ]
        : [
            `      Delivery is confirmed by the native product surface; the answer is readable as ${destination};`,
            '      every observed liveness value is truthful for the live session; and a post-delivery authored',
            '      declaration is present. A missing default note hint on a headless target is a failure.',
          ]),
    )
  }
  return rows.join('\n')
}

function aggregateScenarioBlock() {
  return [
    '  - name: harness-delivery-combination-campaign',
    '    tags: [backend-api, cli]',
    '    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "8 x 3 x 2 aggregate" }',
    '    description: >-',
    '      Run the full delivery campaign across four interactive and four headless harness forms, three prompt',
    '      origins, and idle versus in-turn timing. Preserve one real conversation per launcher so channel',
    '      transitions are exercised, and aggregate every cell transcript into one Markdown result table.',
    '    expected: >-',
    '      All 40 runnable cells pass delivery confirmation, answer visibility, liveness, and declaration checks;',
    '      the eight launch/in-turn cells are explicitly BLOCKED as structurally inapplicable; no cell is skipped,',
    '      silently inferred, or replaced by an internal transport.',
  ].join('\n')
}

function syncScenarios() {
  const grouped = new Map()
  for (const cell of allCells()) {
    const list = grouped.get(cell.adapter.node) || []
    list.push(cell)
    grouped.set(cell.adapter.node, list)
  }
  for (const [node, cells] of grouped) {
    const path = join(ROOT, NODE_DIRS[node], 'eval.md')
    const source = readFileSync(path, 'utf8')
    const startMark = '  # harness-delivery-campaign:start'
    const endMark = '  # harness-delivery-campaign:end'
    const generated = [startMark, generatedScenarioBlock(cells), ...(node === 'harness-adapter' ? [aggregateScenarioBlock()] : []), endMark].join('\n')
    let next
    const start = source.indexOf(startMark)
    const end = source.indexOf(endMark)
    if ((start >= 0) !== (end >= 0)) throw new Error(`${path} has an incomplete generated campaign block`)
    if (start >= 0) next = source.slice(0, start) + generated + source.slice(end + endMark.length)
    else {
      const close = source.indexOf('\n---', 4)
      if (close < 0 || !/^---\nscenarios:/s.test(source)) throw new Error(`${path} has no scenarios frontmatter`)
      next = source.slice(0, close) + '\n' + generated + source.slice(close)
    }
    if (next !== source) writeFileSync(path, next)
    console.log(`synced ${cells.length} cells${node === 'harness-adapter' ? ' + aggregate' : ''} -> ${path}`)
  }
}

function runFile(cmd, args, { cwd = ROOT, env = process.env, quiet = false } = {}) {
  return new Promise((resolvePromise) => {
    execFile(cmd, args, { cwd, env, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
      if (!quiet) {
        process.stdout.write(`$ ${cmd === process.execPath ? 'spex' : cmd} ${args.filter((a) => a !== SPEX).join(' ')} -> ${code}\n`)
        if (stdout.trim()) process.stdout.write(`${stdout.trim()}\n`)
        if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`)
      }
      resolvePromise({ code, out: stdout, err: stderr })
    })
  })
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const iso = () => new Date().toISOString()
const trim = (text, max = 3000) => text.length > max ? `${text.slice(0, max)} ...[+${text.length - max}b]` : text

class RunContext {
  constructor(adapter, opts) {
    this.adapter = adapter
    this.api = opts.api.replace(/\/$/, '')
    this.baseline = opts.baseline
    this.launcher = opts.profiles.get(adapter.id) || adapter.launcher
    this.id = null
    this.lines = []
    this.liveness = []
  }

  log(line) {
    const rendered = `[${iso()}] ${line}`
    this.lines.push(rendered)
    console.log(rendered)
  }

  startSlice(label) {
    const start = this.lines.length
    this.log(`--- ${label} ---`)
    return start
  }

  transcript(start) {
    return [
      `harness delivery combination campaign`,
      `baseline=${this.baseline}`,
      `adapter=${this.adapter.id} launcher=${this.launcher} session=${this.id || '(none)'}`,
      ...this.lines.slice(start),
    ].join('\n') + '\n'
  }

  async spex(args, quiet = false) {
    return runFile(process.execPath, [SPEX, ...args, '--api', this.api], { quiet })
  }

  async humanSpex(args) {
    const env = { ...process.env }
    for (const name of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[name]
    return runFile(process.execPath, [SPEX, ...args, '--api', this.api], { env })
  }

  async request(path, init = {}) {
    try {
      const response = await fetch(`${this.api}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(20_000),
      })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      return { ok: response.ok, status: response.status, body }
    } catch (error) {
      return { ok: false, status: 0, body: String(error) }
    }
  }

  async show() {
    if (!this.id) return null
    const result = await this.spex(['session', 'show', this.id, '--json'], true)
    if (result.code !== 0) return null
    try { return JSON.parse(result.out) } catch { return null }
  }

  async timeline() {
    if (!this.id) return []
    const result = await this.request(`/api/sessions/${this.id}/timeline`)
    return result.ok && Array.isArray(result.body?.events) ? result.body.events : []
  }

  async capture() {
    if (!this.id) return ''
    const visible = await this.spex(['session', 'show', this.id, '--capture'], true)
    const history = await runFile('tmux', ['-L', TMUX_SOCK, 'capture-pane', '-p', '-S', '-', '-t', this.id], { quiet: true })
    if (history.code === 0) return history.out
    return visible.code === 0 ? visible.out : ''
  }

  sampleLiveness(show, phase) {
    if (!show) {
      this.liveness.push({ at: iso(), phase, value: 'no-record', lifecycle: 'none' })
      return
    }
    const value = show.liveness || 'unknown'
    const last = this.liveness.at(-1)
    if (!last || last.value !== value || last.phase !== phase || last.lifecycle !== show.lifecycle) {
      this.liveness.push({ at: iso(), phase, value, lifecycle: show.lifecycle })
      this.log(`liveness ${phase}: ${value} (${show.status}/${show.lifecycle})`)
    }
  }

  async waitOnline(wallMs = this.adapter.wallMs) {
    const end = Date.now() + wallMs
    while (Date.now() < end) {
      const show = await this.show()
      this.sampleLiveness(show, 'launch')
      if (show?.liveness === 'online') return show
      await sleep(2500)
    }
    return null
  }

  async waitSettled(wallMs = this.adapter.wallMs) {
    const end = Date.now() + wallMs
    while (Date.now() < end) {
      const show = await this.show()
      this.sampleLiveness(show, 'settle')
      if (show?.liveness === 'online' && SETTLED.has(show.lifecycle)) return show
      await sleep(2500)
    }
    return null
  }

  async launch(prompt) {
    const result = await this.spex(['session', 'new', '--launcher', this.launcher, '--prompt', prompt])
    if (result.code !== 0) return { confirmed: false, detail: `session new exit ${result.code}: ${trim(result.err, 800)}` }
    try {
      const body = JSON.parse(result.out)
      this.id = body.id
      LIVE_CONTEXTS.add(this)
      this.log(`created session ${this.id} at ${body.path || '(unknown path)'}`)
      return { confirmed: Boolean(this.id), detail: `session new exit 0; id=${this.id}` }
    } catch {
      return { confirmed: false, detail: `session new returned non-JSON: ${trim(result.out, 800)}` }
    }
  }

  async send(route, prompt) {
    if (route === 'dashboard-note') {
      const result = await this.request(`/api/sessions/${this.id}/input`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'text', text: prompt, replyVia: 'note' }),
      })
      this.log(`POST /input replyVia:note -> HTTP ${result.status} ${trim(JSON.stringify(result.body), 800)}`)
      return { confirmed: result.ok && result.body?.ok === true, detail: `HTTP ${result.status}; ${JSON.stringify(result.body)}` }
    }
    const result = await this.humanSpex(['session', 'send', this.id, prompt])
    return { confirmed: result.code === 0, detail: `session send exit ${result.code}; ${trim(result.out || result.err, 800)}` }
  }

  async close() {
    if (!this.id) return true
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await this.spex(['session', 'close', this.id])
      if (result.code === 0) { this.log(`closed session ${this.id}`); this.id = null; LIVE_CONTEXTS.delete(this); return true }
      this.log(`close attempt ${attempt} failed`)
      await sleep(2000)
    }
    return false
  }
}

function answerPrompt(token, inTurn = false) {
  const lead = inTurn ? 'A prior delay may still be running. At the next opportunity, replace its final answer with this one. ' : ''
  return `${lead}Make no file changes and use no tools for this answer. Print one short line whose prefix is ${token}= and whose value is the sum of 8 and 9. Do not quote or restate the instruction. When you next stop, obey any reply-channel or lifecycle guidance SpexCode appended to this message.`
}

function prepPrompt(token) {
  return `This is a timing probe. Use the shell tool to run exactly: sleep 30. After it finishes, print ${token}. Do not make file changes. Obey any SpexCode lifecycle guidance when you stop.`
}

function livenessHonest(samples, start) {
  const observed = samples.slice(start)
  return observed.length > 0 && observed.every((sample) =>
    ['starting', 'online'].includes(sample.value) || (sample.value === 'offline' && sample.lifecycle === 'queued'))
}

function withKnownIssues(adapter, detail, observed) {
  const refs = []
  if (adapter.id === 'opencode-headless' && observed.deliver && (!observed.answer || !observed.declaration)) refs.push(ISSUE_OPENCODE_PROVIDER)
  if (adapter.headless && observed.deliver && !observed.declaration && observed.show?.lifecycle === 'active' && observed.show?.liveness === 'online') refs.push(ISSUE_HEADLESS_WORKING)
  return refs.length ? `${detail}; known issue(s): ${refs.join(', ')}` : detail
}

async function observeCell(ctx, { token, expected, timelineStart, livenessStart, wallMs, inTurn }) {
  const startedAt = Date.now()
  const expectsTimeline = ctx.adapter.headless || token.route === 'dashboard-note'
  const end = Date.now() + wallMs
  let pane = ''
  let events = []
  let show = null
  let declaration = null
  let sawActive = false
  let response = false
  let settledWithoutAnswerAt = 0
  while (Date.now() < end) {
    show = await ctx.show()
    ctx.sampleLiveness(show, 'cell')
    if (show?.lifecycle === 'active') sawActive = true
    events = await ctx.timeline()
    const fresh = events.slice(timelineStart)
    declaration ||= fresh.find((event) => event.kind === 'status' && !['active', 'launch-queued'].includes(event.status)) || null
    if (!declaration && sawActive && show?.liveness === 'online' && SETTLED.has(show.lifecycle)) {
      declaration = { status: show.lifecycle, note: show.note ?? null, source: 'live board transition' }
    }
    if (ctx.adapter.headless || token.route === 'dashboard-note') {
      response = fresh.some((event) => event.kind === 'status' && typeof event.note === 'string' && event.note.includes(expected))
    } else {
      pane = await ctx.capture()
      response = pane.includes(expected)
    }
    if (response && declaration && livenessHonest(ctx.liveness, livenessStart)) break
    if (!inTurn && !expectsTimeline && declaration && !response) {
      settledWithoutAnswerAt ||= Date.now()
      if (Date.now() - settledWithoutAnswerAt >= 6000) break
    } else settledWithoutAnswerAt = 0
    if (ctx.adapter.id === 'opencode-headless' && show?.lifecycle === 'active' && !response && !declaration && Date.now() - startedAt >= 30_000) {
      ctx.log(`known failure signature held for 30s: working/online with no answer or declaration (${ISSUE_OPENCODE_PROVIDER}, ${ISSUE_HEADLESS_WORKING})`)
      break
    }
    await sleep(2500)
  }
  if (!pane && !ctx.adapter.headless) pane = await ctx.capture()
  const honest = livenessHonest(ctx.liveness, livenessStart)
  ctx.log(`expected answer ${expected}: ${response ? 'observed' : 'MISSING'}`)
  ctx.log(`declaration after delivery: ${declaration ? `${declaration.status} note=${JSON.stringify(declaration.note)}` : 'MISSING'}`)
  ctx.log(`liveness samples: ${JSON.stringify(ctx.liveness.slice(livenessStart))}`)
  if (pane) ctx.log(`pane tail:\n${trim(pane, 3500)}`)
  return { response, declaration: Boolean(declaration), honest, events: events.slice(timelineStart), show }
}

async function openActiveWindow(ctx, route) {
  const settled = await ctx.waitSettled(ctx.adapter.id === 'opencode-headless' ? 20_000 : ctx.adapter.wallMs)
  if (!settled && ctx.adapter.id !== 'opencode-headless') return { ok: false, reason: 'session did not settle before active-window preparation' }
  if (!settled) ctx.log(`continuing through known stale-working signature (${ISSUE_HEADLESS_WORKING}) so the runnable cell is exercised, not blocked`)
  const token = `PREP_${ctx.adapter.id.replaceAll('-', '_')}_${randomBytes(3).toString('hex')}`
  const before = (await ctx.timeline()).length
  const delivered = await ctx.send(route, prepPrompt(token))
  if (!delivered.confirmed) return { ok: false, reason: `preparation delivery was not confirmed: ${delivered.detail}` }
  const end = Date.now() + ctx.adapter.wallMs
  const startedAt = Date.now()
  while (Date.now() < end) {
    const show = await ctx.show()
    ctx.sampleLiveness(show, 'prepare-active')
    const events = (await ctx.timeline()).slice(before)
    if (show?.liveness === 'online' && ((settled && show.lifecycle === 'active') || events.some((event) => event.kind === 'status' && event.status === 'active'))) {
      ctx.log(`observed in-turn window for ${route}`)
      return { ok: true }
    }
    if (ctx.adapter.id === 'opencode-headless' && Date.now() - startedAt >= 5000) {
      ctx.log(`no fresh active transition after confirmed preparation; continuing to the target send so the known provider failure is measured (${ISSUE_OPENCODE_PROVIDER})`)
      return { ok: true }
    }
    await sleep(2000)
  }
  return { ok: false, reason: 'no in-turn active window observed before timeout' }
}

function resultFor(cell, status, detail, transcript, checks = {}) {
  return {
    adapter: cell.adapter.id,
    node: cell.adapter.node,
    route: cell.route.id,
    timing: cell.timing.id,
    scenario: cellName(cell.adapter.id, cell.route.id, cell.timing.id),
    status,
    detail,
    transcript,
    checks,
    structuralBlocked: status === 'blocked' && cell.route.id === 'launch' && cell.timing.id === 'in-turn',
  }
}

async function runMeasuredCell(ctx, cell, deliver, opts) {
  const slice = ctx.startSlice(`${cell.route.id}/${cell.timing.id}`)
  const timelineStart = (await ctx.timeline()).length
  const livenessStart = ctx.liveness.length
  const token = { id: `CELL_${cell.adapter.id.replaceAll('-', '_')}_${cell.route.id.replaceAll('-', '_')}_${cell.timing.id.replaceAll('-', '_')}_${randomBytes(3).toString('hex')}`, route: cell.route.id }
  const expected = `${token.id}=17`
  const delivery = await deliver(answerPrompt(token.id, cell.timing.id === 'in-turn'))
  ctx.log(`delivery confirmation: ${delivery.confirmed}; ${delivery.detail}`)
  if (!delivery.confirmed) return resultFor(cell, 'fail', 'delivery was not confirmed', ctx.transcript(slice), { deliver: false })
  const observed = await observeCell(ctx, { token, expected, timelineStart, livenessStart, wallMs: cell.adapter.wallMs, inTurn: cell.timing.id === 'in-turn' })
  const checks = { deliver: true, answer: observed.response, liveness: observed.honest, declaration: observed.declaration }
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  const status = failed.length ? 'fail' : 'pass'
  const base = failed.length ? `missing/false checks: ${failed.join(', ')}` : 'delivery confirmed; answer readable; liveness truthful; declaration landed'
  const detail = withKnownIssues(cell.adapter, base, { ...checks, show: observed.show })
  return resultFor(cell, status, detail, ctx.transcript(slice), checks)
}

async function recoverSettled(ctx) {
  if (await ctx.waitSettled(20_000)) return true
  if (ctx.adapter.id === 'opencode-headless') {
    ctx.log(`record remains working after the native turn window; preserving the known signature for cell evidence (${ISSUE_HEADLESS_WORKING})`)
    return false
  }
  ctx.log('session did not settle; sending a note-routed recovery prompt so later cells remain measurable')
  const token = `RECOVER_${randomBytes(3).toString('hex')}`
  const sent = await ctx.send('dashboard-note', answerPrompt(token))
  return sent.confirmed && Boolean(await ctx.waitSettled())
}

function selected(opts, cell) {
  return !opts.cells || opts.cells.has(`${cell.route.id}:${cell.timing.id}`)
}

async function runAdapter(adapter, opts) {
  const ctx = new RunContext(adapter, opts)
  const results = []
  const launchIdle = { adapter, route: ROUTES[0], timing: TIMINGS[0] }
  const launchActive = { adapter, route: ROUTES[0], timing: TIMINGS[1] }
  const launchSlice = ctx.startSlice('launch/idle')
  const timelineStart = 0
  const livenessStart = 0
  const token = { id: `CELL_${adapter.id.replaceAll('-', '_')}_launch_idle_${randomBytes(3).toString('hex')}`, route: 'launch' }
  const expected = `${token.id}=17`
  const launch = await ctx.launch(answerPrompt(token.id))
  ctx.log(`delivery confirmation: ${launch.confirmed}; ${launch.detail}`)
  if (launch.confirmed) await ctx.waitOnline()
  if (selected(opts, launchIdle)) {
    if (!launch.confirmed) results.push(resultFor(launchIdle, 'fail', 'session new was not confirmed', ctx.transcript(launchSlice), { deliver: false }))
    else {
      const observed = await observeCell(ctx, { token, expected, timelineStart, livenessStart, wallMs: adapter.wallMs, inTurn: false })
      const checks = { deliver: true, answer: observed.response, liveness: observed.honest, declaration: observed.declaration }
      const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
      const base = failed.length ? `missing/false checks: ${failed.join(', ')}` : 'launch confirmed; answer readable; liveness truthful; declaration landed'
      results.push(resultFor(launchIdle, failed.length ? 'fail' : 'pass', withKnownIssues(adapter, base, { ...checks, show: observed.show }), ctx.transcript(launchSlice), checks))
    }
  }
  if (selected(opts, launchActive)) {
    const slice = ctx.startSlice('launch/in-turn')
    ctx.log('BLOCKED: a launch first prompt creates the turn; no product operation can inject that same first prompt into a pre-existing turn')
    results.push(resultFor(launchActive, 'blocked', 'structural: launch has no in-turn invocation', ctx.transcript(slice)))
  }

  if (!launch.confirmed) {
    for (const route of ROUTES.slice(1)) for (const timing of TIMINGS) {
      const cell = { adapter, route, timing }
      if (!selected(opts, cell)) continue
      const slice = ctx.startSlice(`${route.id}/${timing.id}`)
      ctx.log('BLOCKED: worker launch failed, so this real product cell cannot be driven')
      results.push(resultFor(cell, 'blocked', 'runtime: worker launch failed', ctx.transcript(slice)))
    }
    return { results, cleanup: true }
  }

  await recoverSettled(ctx)
  for (const route of ROUTES.slice(1)) {
    const idle = { adapter, route, timing: TIMINGS[0] }
    if (selected(opts, idle)) {
      const settled = await recoverSettled(ctx)
      if (!settled && !adapter.headless) {
        const slice = ctx.startSlice(`${route.id}/idle`)
        ctx.log('BLOCKED: session could not be returned to an idle/declared state')
        const show = await ctx.show()
        results.push(resultFor(idle, 'blocked', withKnownIssues(adapter, 'runtime: no idle state', { deliver: true, answer: false, declaration: false, show }), ctx.transcript(slice)))
      } else {
        if (!settled) ctx.log('headless record did not settle; still sending through the real adapter so the cell records FAIL rather than BLOCKED')
        results.push(await runMeasuredCell(ctx, idle, (prompt) => ctx.send(route.id, prompt), opts))
      }
    }
    const active = { adapter, route, timing: TIMINGS[1] }
    if (selected(opts, active)) {
      const slice = ctx.startSlice(`${route.id}/in-turn preparation`)
      const prepared = await openActiveWindow(ctx, route.id)
      if (!prepared.ok) {
        ctx.log(`${adapter.headless ? 'FAIL' : 'BLOCKED'}: ${prepared.reason}`)
        const show = await ctx.show()
        const status = adapter.headless ? 'fail' : 'blocked'
        results.push(resultFor(active, status, withKnownIssues(adapter, `runtime: ${prepared.reason}`, { deliver: true, answer: false, declaration: false, show }), ctx.transcript(slice)))
      } else results.push(await runMeasuredCell(ctx, active, (prompt) => ctx.send(route.id, prompt), opts))
    }
    await recoverSettled(ctx)
  }
  const cleanup = await ctx.close()
  return { results, cleanup }
}

async function fileOne(result) {
  const dir = mkdtempSync(join(tmpdir(), 'spex-delivery-cell-'))
  const evidence = join(dir, `${result.scenario}.txt`)
  try {
    writeFileSync(evidence, result.transcript)
    const evalStatus = result.structuralBlocked ? 'pass' : result.status === 'pass' ? 'pass' : 'fail'
    const note = `${result.status.toUpperCase()}: ${result.detail}`.replaceAll('\n', ' ').slice(0, 800)
    const filed = await runFile(process.execPath, [SPEX, 'eval', 'add', result.node, '--scenario', result.scenario, `--${evalStatus}`, '--note', note, '--result', evidence])
    if (filed.code !== 0) throw new Error(`filing ${result.node}/${result.scenario} failed`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function markdownTable(results) {
  const lines = [
    '| Harness | Prompt path | Timing | Result | Checks / reason |',
    '|---|---|---|---|---|',
  ]
  for (const result of results) {
    const checks = Object.keys(result.checks).length
      ? Object.entries(result.checks).map(([key, value]) => `${key}:${value ? 'ok' : 'FAIL'}`).join(' ')
      : result.detail
    lines.push(`| ${result.adapter} | ${result.route} | ${result.timing} | ${result.status.toUpperCase()} | ${checks.replaceAll('|', '\\|')} |`)
  }
  return lines.join('\n')
}

async function fileAggregate(results, table, output, baseline) {
  const failed = results.filter((result) => result.status === 'fail' || (result.status === 'blocked' && !result.structuralBlocked))
  const status = failed.length ? 'fail' : 'pass'
  const note = failed.length
    ? `FAIL: ${failed.length} runnable cell(s) failed or were runtime-blocked; 8 structural launch/in-turn blocks expected`
    : 'PASS: all runnable cells passed; 8 structural launch/in-turn cells blocked as expected'
  const evidence = [
    `harness delivery combination campaign`,
    `baseline=${baseline}`,
    `completed=${iso()}`,
    `backend=${process.env.SPEXCODE_API_URL ? '(session backend)' : 'http://127.0.0.1:8787'}`,
    '',
    table,
    '',
    ...results.flatMap((result) => [`## ${result.scenario}`, result.transcript]),
  ].join('\n')
  writeFileSync(output, evidence)
  const filed = await runFile(process.execPath, [SPEX, 'eval', 'add', 'harness-adapter', '--scenario', 'harness-delivery-combination-campaign', `--${status}`, '--note', note, '--result', output])
  if (filed.code !== 0) throw new Error('aggregate eval filing failed')
}

function assertCleanStart() {
  return runFile('git', ['status', '--porcelain'], { quiet: true }).then((result) => {
    if (result.out.trim()) throw new Error('refusing to file from a dirty tree; commit the runner and scenario contracts first')
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.sync) syncScenarios()
  let adapters = ADAPTERS.map((adapter) => ({ ...adapter, launcher: opts.profiles.get(adapter.id) || adapter.launcher }))
  if (opts.only) adapters = adapters.filter((adapter) => opts.only.has(adapter.id))
  if (!adapters.length) throw new Error('no harness forms selected')
  const cells = allCells(adapters).filter((cell) => selected(opts, cell))
  if (opts.cells) {
    const known = new Set(ROUTES.flatMap((route) => TIMINGS.map((timing) => `${route.id}:${timing.id}`)))
    const unknown = [...opts.cells].filter((cell) => !known.has(cell))
    if (unknown.length) throw new Error(`unknown cells: ${unknown.join(', ')}`)
  }
  if (opts.plan) {
    for (const cell of cells) console.log(`${cell.adapter.id.padEnd(19)} ${cell.route.id.padEnd(15)} ${cell.timing.id.padEnd(8)} -> ${cell.adapter.node}`)
    console.log(`${cells.length} cells`)
    return
  }
  if (opts.file) await assertCleanStart()
  const head = (await runFile('git', ['rev-parse', 'HEAD'], { quiet: true })).out.trim()
  const postFix = (await runFile('git', ['merge-base', '--is-ancestor', '93b35610', head], { quiet: true })).code === 0
  opts.baseline = `${postFix ? 'post-fix composeSessionPrompt' : 'pre-fix composeSessionPrompt'}; runnerHead=${head}`
  console.log(`baseline: ${opts.baseline}`)
  const results = []
  const cleanupFailures = []
  for (const adapter of adapters) {
    console.log(`\n=== ${adapter.id} via ${adapter.launcher} ===`)
    const run = await runAdapter(adapter, opts)
    for (const result of run.results) {
      results.push(result)
      console.log(`${result.status.toUpperCase().padEnd(7)} ${result.scenario}: ${result.detail}`)
      if (opts.file) await fileOne(result)
    }
    if (!run.cleanup) cleanupFailures.push(adapter.id)
  }
  const table = markdownTable(results)
  console.log(`\n${table}`)
  if (cleanupFailures.length) console.error(`cleanup failures: ${cleanupFailures.join(', ')}`)
  const output = opts.output || join(tmpdir(), `spex-harness-delivery-${Date.now()}.md`)
  if (opts.file) await fileAggregate(results, table, output, opts.baseline)
  else writeFileSync(output, table + '\n')
  console.log(`campaign evidence: ${output}`)
  if (results.some((result) => result.status === 'fail' || (result.status === 'blocked' && !result.structuralBlocked)) || cleanupFailures.length) process.exitCode = 1
}

async function cleanupLiveContexts() {
  await Promise.all([...LIVE_CONTEXTS].map((ctx) => ctx.close()))
}

let stopping = false
process.on('SIGINT', () => {
  if (stopping) process.exit(130)
  stopping = true
  console.error('\nSIGINT: closing campaign sessions before exit')
  void cleanupLiveContexts().finally(() => process.exit(130))
})
process.on('SIGTERM', () => {
  if (stopping) process.exit(143)
  stopping = true
  console.error('\nSIGTERM: closing campaign sessions before exit')
  void cleanupLiveContexts().finally(() => process.exit(143))
})

main().catch(async (error) => {
  console.error(`harness-delivery-campaign: ${error.stack || error}`)
  await cleanupLiveContexts()
  process.exitCode = 2
})
