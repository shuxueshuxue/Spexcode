import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from './data.js'

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

export function useReviewPage(domain, query, page, { enabled = true, refreshKey = null, pollMs = 15000 } = {}) {
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
    try {
      const response = await apiFetch(`/api/${domain}?${params}`)
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      if (mine === seq.current) setData(body)
      return body
    } catch (reason) {
      if (mine === seq.current) setError(reason instanceof Error ? reason.message : String(reason))
      return null
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [domain, enabled, page, query])

  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined }
    setData(null)
    load()
    const timer = pollMs > 0 ? setInterval(() => load({ quiet: true }), pollMs) : null
    return () => { if (timer) clearInterval(timer) }
  }, [enabled, load, pollMs, refreshKey])

  return { data, error, loading, reload: load }
}
