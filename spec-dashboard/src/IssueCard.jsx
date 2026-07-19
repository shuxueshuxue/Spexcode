import { addressHash, issueAddress } from './address.js'
import { ReviewState } from './ReviewShell.jsx'

// Compact per-node issue entry. It always opens SpexCode's own Issues page; forge permalinks stay in the
// selected issue detail where they are secondary metadata.
export default function IssueCard({ issue, onNavigateAddress }) {
  const store = issue?.store || 'local'
  const status = issue?.status || 'open'
  const address = issueAddress(issue.id)
  return (
    <a
      className="issue-card"
      href={addressHash(address)}
      data-tip={issue.concern || issue.id}
      onClick={onNavigateAddress ? (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onNavigateAddress(address)
      } : undefined}
    >
      <span className="issue-card-top">
        <span className="issue-num">{issue.id}</span>
        <span className={`fv-store fv-store-${store === 'local' ? 'local' : 'forge'}`}>{store}</span>
        <ReviewState kind="issue" state={status} showLabel size={12} className="issue-card-state" />
      </span>
      <span className="issue-card-title">{issue.concern}</span>
    </a>
  )
}
