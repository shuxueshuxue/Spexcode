import type { ForgeDriver, ForgeIssue, ForgePR } from './port.js'
import { resolveLinks, type NodeLinks } from './links.js'

export type ForgeDelta =
  | { kind: 'issue'; issue: ForgeIssue }
  | { kind: 'pr'; pr: ForgePR }
  | { kind: 'remove'; target: 'issue' | 'pr'; number: number }

function sameMap<T>(a: Map<number, T>, b: Map<number, T>): boolean {
  if (a.size !== b.size) return false
  for (const [number, value] of a)
    if (!b.has(number) || JSON.stringify(value) !== JSON.stringify(b.get(number))) return false
  return true
}

export class ForgeCache {
  private issues = new Map<number, ForgeIssue>()
  private prs = new Map<number, ForgePR>()
  private revision = 0

  apply(delta: ForgeDelta): void {
    if (delta.kind === 'issue') this.set(this.issues, delta.issue)
    else if (delta.kind === 'pr') this.set(this.prs, delta.pr)
    else {
      const target = delta.target === 'issue' ? this.issues : this.prs
      if (target.delete(delta.number)) this.revision++
    }
  }

  async reconcile(driver: ForgeDriver): Promise<void> {
    const [issues, prs] = await Promise.all([driver.listIssues(), driver.listPRs()])
    const nextIssues = new Map(issues.map((i) => [i.number, i]))
    const nextPRs = new Map(prs.map((p) => [p.number, p]))
    if (!sameMap(this.issues, nextIssues) || !sameMap(this.prs, nextPRs)) this.revision++
    this.issues = nextIssues
    this.prs = nextPRs
  }

  applyIssues(issues: ForgeIssue[]): void {
    for (const i of issues) this.set(this.issues, i)
  }
  setPRs(prs: ForgePR[]): void {
    const next = new Map(prs.map((p) => [p.number, p]))
    if (!sameMap(this.prs, next)) this.revision++
    this.prs = next
  }

  view(nodeIds: string[]): NodeLinks[] {
    return resolveLinks([...this.issues.values()], [...this.prs.values()], nodeIds)
  }

  state(): { issues: ForgeIssue[]; prs: ForgePR[] } {
    return { issues: [...this.issues.values()], prs: [...this.prs.values()] }
  }

  stateRevision(): number {
    return this.revision
  }

  private set<T extends ForgeIssue | ForgePR>(target: Map<number, T>, value: T): void {
    if (JSON.stringify(target.get(value.number)) !== JSON.stringify(value)) {
      target.set(value.number, value)
      this.revision++
    }
  }
}
