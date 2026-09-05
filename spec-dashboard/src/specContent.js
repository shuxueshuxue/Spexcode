import { useEffect, useState } from 'react'
import { loadPublicSpecContent, specUrl } from './data.js'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'

// Body content is shared by the full document, the node popup, and the selection layer so all three
// surfaces address the same fetched version.
const contentCache = new Map()

// Which source a body comes from is a property of the BUILD, not of the call site: a published tree has one
// static document per node and no backend at all. Defaulting the flag here means every surface that reads a
// body — the document, the popup, the selection layer — is right in both builds without repeating the choice.
export function useSpecContent(id, version, { embedded = false, publicGraph = PUBLIC_GRAPH_ONLY } = {}) {
  const key = `${publicGraph ? 'public:' : ''}${id}@${version ?? ''}`
  const [content, setContent] = useState(() => contentCache.get(key) ?? null)
  useEffect(() => {
    if (embedded || !id) return undefined
    const hit = contentCache.get(key)
    if (hit) { setContent(hit); return }
    setContent(null)
    let on = true
    const request = publicGraph
      ? loadPublicSpecContent(id)
      : fetch(specUrl(id, 'content')).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    request
      .then((d) => { contentCache.set(key, d); if (on) setContent(d) })
      .catch(() => { if (on) setContent({ body: '', parts: null }) })
    return () => { on = false }
  }, [embedded, id, version, key, publicGraph])
  return content
}
