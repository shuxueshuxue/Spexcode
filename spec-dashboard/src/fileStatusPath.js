const GOVERNANCE_FILENAMES = new Set(['spec.md', 'eval.md', 'evals.ndjson'])

// Governance nodes are source-of-truth metadata, not ordinary project files. Keep their paths in the
// document itself and out of the ambient footer; ordinary source and user attachments remain visible.
export const isGovernancePath = (path) => {
  const normalized = typeof path === 'string' ? path.replaceAll('\\', '/') : ''
  if (!normalized.startsWith('.spec/')) return false
  const leaf = normalized.slice('.spec/'.length).split('/').pop()
  return GOVERNANCE_FILENAMES.has(leaf)
}
