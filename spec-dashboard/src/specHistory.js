import { useEffect, useState } from 'react'
import { apiFetch, specUrl } from './data.js'

// A node's past, as three reads: its version log, the change one version made, and spec.md as one version
// left it. The popup's history pane, the context dock's history panel and the spec document's version face
// all read through here, so no two of them can hold a different idea of a node's history. It is its own light
// module because the dock mounts with the shell, and the shell must not pull the prose renderer in with it.

// a JSON read that refuses to turn a failure into data: a non-2xx answer throws the server's own sentence,
// so a caller shows "that failed" rather than an empty history or an empty diff that reads as the truth.
const readJson = (url) => apiFetch(url).then(async (response) => {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `${response.status} ${response.statusText}`)
  return body
})

// the node's version log from git (/api/specs/:id/history), newest first — or `{ error }` when it could not
// be read. `enabled` gates the fetch to a surface actually showing it (every popup open otherwise fires it for
// a tab most opens never visit); rows persist across tab switches, so only the FIRST visit loads. `stamp`
// (the node's version) re-reads the log when the node re-versions under a surface that stays mounted, and the
// rows are held against the id they belong to, so a surface that moves to another node never shows the
// previous node's log while the new one loads.
export function useHistory(id, enabled = true, stamp = null) {
  const [held, setHeld] = useState({ id: null, rows: null })
  useEffect(() => {
    if (!enabled) return undefined
    let on = true
    readJson(specUrl(id, 'history'))
      .then((rows) => { if (on) setHeld({ id, rows }) })
      .catch((error) => { if (on) setHeld({ id, rows: { error: error.message } }) })
    return () => { on = false }
  }, [id, enabled, stamp])
  return held.id === id ? held.rows : null
}

// A version is immutable, so both per-version reads are memoised per (id,hash) — re-opening one reads the
// cache with no refetch or flash. A failure is `{ error }` and is NOT cached, so the next open asks again.
function useImmutable(cache, id, hash, what, enabled) {
  const key = `${id}/${hash}`
  const [held, setHeld] = useState(() => ({ key, value: cache.get(key) ?? null }))
  useEffect(() => {
    if (!enabled) return undefined
    const hit = cache.get(key)
    if (hit) { setHeld({ key, value: hit }); return undefined }
    let on = true
    readJson(specUrl(id, what, hash))
      .then((value) => { cache.set(key, value); if (on) setHeld({ key, value }) })
      .catch((error) => { if (on) setHeld({ key, value: { error: error.message } }) })
    return () => { on = false }
  }, [cache, id, hash, what, enabled, key])
  return held.key === key ? held.value : null
}

// the spec.md line-diff one version introduced (/api/specs/:id/diff/:hash) — `{ hash, patch }`
const diffCache = new Map()
export const useVersionDiff = (id, hash, enabled = true) => useImmutable(diffCache, id, hash, 'diff', enabled)

// spec.md as one version left it (/api/specs/:id/version/:hash) — its title, desc, body and parts, with its
// place in the log and the commit that made it
const versionCache = new Map()
export const useSpecVersion = (id, hash, enabled = true) => useImmutable(versionCache, id, hash, 'version', enabled)
