import { loadSpecs } from '../../spec-cli/src/specs.js'
import type { ForgeDriver, IssueRow } from './port.js'
import { githubDriver } from './drivers/github.js'
import { gitlabDriver } from './drivers/gitlab.js'
import { mirrorNode, type MirrorPR } from './outbound.js'

// @@@ forge cli - the spec-forge projection on the real `spex` surface (until now it was reachable only
// through standalone proof scripts). It is the capstone of the slice, NOT a new direction: every verb
// here is read-only, projects the spec graph OUT, performs zero network and mutates nothing — git/`.spec`
// stays the single source of truth, exactly as the port's contract demands. spec-cli/src/cli.ts carries
// only a thin `forge` route that delegates here; all the logic lives in this package.

// @@@ driver registry - selecting a host goes THROUGH the port, never a hardcoded `if host === …` branch:
// the registry is keyed by each driver's own `host`, so `forge list --host gitlab` is a lookup over the
// ForgeDriver abstraction. Adding Bitbucket later is one push here, no new conditional. github is default.
const DRIVERS: ForgeDriver[] = [githubDriver, gitlabDriver]
const DEFAULT_HOST = 'github'
function driverFor(host: string): ForgeDriver | undefined {
  return DRIVERS.find((d) => d.host === host)
}

// tiny flag reader over this command's own arg slice (everything after `forge`), so cli.ts stays routing-only.
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (args: string[], name: string) => args.includes(`--${name}`)
function positionals(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i]
    if (t.startsWith('--')) { if (t === '--host') i++; continue }
    out.push(t)
  }
  return out
}

// @@@ table - render aligned columns for a human; a forge issue collapses to its title + the labels that
// name what the projection is and which node it mirrors. The body is shown by --json (the full row), not
// crammed into the table. Pure string-building — printing is the caller's job.
function table(rows: { title: string; labels: string }[]): string {
  const w = Math.max(5, ...rows.map((r) => r.title.length))
  const head = `  ${'TITLE'.padEnd(w)}  LABELS`
  const body = rows.map((r) => `  ${r.title.padEnd(w)}  ${r.labels}`)
  return [head, ...body].join('\n')
}

// @@@ forge list - print one host's listPending() projection: the graph's pending nodes as that host's
// forge-issue rows. Default host github; --host selects another driver THROUGH the port. --json emits the
// raw IssueRow[] (full shape, body included); otherwise a clean human table.
async function list(args: string[]): Promise<number> {
  const host = flag(args, 'host') ?? DEFAULT_HOST
  const driver = driverFor(host)
  if (!driver) {
    console.error(`forge: unknown host '${host}' (known: ${DRIVERS.map((d) => d.host).join(', ')})`)
    return 2
  }
  const rows: IssueRow[] = await driver.listPending()
  if (has(args, 'json')) { console.log(JSON.stringify(rows, null, 2)); return 0 }
  console.log(`spec-forge · ${driver.host} · listPending → ${rows.length} pending node(s)\n`)
  if (rows.length) console.log(table(rows.map((r) => ({ title: r.title, labels: r.labels.join(', ') }))))
  return 0
}

// @@@ forge mirror - project ONE node OUT as a PR-shaped mirror (the outbound twin of list). Reads the node
// from loadSpecs (git/`.spec` canonical), then mirrorNode maps its derived status to the vendor-neutral
// MirrorPR. --json emits the raw object; otherwise a short human summary. Read-only, like everything here.
async function mirror(args: string[]): Promise<number> {
  const id = positionals(args)[0]
  if (!id) { console.error('usage: spex forge mirror <nodeId>'); return 2 }
  const node = (await loadSpecs()).find((s) => s.id === id)
  if (!node) { console.error(`forge: no such node '${id}'`); return 1 }
  const pr: MirrorPR = mirrorNode({ id: node.id, status: node.status, title: node.title, desc: node.desc, body: node.body })
  if (has(args, 'json')) { console.log(JSON.stringify(pr, null, 2)); return 0 }
  console.log(`spec-forge · mirror ${node.id}`)
  console.log(`  title : ${pr.title}`)
  console.log(`  head  : ${pr.head ?? '— (no branch yet; draft)'}  →  base ${pr.base}`)
  console.log(`  draft : ${pr.draft}`)
  console.log(`  labels: ${pr.labels.join(', ')}`)
  return 0
}

// @@@ runForge - the package's single entrypoint, called by cli.ts's thin `forge` route with the arg slice
// after `forge`. Routes to a read-only verb and returns the process exit code (the route just exits on it).
export async function runForge(args: string[]): Promise<number> {
  const sub = args[0]
  if (sub === 'list') return list(args.slice(1))
  if (sub === 'mirror') return mirror(args.slice(1))
  console.error('spex forge: list [--host github|gitlab] [--json] | mirror <nodeId> [--json]')
  return 2
}
