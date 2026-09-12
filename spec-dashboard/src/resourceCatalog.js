import { resourceTabKey } from './sessionSurface.js'

// [[resource-picker]]'s catalog: one row per thing a session has published, built from the session projection
// alone, so the picker's list and a resource tab's label name the same resource the same way.

export const fileName = (path) => path.split('/').filter(Boolean).pop() || path

export const webName = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^\[|\]$/g, '')}:${parsed.port}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch { return url }
}

// The filter vocabulary is closed: a file whose extension is on none of these lists is still listed, under
// All, but never mints a chip of its own.
export const RESOURCE_TYPES = [
  { id: 'html', extensions: ['html', 'htm'] },
  { id: 'pdf', extensions: ['pdf'] },
  { id: 'markdown', extensions: ['md', 'markdown'] },
  { id: 'image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] },
  { id: 'text', extensions: ['txt', 'log'] },
  { id: 'json', extensions: ['json', 'jsonl'] },
  { id: 'csv', extensions: ['csv', 'tsv'] },
  { id: 'video', extensions: ['mp4', 'webm', 'mov'] },
  { id: 'archive', extensions: ['zip', 'tar', 'gz', 'tgz'] },
  { id: 'web', extensions: [] },
]

const TYPE_OF_EXTENSION = new Map(RESOURCE_TYPES.flatMap((type) => type.extensions.map((extension) => [extension, type.id])))

export const fileType = (name) => TYPE_OF_EXTENSION.get(name.toLowerCase().match(/\.([^./]+)$/)?.[1]) || null

const parentName = (path) => path.split('/').filter(Boolean).slice(-2, -1)[0] || ''

// Newest first within each kind: a list is appended to as work goes on, and the latest handoff is the one a
// reader opens the picker for. A row names its folder only when another posted file shares its name — the
// rest of the path stays behind the copy tool.
export function resourceCatalog(session) {
  if (!session) return []
  const uploads = new Map((session.uploadedFiles || []).map((upload) => [upload.path, upload]))
  const labelled = (session.files || []).map((path) => ({ path, upload: uploads.get(path), label: uploads.get(path)?.name || fileName(path) }))
  const named = new Map()
  for (const { label } of labelled) named.set(label, (named.get(label) || 0) + 1)
  const files = labelled.map(({ path, upload, label }) => ({
    id: resourceTabKey(session.id, 'file', path), sessionId: session.id, kind: 'file', value: path, label,
    type: fileType(label), folder: !upload && named.get(label) > 1 ? parentName(path) : '',
    uploadedAt: upload?.uploadedAt ?? null, revision: 0,
  }))
  const webs = (session.web || []).map((web) => ({
    id: resourceTabKey(session.id, 'web', web.key), sessionId: session.id, kind: 'web', key: web.key, value: web.url,
    label: webName(web.url), type: 'web', folder: '', uploadedAt: null, revision: 0,
  }))
  return [...files.reverse(), ...webs.reverse()]
}

export const UPLOADED_FILTER = 'uploaded'
export const ALL_FILTER = 'all'

// The chips a list can be cut by: All, then each known type the list actually holds (in the fixed order above,
// so a chip never moves because a count changed), then the human's own uploads when there are any.
export function resourceFilters(entries) {
  const counts = new Map()
  for (const entry of entries) if (entry.type) counts.set(entry.type, (counts.get(entry.type) || 0) + 1)
  const uploaded = entries.filter((entry) => entry.uploadedAt != null).length
  return [
    { id: ALL_FILTER, count: entries.length },
    ...RESOURCE_TYPES.filter((type) => counts.has(type.id)).map((type) => ({ id: type.id, count: counts.get(type.id) })),
    ...(uploaded ? [{ id: UPLOADED_FILTER, count: uploaded }] : []),
  ]
}

export function matchResources(entries, { filter = ALL_FILTER, query = '' } = {}) {
  const needle = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filter === UPLOADED_FILTER ? entry.uploadedAt == null : filter !== ALL_FILTER && entry.type !== filter) return false
    return !needle || entry.label.toLowerCase().includes(needle)
  })
}
