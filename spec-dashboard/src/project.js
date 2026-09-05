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

// THE SAME SEAM FOR BROWSER-LOCAL STATE. localStorage and sessionStorage are keyed by ORIGIN, and one
// origin serves many trees — the gateway's `/p/<id>` projects, and a gallery's several published trees under
// a single domain. So a bare key does not name one tree's state, it names a bucket every tree on that host
// writes to. State that is an ADDRESS or an IDENTIFIER inside a tree (an open tab list of session ids, an
// explorer ledger of node ids and disk paths, a focused node) therefore has to carry the scope, or opening a
// document in one tree silently opens it in the next and closing it there closes it here. A genuine
// PREFERENCE — theme, language, keybindings, band widths, font size — belongs to the READER and not to any
// tree, and stays unscoped on purpose.
//
// The scope is the DIRECTORY THE PAGE WAS SERVED FROM, for the same reason that directory is already the API
// prefix: it is the address the page actually arrived at, so it separates every tree a host can serve rather
// than only the ones wearing a `/p/<id>` prefix. Deriving it from the project id instead leaves a gallery of
// published trees — no `/p/` anywhere, `PROJECT_ID` null in all of them — sharing one bucket, which is
// measurable as a `requests` tab appearing on the vConsole page. An unscoped serving mode (vite dev, a
// single-project `spex serve ui`, a root deployment) resolves to the one 'root' scope, which is the suffix
// the app already used before this seam was named.
const servingScope = (pathname) => {
  const dir = (pathname || '/').replace(/[^/]*$/, '')
  return dir === '/' ? 'root' : dir.replace(/^\/|\/$/g, '')
}
export const STORAGE_SCOPE = servingScope(typeof location !== 'undefined' ? location.pathname : '/')
export const scopedKey = (name, scope = STORAGE_SCOPE) => `${name}.${scope}`

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
