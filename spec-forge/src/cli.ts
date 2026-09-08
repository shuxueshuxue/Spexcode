import { loadSpecs } from '@spexcode/spec-core'
import type { ForgeDriver, ForgeIssue, ForgePR } from './port.js'
import { FORGE_DRIVERS, forgeDriverFor, resolveForgeHost } from './drivers.js'
import { resolveLinks, type NodeLinks } from './links.js'

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (args: string[], name: string) => args.includes(`--${name}`)

async function readForge(
  args: string[],
): Promise<{ driver: ForgeDriver; nodeIds: string[]; issues: ForgeIssue[]; prs: ForgePR[] } | null> {
  const host = flag(args, 'store') ?? resolveForgeHost()
  const driver = forgeDriverFor(host)
  if (!driver) {
    console.error(`spex issue links: unknown --store '${host}' (known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')})`)
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
    if (!nodeIds.includes(only)) { console.error(`spex issue links: no such node '${only}'`); return 1 }
    resolved = resolved.filter((n) => n.node === only)
  }

  if (has(args, 'json')) { console.log(JSON.stringify(resolved, null, 2)); return 0 }
  const nIssues = resolved.reduce((a, n) => a + n.issues.length, 0)
  const nPRs = resolved.reduce((a, n) => a + n.prs.length, 0)
  console.log(
    `spec-forge · ${driver.host} · ${resolved.length} linked node(s) · ${nIssues} issue(s), ${nPRs} pr(s)` +
      ` · traced ${issues.length} issue(s), ${prs.length} pr(s)`,
  )
  if (resolved.length) console.log(render(resolved))
  return 0
}

export async function runIssueLinks(args: string[]): Promise<number> {
  return links(args)
}
