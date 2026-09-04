// The project-scope seam ([[dashboard-shell]] / [[projects-hub]]): under the multi-project gateway the
// SAME built SPA is served at two kinds of address — the hub root `/` and the project-scoped
// `/p/<projectId>/` — and every backend surface of a scoped page sits under that same prefix
// (`/p/<id>/api/graph`, the terminal WebSocket, the SSE stream). The scope is read ONCE from
// location.pathname at boot and every `/api` URL routes through apiUrl(), so no feature module knows
// whether it is running scoped or not — the pathname is the whole contract, which is also what makes a
// scoped page shareable: the address bar IS the project-scoped URL, and the gateway can gate it by path.
// Outside the gateway (vite dev, a single-project `spex serve ui`) the pathname has no /p/ prefix, the
// base is '' and every URL is byte-identical to the pre-multi-project app.

// '/p/<id>' or '/p/<id>/anything' → that id; anything else → null, optionally behind a machine segment
// ('/m/<machineId>/p/<id>/…' — [[machine-routing]]). Segments are URI-decoded for display/API use; the RAW
// segments are kept for prefix building so the base always matches the address the page was actually served
// under. The machine prefix needs no other module to know it exists: it simply becomes part of the base, and
// every `/api` call, terminal socket and SSE stream a scoped page makes rides the same prefix it was served
// under — which is the whole reason the machine dimension lives in the ADDRESS rather than in a client.
const decodeSegment = (raw) => {
  try { return decodeURIComponent(raw) } catch { return raw } // malformed escape — use the raw segment
}
export function parseProjectPath(pathname) {
  const m = /^(?:\/m\/([^/]+))?\/p\/([^/]+)(?:\/|$)/.exec(pathname || '')
  if (!m) return { machineId: null, id: null, base: '' }
  const machinePrefix = m[1] ? `/m/${m[1]}` : ''
  return {
    machineId: m[1] ? decodeSegment(m[1]) : null,
    id: decodeSegment(m[2]),
    base: `${machinePrefix}/p/${m[2]}`,
  }
}

const scope = parseProjectPath(typeof location !== 'undefined' ? location.pathname : '')

// the current project scope: null/'' at the hub root (and in every pre-gateway serving mode).
export const PROJECT_ID = scope.id
export const PROJECT_BASE = scope.base
// the machine this page's project lives on, or null for the bare form — which permanently means THIS
// machine. A remote scope is not a different app: it is this app at a deeper prefix.
export const PROJECT_MACHINE_ID = scope.machineId

// the ONE URL builder every backend call routes through: `/api/...` paths get the scope prefix; anything
// else (the root-scoped /projects catalog, an absolute URL) passes through untouched. Exported as a pure
// function of (path, base) underneath so it is testable; the app-facing form closes over the live scope.
export const scopedApiUrl = (path, base) => (path.startsWith('/api') ? base + path : path)
export const apiUrl = (path) => scopedApiUrl(path, PROJECT_BASE)

// Hash-preserving project addresses for cross-scope navigation (the selector, the hub's Open action).
// The id is encoded per-segment so a path-derived id with awkward chars survives the address bar. The
// hub itself is one global pathname, never an in-shell hash route.
export const projectHref = (id, hash = '#/graph', machineId = null) =>
  `${machineId ? `/m/${encodeURIComponent(machineId)}` : ''}/p/${encodeURIComponent(id)}/${hash}`
export const hubHref = () => '/projects'

// The retired scoped admin route crosses from a project pathname into the global hub. Resolve it before
// React mounts so arrival performs one full-page navigation and can never paint a duplicate admin page.
export function legacyProjectsRedirect(pathname, hash) {
  if (!parseProjectPath(pathname).id) return null
  const path = (hash || '').replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '')
  return path === 'projects' ? hubHref() : null
}
