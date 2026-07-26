import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { once } from 'node:events'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PRODUCT_SOURCE = process.env.SPEX_IMPACT_PRODUCT_SOURCE || SOURCE
const SESSION_ID = 'impact-api-fixture-0001'
const ALPHA_SESSION_ID = 'impact-api-fixture-0002'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const done = once(child, 'exit')
  if (await Promise.race([done.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000))])) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

function copyProduct(target: string): void {
  mkdirSync(target, { recursive: true })
  for (const path of ['package.json', 'spec-cli/package.json', 'spec-eval/package.json', 'spec-forge/package.json', 'spec-dashboard/package.json']) {
    mkdirSync(dirname(join(target, path)), { recursive: true })
    cpSync(join(PRODUCT_SOURCE, path), join(target, path))
  }
  for (const path of ['spec-cli/src', 'spec-cli/templates', 'spec-eval/src', 'spec-forge/src', 'spec-dashboard/src']) {
    mkdirSync(dirname(join(target, path)), { recursive: true })
    cpSync(join(PRODUCT_SOURCE, path), join(target, path), { recursive: true })
  }
  const common = git(PRODUCT_SOURCE, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const main = dirname(common)
  const rootDeps = [join(PRODUCT_SOURCE, 'node_modules'), join(main, 'node_modules')].find(existsSync)
  const cliDeps = [join(PRODUCT_SOURCE, 'spec-cli/node_modules'), join(main, 'spec-cli/node_modules')].find(existsSync)
  if (!rootDeps || !cliDeps) throw new Error('impact API rig requires installed root and spec-cli dependencies')
  symlinkSync(rootDeps, join(target, 'node_modules'), 'dir')
  symlinkSync(cliDeps, join(target, 'spec-cli/node_modules'), 'dir')
}

const specSource = (selector = 'alpha') => [
  '---', 'title: impact-fixture', 'hue: 150', 'desc: exact impact public fixture',
  'code:', `  - fixture/shared.py#${selector}`, 'related:', '  - docs/context.md',
  '---', '# impact-fixture', '',
].join('\n')

const evalSource = (options: {
  alphaExpected?: string
  betaCode?: string
  metadataChanged?: boolean
  renamed?: boolean
  removeCodeScenarios?: boolean
  renamedCode?: boolean
} = {}) => [
  '---', 'scenarios:',
  '  - name: alpha-scenario', '    tags: [backend-api]', '    code: [fixture/shared.py#alpha]',
  '    description: measure alpha', `    expected: ${options.alphaExpected ?? 'alpha exact'}`,
  '  - name: beta-scenario', '    tags: [backend-api]', `    code: [${options.betaCode ?? 'fixture/shared.py#beta'}]`,
  '    description: measure beta', '    expected: beta exact',
  '  - name: inherited-scenario', '    tags: [backend-api]',
  '    description: inherit node selector', '    expected: inherited selector exact',
  '  - name: measurement-scenario', '    tags: [backend-api]', '    code: [fixture/measurement.py#steady]',
  '    description: session-owned reading', '    expected: measurement alone enters impact',
  '  - name: retracted-scenario', '    tags: [backend-api]', '    code: [fixture/measurement.py#retracted]',
  '    description: retracted reading control', '    expected: retracted evidence is not measurement impact',
  '  - name: metadata-scenario', `    tags: [${options.metadataChanged ? 'cli' : 'backend-api'}]`,
  `    test: ${options.metadataChanged ? 'tests/b.txt' : 'tests/a.txt'}`,
  `    code: [fixture/metadata.py#${options.metadataChanged ? 'metadata_beta' : 'metadata_alpha'}]`,
  '    description: metadata contract', '    expected: metadata hash exact',
  `  - name: ${options.renamed ? 'rename-new' : 'rename-old'}`, '    tags: [backend-api]',
  '    code: [fixture/rename.py#rename_unit]',
  '    description: rename contract', '    expected: rename is remove plus add',
  ...(options.removeCodeScenarios ? [] : [
    '  - name: removed-code-scenario', '    tags: [backend-api]', '    code: [fixture/removable.py#remove_me]',
    '    description: remove code declaration', '    expected: base-side deletion hits removed selector',
  ]),
  ...(options.renamedCode ? [
    '  - name: renamed-code-new', '    tags: [backend-api]', '    code: [fixture/rename-target.py#rename_me]',
    '    description: renamed code declaration', '    expected: rename is selected on both sides',
  ] : [
    '  - name: renamed-code-old', '    tags: [backend-api]', '    code: [fixture/rename-source.py#rename_me]',
    '    description: original code declaration', '    expected: rename is selected on both sides',
  ]),
  '---', 'public impact fixture', '',
].join('\n')

function record(home: string, project: string, session: string, id: string, branch: string): void {
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: session, branch,
    node: 'impact-fixture', title: 'impact fixture', name: '', parent: null, status: 'active',
    proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude',
    harness_session_id: '', launcher: 'fixture', launch_cmd: 'true',
  }, null, 2) + '\n')
}

test('scoped HTTP session impact is the selector-aware exact projection, including dirty overlays', { timeout: 90_000 }, async () => {
  assert.match(process.version, /^v22\./, `impact API rig must run on repository-pinned Node 22, got ${process.version}`)
  const runnerSha = git(SOURCE, 'rev-parse', 'HEAD')
  const productSha = git(PRODUCT_SOURCE, 'rev-parse', 'HEAD')
  const readingSha = process.env.SPEX_IMPACT_READING_SHA || runnerSha
  assert.equal(productSha, readingSha, 'the product tree under test must equal the reading codeSha')
  console.log(JSON.stringify({ phase: 'provenance', runtime: process.version, runnerSha, productSha, readingSha }))
  const fixture = mkdtempSync(join(tmpdir(), 'spex-impact-api-'))
  const project = join(fixture, 'project')
  const session = join(fixture, 'session')
  const alphaSession = join(fixture, 'alpha-session')
  const home = join(fixture, 'home')
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const backendBin = join(fixture, 'backend-bin')
  const backendGit = join(backendBin, 'git')
  const httpRaceEnable = join(fixture, 'http-race-enable')
  const httpRaceSignal = join(fixture, 'http-race-signal')
  const httpRaceRelease = join(fixture, 'http-race-release')
  let child: ChildProcess | null = null
  let stderr = ''
  try {
    mkdirSync(backendBin)
    writeFileSync(backendGit, `#!/bin/sh
if [ -f "$IMPACT_HTTP_RACE_ENABLE" ] && [ ! -f "$IMPACT_HTTP_RACE_SIGNAL" ]; then
  case " $* " in
    *" diff --name-only "*)
      echo reached > "$IMPACT_HTTP_RACE_SIGNAL"
      count=0
      while [ ! -f "$IMPACT_HTTP_RACE_RELEASE" ] && [ "$count" -lt 1000 ]; do
        sleep 0.01
        count=$((count + 1))
      done
      [ -f "$IMPACT_HTTP_RACE_RELEASE" ] || { echo impact-http-race-timeout >&2; exit 74; }
      ;;
  esac
fi
exec "$IMPACT_REAL_GIT" "$@"
`)
    chmodSync(backendGit, 0o755)
    copyProduct(project)
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'eval@example.test')
    git(project, 'config', 'user.name', 'Eval Test')
    mkdirSync(join(project, '.spec/project/impact-fixture'), { recursive: true })
    mkdirSync(join(project, 'fixture'), { recursive: true })
    mkdirSync(join(project, 'docs'), { recursive: true })
    mkdirSync(join(project, 'tests'), { recursive: true })
    writeFileSync(join(project, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(project, '.spec/project/impact-fixture/spec.md'), specSource())
    writeFileSync(join(project, '.spec/project/impact-fixture/eval.md'), evalSource())
    writeFileSync(join(project, 'fixture/shared.py'), 'def alpha():\n    return 1\n\ndef beta():\n    return 1\n')
    writeFileSync(join(project, 'fixture/metadata.py'), 'def metadata_alpha():\n    return 1\n\ndef metadata_beta():\n    return 1\n')
    writeFileSync(join(project, 'fixture/rename.py'), 'def rename_unit():\n    return 1\n')
    writeFileSync(join(project, 'fixture/measurement.py'), 'def steady():\n    return 1\n\ndef retracted():\n    return 1\n')
    writeFileSync(join(project, 'fixture/removable.py'), '# one\n# two\n# three\ndef remove_me():\n    return 1\n')
    writeFileSync(join(project, 'fixture/rename-source.py'), '# one\n# two\n# three\ndef rename_me():\n    return 1\n')
    writeFileSync(join(project, 'docs/context.md'), 'context v1\n')
    writeFileSync(join(project, 'tests/a.txt'), 'a\n')
    writeFileSync(join(project, 'tests/b.txt'), 'b\n')
    git(project, 'add', '-A')
    git(project, 'commit', '-q', '-m', 'fixture base')
    const base = git(project, 'rev-parse', 'HEAD')
    git(project, 'worktree', 'add', '-q', '-b', 'node/impact-fixture', session, 'main')
    writeFileSync(join(session, 'fixture/shared.py'), 'def alpha():\n    return 1\n\ndef beta():\n    return 2\n')
    git(session, 'add', 'fixture/shared.py')
    git(session, 'commit', '-q', '-m', 'change beta')
    const betaHead = git(session, 'rev-parse', 'HEAD')
    const measurementTs = '2026-07-27T00:00:00.000Z'
    const retractedTs = '2026-07-27T00:00:01.000Z'
    writeFileSync(join(session, '.spec/project/impact-fixture/evals.ndjson'), [
      JSON.stringify({ scenario: 'measurement-scenario', expected: 'measurement alone enters impact', codeSha: betaHead, blob: null, evaluator: 'rig@1', ts: measurementTs, by: SESSION_ID, verdict: { status: 'pass' } }),
      JSON.stringify({ scenario: 'retracted-scenario', expected: 'retracted evidence is not measurement impact', codeSha: betaHead, blob: null, evaluator: 'rig@1', ts: retractedTs, by: SESSION_ID, verdict: { status: 'pass' } }),
      JSON.stringify({ retracts: retractedTs, scenario: 'retracted-scenario', note: 'positive retraction control', by: SESSION_ID, ts: '2026-07-27T00:00:02.000Z' }),
      '',
    ].join('\n'))
    git(project, 'worktree', 'add', '-q', '-b', 'node/impact-alpha', alphaSession, 'main')
    writeFileSync(join(alphaSession, 'fixture/shared.py'), 'def alpha():\n    return 2\n\ndef beta():\n    return 1\n')
    git(alphaSession, 'add', 'fixture/shared.py')
    git(alphaSession, 'commit', '-q', '-m', 'change alpha')
    const alphaHead = git(alphaSession, 'rev-parse', 'HEAD')
    record(home, project, session, SESSION_ID, 'node/impact-fixture')
    record(home, project, alphaSession, ALPHA_SESSION_ID, 'node/impact-alpha')

    const port = await freePort()
    const scrubbed = [
      'SPEXCODE_ROOT', 'SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'SPEXCODE_INSTANCE_ID',
      'SPEXCODE_PASSWORD', 'SPEXCODE_CLAUDE_CMD', 'CLAUDE_CMD', 'CLAUDE_CODE_SESSION_ID',
      'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID', 'SPEXCODE_CODEX_CMD',
      'SPEXCODE_CODEX_SERVER_CMD', 'SPEXCODE_CODEX_SOCKET_DIR', 'SPEXCODE_OPENCODE_CONTINUE',
      'SPEXCODE_OPENCODE_RESUME_ID', 'SPEXCODE_PI_AGENT_DIR', 'SPEXCODE_ISSUES_DIR',
      'SPEXCODE_INDEX_CACHE_ROOTS', 'SPEXCODE_DASHBOARD_PORT', 'SPEXCODE_PUBLIC',
      'SPEXCODE_TLS_CERT', 'SPEXCODE_TLS_KEY', 'SPEXCODE_HOME', 'SPEXCODE_TMUX', 'PORT',
    ]
    const childEnv = { ...process.env }
    for (const key of scrubbed) delete childEnv[key]
    Object.assign(childEnv, {
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: 'impact-api-none',
      PATH: `${backendBin}:${childEnv.PATH}`,
      IMPACT_REAL_GIT: realGit,
      IMPACT_HTTP_RACE_ENABLE: httpRaceEnable,
      IMPACT_HTTP_RACE_SIGNAL: httpRaceSignal,
      IMPACT_HTTP_RACE_RELEASE: httpRaceRelease,
    })
    child = spawn(process.execPath, ['--import', 'tsx', 'spec-cli/src/index.ts'], {
      cwd: project,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stderr!.on('data', (chunk) => { stderr += chunk.toString() })
    const origin = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 200; attempt++) {
      try { if ((await fetch(`${origin}/health`)).ok) { ready = true; break } } catch { /* booting */ }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(ready, true, `backend failed to start: ${stderr.slice(-1200)}`)
    const scoped = async (id = SESSION_ID) => {
      const response = await fetch(`${origin}/api/evals?q=${encodeURIComponent(`is:eval scope:${id}`)}`)
      const raw = await response.text()
      let body: any = {}
      try { body = JSON.parse(raw) } catch { /* raw text is retained below */ }
      return { status: response.status, body, raw, contentType: response.headers.get('content-type') }
    }
    const rows = (body: any) => (body.items ?? []).filter((item: any) => item.node === 'impact-fixture')
    const row = (body: any, name: string) => rows(body).find((item: any) => item.scenario === name)
    const impactNode = (body: any, id = 'impact-fixture') => body.impact?.nodes?.find((node: any) => node.id === id)
    const impactScenario = (body: any, name: string) => impactNode(body)?.scenarios?.find((scenario: any) => scenario.name === name)
    const observations: any[] = []
    const failures: string[] = []
    const check = (condition: unknown, message: string) => { if (!condition) failures.push(message) }
    const observe = (phase: string, result: { status: number; body: any; raw: string; contentType: string | null }, extra: any = {}) => {
      const rowValues = rows(result.body).map((row: any) => [row.scenario, row.impact])
      const value = { command: 'GET /api/evals?q=is:eval scope:<session>', origin, runtime: process.version, phase, status: result.status, populated: {
        impact: !!result.body.impact,
        nodes: result.body.impact?.nodes?.length ?? 0,
        rows: rowValues.length,
      }, contentType: result.contentType, rows: rowValues,
      error: result.body.error ?? (result.status >= 400 ? result.raw.slice(0, 2_000) : null),
      ...(result.contentType?.includes('json') ? {} : { rawBody: result.raw.slice(0, 2_000) }),
      ...extra }
      observations.push(value)
      console.log(JSON.stringify(value))
    }

    const beta = await scoped()
    observe('beta-only', beta, {
      scrubbed,
      base: beta.body.impact?.base ?? null,
      head: beta.body.impact?.head ?? null,
      selectorHits: impactScenario(beta.body, 'beta-scenario')?.selectorHits ?? [],
      measurementRow: row(beta.body, 'measurement-scenario') ?? null,
      retractedScenarioImpact: impactScenario(beta.body, 'retracted-scenario')?.impact ?? null,
    })
    check(beta.status === 200, 'beta-only must return 200')
    check(beta.body.impact?.base === base && beta.body.impact?.head === betaHead, 'beta-only must expose exact base/head')
    check(JSON.stringify(row(beta.body, 'beta-scenario')?.impact) === JSON.stringify(['code']), 'beta-only code impact must select only beta')
    check(!row(beta.body, 'alpha-scenario'), 'beta-only must not select alpha')
    check(JSON.stringify(row(beta.body, 'measurement-scenario')?.impact) === JSON.stringify(['measurement']), 'measured row must carry exactly measurement impact')
    check(row(beta.body, 'measurement-scenario')?.filterKind === 'result', 'measurement impact must be a measured result row')
    check(!row(beta.body, 'retracted-scenario') && JSON.stringify(impactScenario(beta.body, 'retracted-scenario')?.impact) === '[]', 'retracted reading must not create measurement impact')
    check(JSON.stringify(impactScenario(beta.body, 'beta-scenario')?.selectorHits?.flatMap((hit: any) => hit.selectors)) === JSON.stringify(['beta']), 'beta-only must report beta selector hit')

    writeFileSync(httpRaceEnable, 'enabled\n')
    const movingRequest = scoped()
    let raceReached = false
    for (let attempt = 0; attempt < 500; attempt++) {
      if (existsSync(httpRaceSignal)) { raceReached = true; break }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    check(raceReached, 'public moving-head control must reach the in-flight exact diff')
    if (raceReached) {
      writeFileSync(join(session, 'fixture/shared.py'), 'def alpha():\n    return 1\n\ndef beta():\n    return 3\n')
      git(session, 'add', 'fixture/shared.py')
      git(session, 'commit', '-q', '-m', 'advance beta during scoped read')
    }
    const retryHead = git(session, 'rev-parse', 'HEAD')
    writeFileSync(httpRaceRelease, 'released\n')
    const movingHttp = await movingRequest
    rmSync(httpRaceEnable, { force: true })
    observe('moving-session-head-retry', movingHttp, {
      oldHead: betaHead,
      advancedHead: retryHead,
      publishedHead: movingHttp.body.impact?.head ?? null,
    })
    check(movingHttp.status === 200, 'moving session HEAD must retry to a stable public response')
    check(retryHead !== betaHead && movingHttp.body.impact?.head === retryHead, 'public retry must publish the advanced exact head, never the raced head')
    check(JSON.stringify(row(movingHttp.body, 'beta-scenario')?.impact) === JSON.stringify(['code']), 'retried public response must retain selector-aware beta impact')

    const alpha = await scoped(ALPHA_SESSION_ID)
    observe('alpha-only', alpha, {
      expectedHead: alphaHead,
      head: alpha.body.impact?.head ?? null,
      selected: rows(alpha.body).map((row: any) => row.scenario).sort(),
      selectorHits: impactScenario(alpha.body, 'alpha-scenario')?.selectorHits ?? [],
    })
    check(alpha.status === 200, 'alpha-only must return 200')
    check(alpha.body.impact?.head === alphaHead, 'alpha-only must expose its exact head')
    check(JSON.stringify(rows(alpha.body).map((row: any) => row.scenario).sort()) === JSON.stringify(['alpha-scenario', 'inherited-scenario']), 'alpha-only must select alpha and inherited node selector')
    check(!(rows(alpha.body).some((row: any) => row.scenario === 'beta-scenario')), 'alpha-only must not select beta')

    const evalPath = join(session, '.spec/project/impact-fixture/eval.md')
    writeFileSync(evalPath, evalSource({ alphaExpected: 'alpha dirty semantic', metadataChanged: true, renamed: true }))
    const dirtySemantic = await scoped()
    const alphaSemantic = impactScenario(dirtySemantic.body, 'alpha-scenario')
    const metadata = impactScenario(dirtySemantic.body, 'metadata-scenario')
    observe('dirty-semantic-metadata-rename', dirtySemantic, {
      semantic: alphaSemantic ? {
        delta: alphaSemantic.delta,
        baseScenarioHash: alphaSemantic.baseScenarioHash,
        headScenarioHash: alphaSemantic.headScenarioHash,
      } : null,
      metadata: metadata ? {
        delta: metadata.delta,
        baseScenarioHash: metadata.baseScenarioHash,
        headScenarioHash: metadata.headScenarioHash,
        baseEffectiveCode: metadata.baseEffectiveCode,
        headEffectiveCode: metadata.headEffectiveCode,
      } : null,
      rename: {
        removed: impactScenario(dirtySemantic.body, 'rename-old')?.delta ?? null,
        added: impactScenario(dirtySemantic.body, 'rename-new')?.delta ?? null,
      },
    })
    check(alphaSemantic?.delta?.semantic === true && alphaSemantic?.baseScenarioHash !== alphaSemantic?.headScenarioHash, 'dirty description/expected must be semantic and move hash')
    check(metadata?.delta?.metadataOnly === true && metadata?.baseScenarioHash === metadata?.headScenarioHash, 'dirty test/code/tags must be metadata-only with stable hash')
    check(impactScenario(dirtySemantic.body, 'rename-old')?.delta?.kind === 'removed', 'rename old declaration must be removed')
    check(impactScenario(dirtySemantic.body, 'rename-new')?.delta?.kind === 'added', 'rename new declaration must be added')
    writeFileSync(evalPath, evalSource())

    writeFileSync(evalPath, evalSource({ removeCodeScenarios: true, renamedCode: true }))
    rmSync(join(session, 'fixture/removable.py'))
    renameSync(join(session, 'fixture/rename-source.py'), join(session, 'fixture/rename-target.py'))
    writeFileSync(join(session, 'fixture/rename-target.py'), '# one\n# two\n# three\ndef rename_me():\n    return 2\n')
    const dirtyDeleteRename = await scoped()
    const removedCode = impactScenario(dirtyDeleteRename.body, 'removed-code-scenario')
    const renamedCodeOld = impactScenario(dirtyDeleteRename.body, 'renamed-code-old')
    const renamedCodeNew = impactScenario(dirtyDeleteRename.body, 'renamed-code-new')
    observe('dirty-selector-delete-rename', dirtyDeleteRename, {
      removedCode: removedCode ? { state: removedCode.state, impact: removedCode.impact, selectorHits: removedCode.selectorHits } : null,
      renamedCodeOld: renamedCodeOld ? { state: renamedCodeOld.state, impact: renamedCodeOld.impact, selectorHits: renamedCodeOld.selectorHits } : null,
      renamedCodeNew: renamedCodeNew ? { state: renamedCodeNew.state, impact: renamedCodeNew.impact, selectorHits: renamedCodeNew.selectorHits } : null,
    })
    check(JSON.stringify(removedCode?.impact) === JSON.stringify(['code', 'contract']), 'dirty deletion below line one must hit the removed base selector')
    check(JSON.stringify(renamedCodeOld?.impact) === JSON.stringify(['code', 'contract']), 'dirty rename old side must be remove+selector hit')
    check(JSON.stringify(renamedCodeNew?.impact) === JSON.stringify(['code', 'contract']), 'dirty rename new side must be add+selector hit')
    rmSync(join(session, 'fixture/rename-target.py'))
    writeFileSync(join(session, 'fixture/rename-source.py'), '# one\n# two\n# three\ndef rename_me():\n    return 1\n')
    writeFileSync(join(session, 'fixture/removable.py'), '# one\n# two\n# three\ndef remove_me():\n    return 1\n')
    writeFileSync(evalPath, evalSource())

    const specPath = join(session, '.spec/project/impact-fixture/spec.md')
    writeFileSync(specPath, specSource('beta'))
    const dirtyInherited = await scoped()
    const inherited = impactScenario(dirtyInherited.body, 'inherited-scenario')
    observe('dirty-inherited-node-selector', dirtyInherited, { inherited: inherited ? {
      delta: inherited.delta,
      baseScenarioHash: inherited.baseScenarioHash,
      headScenarioHash: inherited.headScenarioHash,
      baseEffectiveCode: inherited.baseEffectiveCode,
      headEffectiveCode: inherited.headEffectiveCode,
    } : null })
    check(inherited?.delta?.semantic === false && inherited?.delta?.metadata === true, 'dirty inherited node selector must be metadata-only')
    check(JSON.stringify(inherited?.headEffectiveCode) === JSON.stringify([{ path: 'fixture/shared.py', selectors: ['beta'] }]), 'dirty inherited selector must resolve to beta')
    writeFileSync(specPath, specSource())

    writeFileSync(join(session, 'docs/context.md'), 'context v2\n')
    const related = await scoped()
    observe('dirty-related-context', related, { causes: impactNode(related.body)?.causes ?? [] })
    check(impactNode(related.body)?.causes?.some((cause: any) => cause.kind === 'related' && cause.paths.includes('docs/context.md')), 'related movement must remain node review context')
    writeFileSync(join(session, 'docs/context.md'), 'context v1\n')

    const added = join(session, '.spec/project/untracked-node')
    mkdirSync(added, { recursive: true })
    writeFileSync(join(added, 'spec.md'), '---\ntitle: untracked-node\ncode:\n  - fixture/new.py#new_unit\n---\n# new node\n')
    writeFileSync(join(added, 'eval.md'), '---\nscenarios:\n  - name: new-scenario\n    tags: [backend-api]\n    description: new node\n    expected: new node visible\n---\nnew node\n')
    writeFileSync(join(session, 'fixture/new.py'), 'def new_unit():\n    return 1\n')
    const untracked = await scoped()
    observe('untracked-new-node', untracked, {
      addedNode: impactNode(untracked.body, 'untracked-node') ?? null,
      addedRow: (untracked.body.items ?? []).find((row: any) => row.node === 'untracked-node' && row.scenario === 'new-scenario') ?? null,
    })
    check(untracked.status === 200, 'untracked node must return 200')
    check(!!impactNode(untracked.body, 'untracked-node'), 'untracked node must enter impact snapshot')
    check((untracked.body.items ?? []).some((row: any) => row.node === 'untracked-node' && row.scenario === 'new-scenario'), 'untracked node scenario must enter scoped rows')
    rmSync(added, { recursive: true, force: true })
    rmSync(join(session, 'fixture/new.py'), { force: true })

    writeFileSync(evalPath, evalSource({ betaCode: 'fixture/shared.py#gone' }))
    const dead = await scoped()
    observe('dead-selector', dead)
    check(dead.status === 503 && /dead.*shared\.py#gone/.test(dead.body.error ?? ''), 'dead selector must return explicit 503')
    writeFileSync(evalPath, evalSource())

    writeFileSync(join(session, 'fixture/shared.py'), 'def alpha():\n    return 1\n\ndef beta():\n    return 2\n\ndef beta():\n    return 3\n')
    const ambiguous = await scoped()
    observe('ambiguous-selector', ambiguous)
    check(ambiguous.status === 503 && /ambiguous.*shared\.py#beta/.test(ambiguous.body.error ?? ''), 'ambiguous selector must return explicit 503')
    writeFileSync(join(session, 'fixture/shared.py'), 'def alpha():\n    return 1\n\ndef beta():\n    return 2\n')

    writeFileSync(join(session, 'fixture/bad.ts'), 'export function bad( {{{\n')
    writeFileSync(evalPath, evalSource({ betaCode: 'fixture/bad.ts#bad' }))
    const unextractable = await scoped()
    observe('unextractable-selector', unextractable)
    check(unextractable.status === 503 && /unextractable|does not parse/.test(unextractable.body.error ?? ''), 'unextractable selector must return explicit 503')
    writeFileSync(evalPath, evalSource())
    rmSync(join(session, 'fixture/bad.ts'), { force: true })

    const movingRef = 'impact-moving'
    const movingTarget = git(project, 'commit-tree', `${betaHead}^{tree}`, '-p', betaHead, '-m', 'move during exact projection')
    git(project, 'branch', movingRef, betaHead)
    const movingBin = join(fixture, 'moving-bin')
    const movingCount = join(fixture, 'moving-count')
    const movingGit = join(movingBin, 'git')
    mkdirSync(movingBin)
    writeFileSync(movingCount, '')
    writeFileSync(movingGit, `#!/bin/sh
case "$*" in
  *"rev-parse --verify $IMPACT_MOVING_REF^{commit}"*)
    if [ -s "$IMPACT_MOVING_COUNT" ]; then
      "$IMPACT_REAL_GIT" -C "$IMPACT_ROOT" update-ref "refs/heads/$IMPACT_MOVING_REF" "$IMPACT_MOVING_TARGET"
    else
      echo first > "$IMPACT_MOVING_COUNT"
    fi
    ;;
esac
exec "$IMPACT_REAL_GIT" "$@"
`)
    chmodSync(movingGit, 0o755)
    const movingProbe = [
      `const product = await import('./spec-eval/src/sessioneval.ts')`,
      `try { const projection = await product.projectSessionImpact(process.cwd(), { base: ${JSON.stringify(base)}, head: ${JSON.stringify(movingRef)} }); console.log(JSON.stringify({ published: true, projection })) }`,
      `catch (error) { console.log(JSON.stringify({ published: false, name: error?.name, error: error?.message ?? String(error) })) }`,
    ].join('\n')
    const movingRaw = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', movingProbe], {
      cwd: project,
      env: {
        ...childEnv,
        PATH: `${movingBin}:${childEnv.PATH}`,
        IMPACT_REAL_GIT: realGit,
        IMPACT_ROOT: project,
        IMPACT_MOVING_REF: movingRef,
        IMPACT_MOVING_TARGET: movingTarget,
        IMPACT_MOVING_COUNT: movingCount,
      },
      encoding: 'utf8',
    })
    const moving = JSON.parse(movingRaw.trim().split('\n').at(-1)!)
    const movingObservation = {
      command: 'projectSessionImpact(<repo>, { base: <oid>, head: <symbolic-ref> })',
      phase: 'moving-symbolic-ref-auxiliary',
      runtime: process.version,
      ...moving,
    }
    observations.push(movingObservation)
    console.log(JSON.stringify(movingObservation))
    check(moving.published === false && moving.name === 'SessionImpactRevisionMovedError' && /revisions moved/.test(moving.error ?? ''), 'moving symbolic revision must fail updating/unavailable before publication')

    console.log(JSON.stringify({
      verdict: failures.length ? 'fail' : 'pass',
      phases: observations.length,
      failures,
      ...(failures.length ? { backendStderrTail: stderr.slice(-4_000) } : {}),
    }))
    assert.deepEqual(failures, [])
  } finally {
    if (child) await stop(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})
