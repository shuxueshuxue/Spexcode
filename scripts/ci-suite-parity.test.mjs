import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ciWorkflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const workflowsDir = join(root, '.github', 'workflows')
const exemptionFile = join(root, 'scripts', 'ci-suite-parity.exemptions.json')

function manifest(dir) {
  const path = join(root, dir, 'package.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

// The root's workspace globs are the only roster; a `packages/*` entry expands to its real directories.
export function workspaceDirs() {
  const globs = manifest('.')?.workspaces ?? []
  return globs.flatMap((glob) => {
    if (!glob.endsWith('/*')) return [glob]
    const parent = glob.slice(0, -2)
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && manifest(join(parent, entry.name)))
      .map((entry) => join(parent, entry.name))
  })
}

const workspaces = workspaceDirs().map((dir) => ({ dir, ...manifest(dir) }))
const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]))
const named = [...ciWorkflow.matchAll(/--workspace=(\S+)/g)].map((match) => match[1])

// A step may also run a suite from inside the package (`working-directory: spec-cli` + `run: npm test`).
const viaWorkingDirectory = new Set(
  [...ciWorkflow.matchAll(/working-directory:\s*(\S+)\s*\n\s*run:\s*npm test\b/g)].map((match) => match[1]),
)

function walkFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(path))
    else files.push(path)
  }
  return files
}

function repoPath(path) {
  return relative(root, path).split(sep).join('/')
}

export function testDeclarationFiles() {
  return walkFiles(root)
    .filter((path) => path.endsWith('.e2e.mjs'))
    .map(repoPath)
    .sort()
}

function shellTokens(command) {
  return [...command.matchAll(/'(?:[^']*)'|"(?:[^"]*)"|[^\s]+/g)]
    .map((match) => match[0].replace(/^['"]|['"]$/g, ''))
}

function shellSegments(text) {
  return text
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function packageForDirectory(dir) {
  let current = resolve(root, dir)
  while (current.startsWith(root)) {
    if (existsSync(join(current, 'package.json'))) return { dir: repoPath(current), manifest: JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) }
    if (current === root) break
    current = dirname(current)
  }
  return { dir: '.', manifest: manifest('.') }
}

function resolvePackageDirectory(baseDir, prefix) {
  if (!prefix) return resolve(root, baseDir)
  return resolve(root, baseDir, prefix)
}

function scriptInvocation(segment, baseDir) {
  const tokens = shellTokens(segment)
  for (let index = 0; index < tokens.length; index++) {
    const executable = tokens[index]
    if (executable !== 'npm' && executable !== 'pnpm') continue
    let cursor = index + 1
    let packageDir = resolve(root, baseDir)
    while (cursor < tokens.length && (tokens[cursor] === '--prefix' || tokens[cursor] === '--dir')) {
      packageDir = resolvePackageDirectory(baseDir, tokens[cursor + 1])
      cursor += 2
    }
    if (executable === 'pnpm' && tokens[cursor] === 'exec') continue
    if (tokens[cursor] === 'run') cursor++
    while (tokens[cursor] === '-s' || tokens[cursor] === '--silent') cursor++
    const script = tokens[cursor]
    if (!script || ['ci', 'install', 'i', 'publish', 'exec'].includes(script)) continue
    const workspaceFlag = tokens.slice(cursor + 1).find((token) => token.startsWith('--workspace='))
    const workspaceName = workspaceFlag?.slice('--workspace='.length)
    if (workspaceName) {
      const workspace = byName.get(workspaceName)
      if (!workspace) continue
      packageDir = resolve(root, workspace.dir)
    }
    const packageInfo = packageForDirectory(packageDir)
    if (packageInfo.manifest?.scripts?.[script]) return { script, dir: packageInfo.dir, command: packageInfo.manifest.scripts[script] }
  }
  return null
}

function directScriptPaths(segment, baseDir) {
  const tokens = shellTokens(segment)
  const paths = []
  for (let index = 0; index < tokens.length; index++) {
    const executable = tokens[index]
    const isDirect = executable === 'node' || executable === 'npx' || executable === 'tsx'
    const isPnpmExec = executable === 'pnpm' && tokens[index + 1] === 'exec'
    if (!isDirect && !isPnpmExec) continue
    const firstArgument = index + (isPnpmExec ? 2 : 1)
    for (const token of tokens.slice(firstArgument)) {
      if (token.startsWith('-')) continue
      if (!/\.(?:mjs|cjs|js|ts|tsx)(?:\*)?$/.test(token)) continue
      const path = resolve(root, baseDir, token)
      if (existsSync(path) && !paths.includes(path)) paths.push(path)
    }
  }
  return paths
}

function workflowSteps(text) {
  const lines = text.split(/\r?\n/)
  const steps = []
  let step = { directory: '.', commands: [] }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*-\s+(?:name|uses):/.test(line) && step.commands.length) {
      steps.push(step)
      step = { directory: '.', commands: [] }
    }
    const workingDirectory = line.match(/^\s*working-directory:\s*(\S+)/)?.[1]
    if (workingDirectory) step.directory = workingDirectory
    const run = line.match(/^(\s*)run:\s*(.*)$/)
    if (!run) continue
    const value = run[2].trim()
    if (value === '|' || value === '>-' || value === '>') {
      const body = []
      const indent = run[1].length
      for (let next = index + 1; next < lines.length; next++) {
        if (lines[next].trim() && lines[next].search(/\S/) <= indent) break
        body.push(lines[next].slice(Math.min(lines[next].length, indent + 2)))
        index = next
      }
      step.commands.push(body.join('\n'))
    } else {
      step.commands.push(value)
    }
  }
  if (step.commands.length) steps.push(step)
  return steps
}

function localActionSteps(workflowText) {
  const steps = []
  for (const match of workflowText.matchAll(/uses:\s*(\.\/[^\s#]+)/g)) {
    const actionDir = resolve(root, match[1])
    for (const name of ['action.yml', 'action.yaml']) {
      const path = join(actionDir, name)
      if (!existsSync(path)) continue
      steps.push(...workflowSteps(readFileSync(path, 'utf8')).map((step) => ({
        ...step,
        directory: repoPath(resolve(actionDir, step.directory)),
      })))
    }
  }
  return steps
}

export function measureCiReachability() {
  const workflowTexts = walkFiles(workflowsDir)
    .filter((path) => path.endsWith('.yml') || path.endsWith('.yaml'))
    .map((path) => readFileSync(path, 'utf8'))
  const steps = workflowTexts.flatMap(workflowSteps).concat(workflowTexts.flatMap(localActionSteps))
  const declarations = testDeclarationFiles()
  const declarationReferences = new Map(declarations.map((path) => [path, []]))
  const scanned = new Set()
  const pending = steps.flatMap((step) => step.commands.map((command) => ({ command, directory: step.directory })))
  const expanded = new Set()

  while (pending.length) {
    const { command, directory } = pending.shift()
    let currentDirectory = directory
    for (const segment of shellSegments(command)) {
      const cd = segment.match(/^cd\s+([^\s]+)/)
      if (cd) {
        currentDirectory = repoPath(resolve(root, currentDirectory, cd[1]))
        continue
      }
      const invocation = scriptInvocation(segment, currentDirectory)
      if (invocation) {
        const key = `${invocation.dir}:${invocation.script}`
        if (!expanded.has(key)) {
          expanded.add(key)
          pending.push({ command: invocation.command, directory: invocation.dir })
        }
      }
      for (const path of directScriptPaths(segment, currentDirectory)) {
        const key = repoPath(path)
        if (scanned.has(key)) continue
        scanned.add(key)
        pending.push({ command: readFileSync(path, 'utf8'), directory: dirname(key) })
      }
    }
  }

  for (const path of scanned) {
    const text = readFileSync(join(root, path), 'utf8')
    for (const declaration of declarations) {
      const name = declaration.slice(declaration.lastIndexOf('/') + 1)
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (text.includes(declaration) || new RegExp(`\\b${escapedName}\\b`).test(text)) {
        declarationReferences.get(declaration).push(path)
      }
    }
  }
  return {
    declarations,
    scanned: [...scanned].sort(),
    reached: new Set([...declarationReferences].filter(([, refs]) => refs.length).map(([path]) => path)),
    declarationReferences,
  }
}

function assertDeclarationCoverage() {
  const measurement = measureCiReachability()
  const exemptions = JSON.parse(readFileSync(exemptionFile, 'utf8'))
  const declarations = new Set(measurement.declarations)
  const entries = Object.entries(exemptions.files ?? {})
  const errors = []
  for (const [path, reasonId] of entries) {
    if (!declarations.has(path)) errors.push(`exemption names missing test declaration: ${path}`)
    if (!Object.hasOwn(exemptions.reasons ?? {}, reasonId)) errors.push(`exemption ${path} names unknown reason: ${reasonId}`)
  }
  for (const [reasonId, reason] of Object.entries(exemptions.reasons ?? {})) {
    if (typeof reason !== 'string' || reason.trim().length < 40) errors.push(`reason ${reasonId} must explain the concrete non-CI path in at least 40 characters`)
    if (!entries.some(([, entryReason]) => entryReason === reasonId)) errors.push(`reason ${reasonId} is not referenced by any exemption entry`)
  }
  const exempted = new Set(entries.map(([path]) => path))
  const missing = measurement.declarations.filter((path) => !measurement.reached.has(path) && !exempted.has(path))
  if (missing.length) errors.push(`test declarations are neither reachable from CI nor exempted: ${missing.join(', ')}`)
  const redundant = entries.map(([path]) => path).filter((path) => measurement.reached.has(path))
  if (redundant.length) errors.push(`exemptions are now reached by CI and must be removed: ${redundant.join(', ')}`)
  assert.deepEqual(errors, [], errors.join('\n'))
  return measurement
}

test('every workspace the workflow names still exists', () => {
  for (const name of named) {
    assert.ok(byName.has(name), `ci.yml runs --workspace=${name}, which no workspace declares; drop the line or restore the package`)
  }
})

test('every workspace that ships a test script is run by the workflow', () => {
  const missing = workspaces
    .filter((workspace) => workspace.scripts?.test)
    .filter((workspace) => !named.includes(workspace.name) && !viaWorkingDirectory.has(workspace.dir))
    .map((workspace) => `${workspace.name} (${workspace.dir})`)
  assert.deepEqual(missing, [], `these workspaces have tests no CI step runs: ${missing.join(', ')}`)
})

test('the workflow names no workspace twice', () => {
  const seen = named.filter((name, index) => named.indexOf(name) !== index)
  assert.deepEqual(seen, [], `duplicated --workspace entries: ${seen.join(', ')}`)
})

test('every test declaration is reached by CI or has a live, justified exemption', () => {
  assertDeclarationCoverage()
})
