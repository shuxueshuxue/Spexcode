import type { ForgeDriver, ForgeIssue, ForgePR } from './port.js'
import { resolveLinks, type NodeLinks } from './links.js'

export type ForgeDelta =
  | { kind: 'issue'; issue: ForgeIssue }
  | { kind: 'pr'; pr: ForgePR }
  | { kind: 'remove'; target: 'issue' | 'pr'; number: number }

export class ForgeCache {
  private issues = new Map<number, ForgeIssue>()
  private prs = new Map<number, ForgePR>()

  apply(delta: ForgeDelta): void {
    if (delta.kind === 'issue') this.issues.set(delta.issue.number, delta.issue)
    else if (delta.kind === 'pr') this.prs.set(delta.pr.number, delta.pr)
    else (delta.target === 'issue' ? this.issues : this.prs).delete(delta.number)
  }

  async reconcile(driver: ForgeDriver): Promise<void> {
    const [issues, prs] = await Promise.all([driver.listIssues(), driver.listPRs()])
    this.issues = new Map(issues.map((i) => [i.number, i]))
    this.prs = new Map(prs.map((p) => [p.number, p]))
  }

  // the INCREMENTAL halves reconcile() is made of: merge an updated-since issue window over the map
  // (an issue never leaves — a closed one just updates in place), and replace the PR set (the open-PR
  // list is small and self-truncating, so full replacement IS its delta).
  applyIssues(issues: ForgeIssue[]): void {
    for (const i of issues) this.issues.set(i.number, i)
  }
  setPRs(prs: ForgePR[]): void {
    this.prs = new Map(prs.map((p) => [p.number, p]))
  }

  view(nodeIds: string[]): NodeLinks[] {
    return resolveLinks([...this.issues.values()], [...this.prs.values()], nodeIds)
  }

  // the raw cached set — for the one consumer (the unified Issue port, spec-cli issues.ts) that needs
  // EVERY cached issue, linked or not. Resolution stays the only derived view (view() above).
  state(): { issues: ForgeIssue[]; prs: ForgePR[] } {
    return { issues: [...this.issues.values()], prs: [...this.prs.values()] }
  }
}
