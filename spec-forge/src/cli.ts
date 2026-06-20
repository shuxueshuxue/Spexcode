import { loadSpecs } from '../../spec-cli/src/specs.js'
import type { ForgeDriver } from './port.js'
import { githubDriver } from './drivers/github.js'
import { resolveLinks, type NodeLinks } from './links.js'

// @@@ forge cli - the spec-forge link tracer on the real `spex` surface. It READS a forge (open issues +
// PRs) through a driver and resolves each to the spec node it serves, then surfaces node → work. Every
// verb is read-only: it touches the forge only to read, and never writes a node's status (that stays
// git-derived). spec-cli/src/cli.ts carries only a thin `forge` route that delegates here; the logic lives
// in this package (driver = the host read, links.ts = the host-agnostic resolution, this file = display).

// @@@ driver registry - selecting a host goes THROUGH the port, never a hardcoded `if host === …` branch:
// the registry is keyed by each driver's own `host`, so `--host <x>` is a lookup over the ForgeDriver
// abstraction. github is the only real driver today (gitlab/bitbucket = a future driver wrapping glab/etc).
const DRIVERS: ForgeDriver[] = [githubDriver]
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

// @@@ render - print the node → work inversion for a human. One block per node that has links: its issues
// (with the source that linked them — marker vs the inferred pr/branch) then its PRs. The url trails each
// row so it stays clickable. Pure string-building; printing is the caller's job.
function render(links: NodeLinks[]): string {
  const out: string[] = []
  for (const n of links) {
    out.push(`\n${n.node}`)
    if (n.issues.length) {
      out.push('  issues:')
      for (const i of n.issues) out.push(`    #${i.number} ${i.state}  ${i.title}  (via ${i.via})  ${i.url}`)
    }
    if (n.prs.length) {
      out.push('  prs:')
      for (const p of n.prs) out.push(`    #${p.number} ${p.state}  ${p.title}  ${p.headRefName}  ${p.url}`)
    }
  }
  return out.join('\n')
}

// @@@ forge links - the one verb: read the host's open issues/PRs through the chosen driver, resolve them
// against the real node ids (loadSpecs — git/`.spec` canonical), and print node → linked work. --node <id>
// narrows to one node; --json emits the raw resolved structure. Read-only end to end.
async function links(args: string[]): Promise<number> {
  const host = flag(args, 'host') ?? DEFAULT_HOST
  const driver = driverFor(host)
  if (!driver) {
    console.error(`forge: unknown host '${host}' (known: ${DRIVERS.map((d) => d.host).join(', ')})`)
    return 2
  }
  const nodeIds = (await loadSpecs()).map((s) => s.id)
  const [issues, prs] = await Promise.all([driver.listIssues(), driver.listPRs()])
  let resolved = resolveLinks(issues, prs, nodeIds)

  const only = flag(args, 'node')
  if (only) {
    if (!nodeIds.includes(only)) { console.error(`forge: no such node '${only}'`); return 1 }
    resolved = resolved.filter((n) => n.node === only)
  }

  if (has(args, 'json')) { console.log(JSON.stringify(resolved, null, 2)); return 0 }
  const nIssues = resolved.reduce((a, n) => a + n.issues.length, 0)
  const nPRs = resolved.reduce((a, n) => a + n.prs.length, 0)
  console.log(
    `spec-forge · ${driver.host} · ${resolved.length} linked node(s) · ${nIssues} issue(s), ${nPRs} pr(s)` +
      ` · scanned ${issues.length} issue(s), ${prs.length} pr(s)`,
  )
  if (resolved.length) console.log(render(resolved))
  return 0
}

// @@@ runForge - the package's single entrypoint, called by cli.ts's thin `forge` route with the arg slice
// after `forge`. Routes to a read-only verb and returns the process exit code (the route just exits on it).
export async function runForge(args: string[]): Promise<number> {
  const sub = args[0]
  if (sub === 'links') return links(args.slice(1))
  console.error('spex forge: links [--host github] [--node <id>] [--json]')
  return 2
}
