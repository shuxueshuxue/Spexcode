// The project-scope seam ([[dashboard-shell]] / [[projects-hub]]): under the multi-project gateway the
// SAME built SPA is served at two kinds of address — the hub root `/` and the project-scoped
// `/p/<projectId>/` — and every backend surface of a scoped page sits under that same prefix
// (`/p/<id>/api/graph`, the terminal WebSocket, the SSE stream). The scope is read ONCE from
// location.pathname at boot and every `/api` URL routes through apiUrl(), so no feature module knows
// whether it is running scoped or not — the pathname is the whole contract, which is also what makes a
// scoped page shareable: the address bar IS the project-scoped URL, and the gateway can gate it by path.
// Outside the gateway (vite dev, a single-project `spex serve ui`) the pathname has no /p/ prefix, the
// base is '' and every URL is byte-identical to the pre-multi-project app.

// '/p/<id>' or '/p/<id>/anything' → that id; anything else → null. The id segment is URI-decoded for
// display/API use; the RAW segment is kept for prefix building so the base always matches the address
// the page was actually served under.
export function parseProjectPath(pathname) {
  const m = /^\/p\/([^/]+)(?:\/|$)/.exec(pathname || '')
  if (!m) return { id: null, base: '' }
  let id = m[1]
  try { id = decodeURIComponent(id) } catch { /* malformed escape — use the raw segment */ }
  return { id, base: `/p/${m[1]}` }
}

const scope = parseProjectPath(typeof location !== 'undefined' ? location.pathname : '')

// the current project scope: null/'' at the hub root (and in every pre-gateway serving mode).
export const PROJECT_ID = scope.id
export const PROJECT_BASE = scope.base

// the ONE URL builder every backend call routes through: `/api/...` paths get the scope prefix; anything
// else (the root-scoped /projects catalog, an absolute URL) passes through untouched. Exported as a pure
// function of (path, base) underneath so it is testable; the app-facing form closes over the live scope.
export const scopedApiUrl = (path, base) => (path.startsWith('/api') ? base + path : path)
export const apiUrl = (path) => scopedApiUrl(path, PROJECT_BASE)

// hash-preserving addresses for cross-scope navigation (the selector, the hub's Open action). The id is
// encoded per-segment so a path-derived id with awkward chars survives the address bar.
export const projectHref = (id, hash = '#/graph') => `/p/${encodeURIComponent(id)}/${hash}`
export const hubHref = (hash = '#/projects') => `/${hash}`
