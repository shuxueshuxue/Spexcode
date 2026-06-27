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

  view(nodeIds: string[]): NodeLinks[] {
    return resolveLinks([...this.issues.values()], [...this.prs.values()], nodeIds)
  }
}
