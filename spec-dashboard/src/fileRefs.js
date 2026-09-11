import { createContext } from 'react'
import { sessionSurfaceAddress } from './address.js'
import { resourceSurface, resourceTabKey } from './sessionSurface.js'
import { apiUrl } from './project.js'

// `[[file:<name>]]` — a file its session posted ([[files]]), named by its file name or by any trailing part of
// its path that no other posted file shares. The CLI prints the exact reference when the file is posted.
export const FILE_REF_RE = /\[\[file:([^\]\n]+)\]\]/g

// A reference resolves only when exactly one posted path answers to it; an ambiguous or unknown name is the
// caller's to show as unresolved, never a guess at which file was meant.
export function resolveFileRef(name, paths = []) {
  const wanted = String(name).trim()
  if (!wanted) return { path: null, matches: 0 }
  const hits = paths.filter((path) => path === wanted || path.endsWith(`/${wanted.replace(/^\/+/, '')}`))
  return { path: hits.length === 1 ? hits[0] : null, matches: hits.length }
}

// Opening a posted file is an ordinary navigation to its resource address ([[resource-tabs]]) — the same tab
// the session's files menu opens.
export const fileRefAddress = (sessionId, path) => sessionSurfaceAddress(sessionId, resourceSurface(resourceTabKey(sessionId, 'file', path)))
// A face with no resource tabs (the phone) opens the file's own preview page instead — the same bytes the tab shows.
export const filePreviewUrl = (sessionId, path) => apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/files/download?path=${encodeURIComponent(path)}&preview=1`)

// The session whose text is being read, what it has posted, and whether this face has resource tabs to open
// a file in: the conversation provides it, so a reference in any prose it renders resolves against that list.
export const SessionFilesContext = createContext(null)
