import { loadSpecs } from '../../spec-cli/src/specs.js'
import type { ForgeDriver, ForgeIssue, ForgePR } from './port.js'
import { DEFAULT_FORGE_HOST, FORGE_DRIVERS, forgeDriverFor } from './drivers.js'
import { resolveLinks, type NodeLinks } from './links.js'
import { resolveEvalPending, type NodeEvalPending } from './needs-yatsu-eval.js'

// tiny flag reader over this command's own arg slice (everything after `forge`), so cli.ts stays routing-only.
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (args: string[], name: string) => args.includes(`--${name}`)

async function readForge(
  args: string[],
): Promise<{ driver: ForgeDriver; nodeIds: string[]; issues: ForgeIssue[]; prs: ForgePR[] } | null> {
  const host = flag(args, 'host') ?? DEFAULT_FORGE_HOST
  const driver = forgeDriverFor(host)
  if (!driver) {
    console.error(`forge: unknown host '${host}' (known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')})`)
    return null
  }
  const nodeIds = (await loadSpecs()).map((s) => s.id)
  const [issues, prs] = await Promise.all([driver.listIssues(), driver.listPRs()])
  return { driver, nodeIds, issues, prs }
}

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

async function links(args: string[]): Promise<number> {
  const forge = await readForge(args)
  if (!forge) return 2
  const { driver, nodeIds, issues, prs } = forge
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

function renderPending(pending: NodeEvalPending[]): string {
  const out: string[] = []
  for (const n of pending) {
    out.push(`\n${n.node}`)
    for (const i of n.pending) out.push(`    #${i.number} ${i.state}  ${i.title}  (via ${i.via})  ${i.url}`)
  }
  return out.join('\n')
}

async function evalPending(args: string[]): Promise<number> {
  const forge = await readForge(args)
  if (!forge) return 2
  const { driver, nodeIds, issues, prs } = forge
  let resolved = resolveEvalPending(issues, prs, nodeIds)

  const only = flag(args, 'node')
  if (only) {
    if (!nodeIds.includes(only)) { console.error(`forge: no such node '${only}'`); return 1 }
    resolved = resolved.filter((n) => n.node === only)
  }

  if (has(args, 'json')) { console.log(JSON.stringify(resolved, null, 2)); return 0 }
  const nPending = resolved.reduce((a, n) => a + n.pending.length, 0)
  console.log(
    `spec-forge · ${driver.host} · ${resolved.length} node(s) with eval pending · ${nPending} issue(s)` +
      ` · scanned ${issues.length} issue(s), ${prs.length} pr(s)`,
  )
  if (resolved.length) console.log(renderPending(resolved))
  return 0
}

export async function runForge(args: string[]): Promise<number> {
  const sub = args[0]
  if (sub === 'links') return links(args.slice(1))
  if (sub === 'eval-pending') return evalPending(args.slice(1))
  console.error('spex forge: links [--host github] [--node <id>] [--json] | eval-pending [--host github] [--node <id>] [--json]')
  return 2
}
