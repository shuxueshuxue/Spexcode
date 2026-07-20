import { useEffect, useRef, useState } from 'react'
import { apiUrl } from './project.js'

// the lazily-fetched NODE prose corpus ([[graph-lean]]). Review rows never ride this endpoint; the palette
// obtains them from [[paged-review]]. Module-cached stale-while-revalidate: the last corpus seeds instantly (ranking and
// previews are never cold), and each mount revalidates at most once, the first time `enabled` turns true —
// so the palette refetches per open (a fresh mount).
let corpusCache = null
export function useSpecCorpus(enabled = true) {
  const [corpus, setCorpus] = useState(corpusCache)
  const fetched = useRef(false)
  useEffect(() => {
    if (!enabled || fetched.current) return
    fetched.current = true
    // no unmount flag: the once-per-mount ref must survive StrictMode's double effect (whose cleanup
    // would strand the resolved corpus), and React 18 no-ops a setState after a real unmount anyway.
    fetch(apiUrl('/api/specs/lite')).then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        corpusCache = {
          bodies: Object.fromEntries((rows || []).map((r) => [r.id, r.body || ''])),
        }
        setCorpus(corpusCache)
      })
      .catch(() => {})
  }, [enabled])
  return corpus
}
