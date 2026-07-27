import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// This is the product-level archive YATU runner. It intentionally requires a prebuilt dashboard, an isolated
// backend, and TWO real sibling sessions; a fake HTTP state machine belongs only to watch-cli.api.test.mjs and
// cannot file an archive reading.
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const base = process.env.BASE || 'http://127.0.0.1:5175'
const sessionId = process.env.SESSION
const siblingId = process.env.SIBLING
const guardId = process.env.GUARD_SESSION
const noPaneId = process.env.NO_PANE_SESSION
const capacityId = process.env.CAPACITY_SESSION
const dist = process.env.DIST
const out = resolve(process.env.OUT || '/tmp/archive-shelf-e2e')
const spex = resolve(process.env.SPEX || 'spec-cli/bin/spex.mjs')
const spexPackage = dirname(dirname(spex))
const cli = join(spexPackage, 'src', 'cli.ts')
const tsxCli = join(spexPackage, 'node_modules', 'tsx', 'dist', 'cli.mjs')
if (!sessionId || !siblingId || !guardId || !noPaneId) throw new Error('SESSION=<real Codex target>, SIBLING=<real Codex sibling>, GUARD_SESSION=<blocked archive leg>, and NO_PANE_SESSION=<idle interactive Codex control> are required')
for (const name of ['SPEXCODE_TMUX', 'TARGET_PID_FILE', 'NO_PANE_PID_FILE', 'SHARED_PID_FILE', 'SHARED_SOCKET', 'DIRTY_SENTINEL', 'RECORD_FILE']) {
  if (!process.env[name]) throw new Error(`${name} is required for runtime/resource evidence`)
}
if (!dist || !existsSync(dist)) throw new Error('DIST=<prebuilt dashboard dist> is required')
if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(cli) || !existsSync(tsxCli)) throw new Error(`SPEX must resolve a package with cli.ts + tsx: ${spexPackage}`)
mkdirSync(out, { recursive: true })

const { chromium } = await import(pathToFileURL(playwrightPath).href)
const get = async (pathOrAll) => {
  const path = typeof pathOrAll === 'boolean' ? (pathOrAll ? '/api/sessions?all=1' : '/api/sessions') : pathOrAll
  const response = await fetch(`${base}${path}`)
  const text = await response.text()
  let body = null; try { body = JSON.parse(text) } catch { /* text endpoint */ }
  assert.equal(response.ok, true, `${path} failed: ${response.status} ${text}`)
  return body
}
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex')
const beforeIndex = readFileSync(join(dist, 'index.html'))
const servedIndex = Buffer.from(await (await fetch(`${base}/`)).arrayBuffer())
assert.equal(hashBytes(servedIndex), hashBytes(beforeIndex), 'BASE must serve the exact prebuilt DIST index')
const post = async (path, body = {}) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await response.text(); let json = null; try { json = JSON.parse(text) } catch { /* */ }
  assert.equal(response.ok, true, `${path} failed: ${response.status} ${text}`)
  return json
}
const waitFor = async (read, accept, label, timeout = 30_000, interval = 250) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await new Promise((r) => setTimeout(r, interval)) }
  throw new Error(`timed out waiting for ${label}`)
}
const procToken = (pid) => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').toString().trim().split(' ')[21] || null } catch { return null } }
const processMarker = (pidFile) => {
  if (!pidFile || !existsSync(pidFile)) return null
  const pid = Number(readFileSync(pidFile, 'utf8').trim()); const start = procToken(pid)
  return pid > 0 && start ? `${pid}@${start}` : null
}
const socketMarker = (socketPath) => { try { const s = statSync(socketPath); return `${s.dev}:${s.ino}` } catch { return null } }
const tmuxPresent = (socket, id) => {
  if (!socket) return null
  try { execFileSync('tmux', ['-L', socket, 'has-session', '-t', id], { stdio: 'ignore' }); return true } catch { return false }
}
const getTarget = async (all = true) => (await get(all ? '/api/sessions?all=1' : '/api/sessions')).find((s) => s.id === sessionId)
const events = []
const started = Date.now()
const event = (kind, label) => {
  events.push({ atMs: Date.now() - started, kind, label })
  console.error(`[archive-e2e] ${kind}: ${label}`)
}
const narrate = (label) => event('narrate', label)
const frame = (label) => event('frame', label)

const before = await getTarget(false)
const beforeAll = await getTarget(true)
assert.ok(before && beforeAll, 'target must be a real existing session')
assert.ok(beforeAll.path && beforeAll.branch, 'target must retain an exact worktree and branch identity')
const fixtureRoot = dirname(execFileSync('git', ['-C', beforeAll.path, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim())
assert.equal(before.archived, false, 'target must begin unarchived')
assert.equal(beforeAll.harness, 'codex', 'archive YATU requires a real Codex target')
const beforeResources = await get('/api/resources')
const defaultCountBefore = (await get(false)).length
const graphCountBefore = (await get('/api/graph')).sessions.length
if (capacityId) {
  const capacityBefore = (await get(true)).find((s) => s.id === capacityId)
  assert.deepEqual({ status: capacityBefore?.status, liveness: capacityBefore?.liveness }, { status: 'queued', liveness: 'offline' }, 'provided capacity control must be queued before archive')
}
const dirtyHashBefore = hashBytes(readFileSync(process.env.DIRTY_SENTINEL))
const recordBeforeBytes = JSON.parse(readFileSync(process.env.RECORD_FILE, 'utf8'))
const recordIdentityBefore = hashBytes(JSON.stringify({ worktree_path: recordBeforeBytes.worktree_path, branch: recordBeforeBytes.branch, harness_session_id: recordBeforeBytes.harness_session_id }))
const targetBeforeRef = (beforeResources.owners || []).flatMap((owner) => owner.references || []).find((ref) => ref.sessionId === sessionId && ref.threadId)
assert.ok(targetBeforeRef, 'resources must expose the exact target Codex thread reference before archive')
const beforeThread = targetBeforeRef.threadId
const siblingBeforeRef = (beforeResources.owners || []).flatMap((owner) => owner.references || []).find((ref) => ref.sessionId === siblingId && ref.threadId)
assert.ok(siblingBeforeRef, 'resources must expose the exact sibling Codex thread reference before archive')
const sharedPidBefore = processMarker(process.env.SHARED_PID_FILE)
const sharedSocketBefore = socketMarker(process.env.SHARED_SOCKET)
const siblingBefore = (await get(true)).find((s) => s.id === siblingId)
assert.ok(siblingBefore, 'real sibling must be present before archive')
const startMonitor = (verb) => {
  const child = spawn(process.execPath, [tsxCli, cli, 'session', verb, sessionId, '--interval', '5', ...(verb === 'wait' ? ['--timeout', '60'] : []), '--api', base], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  return { child, text: () => ({ stdout, stderr }) }
}
const waitClosed = async (child) => {
  if (child.exitCode != null || child.signalCode != null) return
  let timer
  try {
    await Promise.race([
      once(child, 'close'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`monitor PID ${child.pid} did not close within 30s`)), 30_000) }),
    ])
  } finally { clearTimeout(timer) }
}
const watch = startMonitor('watch')
const wait = startMonitor('wait')
await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))

const browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
const page = await context.newPage()
const pageErrors = []; const consoleErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
let failure
try {
  narrate('▶ archive-guard-failure-visible · active native turn refuses without mutation')
  const guardBefore = await get(true)
  const guardConsoleStart = consoleErrors.length
  await page.goto(`${base}/#/sessions/${guardId}`, { waitUntil: 'domcontentloaded' })
  const guardRow = page.locator(`.si-item[data-sid="${guardId}"]`)
  await guardRow.waitFor({ state: 'visible', timeout: 30_000 })
  await guardRow.click({ button: 'right' })
  const guardArchive = page.locator('.sess-menu-item').filter({ hasText: /archive/i }).first()
  await guardArchive.waitFor({ state: 'visible' }); await guardArchive.click()
  const guardError = page.locator('[role="alert"].si-offline-err').first()
  await guardError.waitFor({ state: 'visible', timeout: 10_000 })
  assert.match((await guardError.textContent()) || '', /refus|ownership|unowned|turn|probe/i)
  const guardConsoleErrors = consoleErrors.splice(guardConsoleStart)
  assert.ok(guardConsoleErrors.every((message) => /409|Conflict/i.test(message)), `unexpected guard console errors: ${guardConsoleErrors.join('; ')}`)
  const guardAfter = (await get(true)).find((s) => s.id === guardId)
  const guardRowBefore = guardBefore.find((s) => s.id === guardId)
  assert.deepEqual({ archived: guardAfter?.archived, status: guardAfter?.status, liveness: guardAfter?.liveness }, { archived: guardRowBefore?.archived, status: guardRowBefore?.status, liveness: guardRowBefore?.liveness }, 'guard refusal must not mutate the guarded record projection')
  frame('📷 guard refusal preserves runtime and record projection')

  narrate('▶ shelve-and-restore-round-trip · archive exact Codex target through the real browser surface')
  await page.goto(`${base}/#/sessions/${sessionId}`, { waitUntil: 'domcontentloaded' })
  const row = page.locator(`.si-item[data-sid="${sessionId}"]`)
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  await row.click()
  await page.waitForFunction((id) => document.querySelector(`.si-item[data-sid="${id}"]`)?.classList.contains('on') === true, sessionId)
  await page.keyboard.press('Alt+i')
  const command = page.locator('.si-command-input')
  await command.waitFor({ state: 'visible' }); await command.fill('/archive')
  const archiveCommand = page.locator('.mention-menu.up .mention-item').filter({ hasText: '/archive' }).first()
  await archiveCommand.waitFor({ state: 'visible' }); await archiveCommand.click()
  await waitFor(() => getTarget(true), (s) => s?.archived === true && s?.status === 'offline' && s?.liveness === 'offline', 'cold archived history row')
  // Capacity scheduling is intentionally unclaimed by this round trip; its queued-before control is a separate
  // scenario. Keeping the archive proof independent avoids treating a missing control as a false release.
  await waitClosed(wait.child)
  const waitTranscript = wait.text()
  assert.match(waitTranscript.stdout, /offline/, `wait missed offline archive: ${JSON.stringify(waitTranscript)}`)
  assert.doesNotMatch(waitTranscript.stdout + waitTranscript.stderr, /gone|no such \(living\)/i)
  const defaultRows = await get(false)
  assert.equal(defaultRows.some((s) => s.id === sessionId), false, 'cold target must leave default sessions')
  assert.equal(defaultRows.length, defaultCountBefore - 1, 'cold target must leave the default session count')
  const graph = await waitFor(() => get('/api/graph'), (candidate) => Array.isArray(candidate.sessions) && !candidate.sessions.some((s) => s.id === sessionId), 'default graph archive exclusion')
  assert.ok(Array.isArray(graph.sessions), 'graph must expose structured sessions')
  assert.equal(graph.sessions.some((s) => s.id === sessionId), false, 'cold target must leave default graph sessions')
  assert.equal(graph.sessions.length, graphCountBefore - 1, 'cold target must leave the default graph count')
  const edges = await get('/api/sessions/edges')
  assert.equal((edges.edges || []).some((edge) => edge.from === sessionId || edge.to === sessionId), false, 'cold target must leave graph edges')
  const resources = await get('/api/resources')
  assert.equal((resources.owners || []).some((owner) => owner.kind === 'session' && owner.id === sessionId), false, 'cold target must leave active resource owners')
  assert.equal((resources.owners || []).flatMap((owner) => owner.references || []).some((ref) => ref.sessionId === sessionId || ref.threadId === beforeThread), false, 'cold target thread ref must leave resources')
  const siblingRefAfterArchive = (resources.owners || []).flatMap((owner) => owner.references || []).find((ref) => ref.sessionId === siblingId && ref.threadId)
  assert.ok(siblingRefAfterArchive && siblingRefAfterArchive.threadId === siblingBeforeRef.threadId, 'pre-existing sibling thread ref must remain loaded')
  assert.equal(tmuxPresent(process.env.SPEXCODE_TMUX, sessionId), false, 'target tmux must be gone')
  assert.equal(processMarker(process.env.TARGET_PID_FILE), null, 'target leaf PID must be gone')
  assert.equal(processMarker(process.env.SHARED_PID_FILE), sharedPidBefore, 'shared app-server PID/start must be unchanged')
  assert.equal(socketMarker(process.env.SHARED_SOCKET), sharedSocketBefore, 'shared app-server socket identity must be unchanged')
  assert.equal((resources.owners || []).flatMap((owner) => owner.references || []).some((ref) => ref.threadId === beforeThread), false, 'target thread is not still loaded after archive')
  if (capacityId) {
    const capacityAfter = await waitFor(() => get(true), (rows) => {
      const control = rows.find((s) => s.id === capacityId)
      return control?.status !== 'queued' && control?.liveness === 'online' ? control : null
    }, 'queued capacity control to launch after archive')
    assert.notEqual(capacityAfter.status, 'queued', 'archived target must release its maxActive slot')
  }
  const shelf = page.locator('.si-pill.shelf')
  if (await shelf.getAttribute('aria-pressed') !== 'true') await shelf.click()
  await page.waitForFunction(() => document.querySelector('.si-pill.shelf')?.getAttribute('aria-pressed') === 'true')
  assert.equal(await page.locator('.si-zone').count(), 0, 'archive shelf must be flat with no status zones')
  frame('📷 flat offline shelf; default graph/resources omit target; target runtime gone and shared sibling retained')

  const nonce = `sibling-archive-proof-${Date.now()}`
  const derived = hashBytes(nonce)
  const siblingStates = []
  const siblingTrace = waitFor(async () => {
    const report = await get('/api/resources')
    const ref = (report.owners || []).flatMap((owner) => owner.references || []).find((item) => item.sessionId === siblingId)
    if (ref) siblingStates.push(ref.turnPresence)
    return ref
  }, (ref) => siblingStates.includes('active') && ref?.turnPresence === 'idle', 'sibling active -> terminal while target is cold')
  await post(`/api/sessions/${siblingId}/input`, { kind: 'text', text: `Compute the SHA-256 of this nonce: ${nonce}. Then make your final tool call: spex session ask --note <digest>, replacing <digest> with only the exact lowercase digest. Stop after that declaration.` })
  await siblingTrace
  await waitFor(() => get(`/api/sessions/${siblingId}/timeline?limit=20`), (body) => body?.events?.some((entry) => entry.kind === 'status' && entry.note === derived), 'sibling exact agent-authored digest note while target is cold')

  narrate('▶ no-pane-no-leaf liveness · stale record/shared thread cannot project working or online')
  const guardResourceBeforeKill = await get('/api/resources')
  const guardRefBeforeKill = (guardResourceBeforeKill.owners || []).flatMap((owner) => owner.references || []).find((ref) => ref.sessionId === noPaneId && ref.threadId)
  assert.ok(guardRefBeforeKill && guardRefBeforeKill.turnPresence === 'idle', 'no-pane control must retain one exact idle shared thread')
  const noPaneBefore = (await get(true)).find((candidate) => candidate.id === noPaneId)
  assert.ok(noPaneBefore?.harness === 'codex' && noPaneBefore?.liveness === 'online', 'no-pane control must begin as online interactive Codex')
  execFileSync('tmux', ['-L', process.env.SPEXCODE_TMUX, 'kill-session', '-t', noPaneId])
  await waitFor(() => ({ tmux: tmuxPresent(process.env.SPEXCODE_TMUX, noPaneId), pid: processMarker(process.env.NO_PANE_PID_FILE) }), (runtime) => runtime.tmux === false && runtime.pid === null, 'no-pane target-owned pane and leaf absence')
  const noPaneRows = await waitFor(() => get(true), (rows) => {
    const row = rows.find((candidate) => candidate.id === noPaneId)
    return row?.liveness === 'offline' ? row : null
  }, 'no-pane/no-leaf public offline projection')
  const noPaneGuard = noPaneRows.find((candidate) => candidate.id === noPaneId)
  assert.ok(noPaneGuard, 'no-pane control record remains addressable')
  assert.equal(noPaneGuard.archived, false, 'external pane loss preserves the ordinary record rather than archiving it')
  assert.equal(noPaneGuard.lifecycle, noPaneBefore.lifecycle, 'external pane loss preserves the agent-authored lifecycle axis')
  assert.notEqual(noPaneGuard.status, 'working', 'no-pane/no-leaf interactive session cannot remain compact-working')
  const noPaneResources = await get('/api/resources')
  assert.ok((noPaneResources.owners || []).flatMap((owner) => owner.references || []).some((ref) => ref.sessionId === noPaneId && ref.threadId === guardRefBeforeKill.threadId), 'shared thread metadata remains while target pane/leaf absence projects offline')
  assert.equal(processMarker(process.env.SHARED_PID_FILE), sharedPidBefore, 'no-pane projection leaves shared app-server PID/start unchanged')
  assert.equal(socketMarker(process.env.SHARED_SOCKET), sharedSocketBefore, 'no-pane projection leaves shared app-server socket unchanged')
  assert.ok((noPaneResources.owners || []).flatMap((owner) => owner.references || []).some((ref) => ref.sessionId === siblingId && ref.threadId === siblingBeforeRef.threadId), 'no-pane projection leaves sibling reference unchanged')
  frame('📷 no session-owned pane/leaf projects offline despite retained record and shared thread metadata')

  narrate('resume same conversation through starting to online')
  await page.locator(`.si-item[data-sid="${sessionId}"]`).click()
  const stateTrace = []
  const runtimeTrace = []
  const runtimeTimer = setInterval(() => runtimeTrace.push({ tmux: tmuxPresent(process.env.SPEXCODE_TMUX, sessionId), pid: processMarker(process.env.TARGET_PID_FILE) }), 25)
  let resumed
  try {
    const sawStarting = () => stateTrace.includes('starting') || runtimeTrace.some((sample) => sample.tmux === true && sample.pid === null)
    const tracePromise = waitFor(async () => { const s = await getTarget(true); if (s) stateTrace.push(s.status); return s }, (s) => s?.archived === false && s?.liveness === 'online' && sawStarting(), 'resume starting -> online', 30_000, 10)
    const resumeResponse = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/sessions/${sessionId}/resume` && r.request().method() === 'POST')
    await page.locator('.si-shelf-card .si-act.go').click(); assert.equal((await resumeResponse).ok(), true)
    resumed = await tracePromise
    assert.ok(sawStarting(), `resume trace lacked API or runtime starting witness: ${stateTrace.join(' -> ')}`)
  } finally { clearInterval(runtimeTimer) }
  const resumedResources = await get('/api/resources')
  const resumedRef = (resumedResources.owners || []).flatMap((owner) => owner.references || []).find((ref) => ref.sessionId === sessionId && ref.threadId)
  assert.equal(resumedRef?.threadId, beforeThread, 'resume returns the same Codex conversation')
  assert.deepEqual({ path: resumed.path, branch: resumed.branch }, { path: beforeAll.path, branch: beforeAll.branch }, 'worktree/branch identity survives')
  assert.equal(hashBytes(readFileSync(process.env.DIRTY_SENTINEL)), dirtyHashBefore, 'dirty sentinel bytes survive archive/resume')
  const recordAfterBytes = JSON.parse(readFileSync(process.env.RECORD_FILE, 'utf8'))
  assert.equal(hashBytes(JSON.stringify({ worktree_path: recordAfterBytes.worktree_path, branch: recordAfterBytes.branch, harness_session_id: recordAfterBytes.harness_session_id })), recordIdentityBefore, 'record worktree/branch/conversation identity survives')
  frame('📷 resume returns the same thread through starting to online')

  narrate('▶ close-proven-cold-archive · archive again and permanently retire while cold')
  await waitFor(async () => {
    const report = await get('/api/resources')
    return (report.owners || []).flatMap((owner) => owner.references || []).find((ref) => ref.sessionId === sessionId)
  }, (ref) => ref?.turnPresence === 'idle', 'resumed target turn to settle before cold close')
  await post(`/api/sessions/${sessionId}/archive`)
  await waitFor(() => getTarget(true), (s) => s?.archived === true && s?.status === 'offline' && s?.liveness === 'offline', 'second cold archive before close')
  assert.equal(tmuxPresent(process.env.SPEXCODE_TMUX, sessionId), false, 'cold-close target tmux must already be gone')
  assert.equal(processMarker(process.env.TARGET_PID_FILE), null, 'cold-close target PID must already be gone')
  assert.equal(existsSync(beforeAll.path), true, 'cold close must begin with the retained worktree present')
  assert.equal(existsSync(process.env.RECORD_FILE), true, 'cold close must begin with the retained record present')
  const branchBeforeClose = execFileSync('git', ['-C', fixtureRoot, 'branch', '--list', beforeAll.branch], { encoding: 'utf8' }).trim()
  assert.ok(branchBeforeClose, 'cold close must begin with the retained branch present')
  await post(`/api/sessions/${sessionId}/close`)
  await waitFor(() => get(true), (rows) => !rows.some((s) => s.id === sessionId), 'true close removal')
  assert.equal(existsSync(beforeAll.path), false, 'cold close removes the retained worktree')
  assert.equal(existsSync(process.env.RECORD_FILE), false, 'cold close removes the retained record')
  assert.equal(execFileSync('git', ['-C', fixtureRoot, 'branch', '--list', beforeAll.branch], { encoding: 'utf8' }).trim(), '', 'cold close removes the retained branch')
  const afterCloseResources = await get('/api/resources')
  assert.equal(processMarker(process.env.SHARED_PID_FILE), sharedPidBefore, 'cold close leaves shared app-server PID/start unchanged')
  assert.equal(socketMarker(process.env.SHARED_SOCKET), sharedSocketBefore, 'cold close leaves shared app-server socket unchanged')
  assert.ok((afterCloseResources.owners || []).flatMap((owner) => owner.references || []).some((ref) => ref.sessionId === siblingId && ref.threadId === siblingBeforeRef.threadId), 'cold close leaves the sibling loaded reference unchanged')
  await page.locator(`.si-item[data-sid="${sessionId}"]`).waitFor({ state: 'detached', timeout: 30_000 })
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  watch.child.kill('SIGTERM'); await waitClosed(watch.child)
  const watchTranscript = watch.text()
  assert.equal((watchTranscript.stdout.match(/\[spex\] closed/g) ?? []).length, 1, watchTranscript.stdout)
  writeFileSync(join(out, 'watch.log'), watchTranscript.stdout + watchTranscript.stderr)
  writeFileSync(join(out, 'wait.log'), waitTranscript.stdout + waitTranscript.stderr)
  frame('📷 cold close removes record, worktree, branch, and shelf row exactly once')
} catch (error) { failure = error }
finally {
  if (watch.child.exitCode == null) watch.child.kill('SIGTERM')
  if (wait.child.exitCode == null) wait.child.kill('SIGTERM')
  await Promise.all([waitClosed(watch.child), waitClosed(wait.child)]).catch(() => {})
  writeFileSync(join(out, 'watch.log'), `${watch.text().stdout}${watch.text().stderr}`)
  writeFileSync(join(out, 'wait.log'), `${wait.text().stdout}${wait.text().stderr}`)
  const current = await getTarget(true).catch(() => null)
  if (current?.archived) await post(`/api/sessions/${sessionId}/resume`).catch(() => {})
}
const video = page.video(); await context.close(); const videoPath = await video.path(); await browser.close()
const browserErrors = [...pageErrors, ...consoleErrors]
if (browserErrors.length && !failure) failure = new Error(`browser errors: ${browserErrors.join('\\n')}`)
writeFileSync(join(out, 'archive-shelf.timeline.json'), `${JSON.stringify({ events, pageErrors, consoleErrors }, null, 2)}\n`)
writeFileSync(join(out, 'result.json'), `${JSON.stringify({ ok: !failure, error: failure ? String(failure.stack || failure) : null, sessionId, siblingId, capacityId: capacityId || null, video: videoPath, browserErrors }, null, 2)}\n`)
if (failure) throw failure
console.log(JSON.stringify({ ok: true, video: videoPath, timeline: join(out, 'archive-shelf.timeline.json') }))
