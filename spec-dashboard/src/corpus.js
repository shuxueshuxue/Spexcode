import { useEffect, useRef, useState } from 'react'
import { apiUrl } from './project.js'

// the lazily-fetched prose corpus ([[graph-lean]]): the board omits node `body` and slims `scenarios` to
// {name, tags}, so every surface that shows or ranks prose joins it from ONE `/api/specs/lite` fetch — off
// the board's hot poll. `bodies` is {id → spec prose}; `scenarios` is {id → {scenario name → {description,
// expected, code?}}}. Module-cached stale-while-revalidate: the last corpus seeds instantly (ranking and
// previews are never cold), and each mount revalidates at most once, the first time `enabled` turns true —
// so the palette refetches per open (a fresh mount), while the always-mounted focus panel fetches once, on
// the first focus that actually needs prose.
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
          scenarios: Object.fromEntries((rows || []).filter((r) => r.scenarios?.length)
            .map((r) => [r.id, Object.fromEntries(r.scenarios.map((s) => [s.name, s]))])),
        }
        setCorpus(corpusCache)
      })
      .catch(() => {})
  }, [enabled])
  return corpus
}
