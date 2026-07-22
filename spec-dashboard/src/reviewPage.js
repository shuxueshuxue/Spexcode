import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from './data.js'

const inflightPages = new Map()

async function fetchReviewPage(path) {
  if (inflightPages.has(path)) return inflightPages.get(path)
  const request = apiFetch(path)
    .then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      return body
    })
    .finally(() => inflightPages.delete(path))
  inflightPages.set(path, request)
  return request
}

export const reviewPageNumber = (value) => {
  const raw = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 1
}

export function paginationTokens(page, pageCount) {
  if (pageCount <= 0) return []
  if (pageCount <= 10) return Array.from({ length: pageCount }, (_, index) => index + 1)
  if (page <= 7) return [...Array.from({ length: 8 }, (_, index) => index + 1), 'gap', pageCount - 1, pageCount]
  if (page >= pageCount - 6 || page > pageCount) {
    return [1, 2, 'gap', ...Array.from({ length: 8 }, (_, index) => pageCount - 7 + index)]
  }
  return [1, 2, 'gap', page - 2, page - 1, page, page + 1, page + 2, 'gap', pageCount - 1, pageCount]
}

export function useReviewPage(domain, query, page, { enabled = true, refreshKey = null, pollMs = 15000, view = null } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const seq = useRef(0)
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled) return null
    const mine = ++seq.current
    if (!quiet) setLoading(true)
    setError(null)
    const params = new URLSearchParams({ q: String(query || ''), page: String(page) })
    if (view) params.set('view', view)
    try {
      const body = await fetchReviewPage(`/api/${domain}?${params}`)
      // equal revision = the same source snapshot and slice ([[paged-review]]) — keep the current
      // object so a board-driven refresh of unchanged content repaints nothing.
      if (mine === seq.current) setData((prev) => prev && body && prev.revision === body.revision ? prev : body)
      return body
    } catch (reason) {
      if (mine === seq.current) setError(reason instanceof Error ? reason.message : String(reason))
      return null
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [domain, enabled, page, query, view])

  // Only a NEW request identity may wipe to the loading state; a refreshKey tick (a board frame) or a
  // re-enable of the same request refreshes quietly behind the painted rows — the reported "twitch" was
  // every SSE board delta re-running this effect and setData(null)-ing the visible list.
  const shownKey = useRef(null)
  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined }
    const requestKey = `${domain}\0${query}\0${page}\0${view || ''}`
    const fresh = requestKey !== shownKey.current
    shownKey.current = requestKey
    if (fresh) setData(null)
    load({ quiet: !fresh })
    const timer = pollMs > 0 ? setInterval(() => load({ quiet: true }), pollMs) : null
    return () => { if (timer) clearInterval(timer) }
  }, [domain, query, page, view, enabled, load, pollMs, refreshKey])

  return { data, error, loading, reload: load }
}
