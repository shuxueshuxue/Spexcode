import { useEffect, useState } from 'react'
import { loadPublicSpecContent, specUrl } from './data.js'

// Body content is shared by the full document, the node popup, and the selection layer so all three
// surfaces address the same fetched version.
const contentCache = new Map()

export function useSpecContent(id, version, { embedded = false, publicGraph = false } = {}) {
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
