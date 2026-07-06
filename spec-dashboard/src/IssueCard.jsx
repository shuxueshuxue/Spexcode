import { routeHash } from './route.js'

// Compact per-node issue entry. It always opens SpexCode's own Issues page; forge permalinks stay in the
// selected issue detail where they are secondary metadata.
export default function IssueCard({ issue }) {
  const store = issue?.store || 'local'
  const status = issue?.status || 'open'
  return (
    <a className="issue-card" href={routeHash('issues', issue.id)} data-tip={issue.concern || issue.id}>
      <span className="issue-card-top">
        <span className="issue-num">{issue.id}</span>
        <span className={`fv-store fv-store-${store === 'local' ? 'local' : 'forge'}`}>{store}</span>
        <span className={`issue-state st-${status}`}>{status}</span>
      </span>
      <span className="issue-card-title">{issue.concern}</span>
    </a>
  )
}
