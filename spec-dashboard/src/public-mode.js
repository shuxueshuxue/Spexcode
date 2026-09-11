const env = import.meta.env ?? {}

export const PUBLIC_GRAPH_ONLY = env.VITE_PUBLIC_GRAPH_ONLY === '1'
// @@@ relative by default - a published graph is a DIRECTORY, and a directory that resolves its own payload
// from the domain root can only ever be served at `/`. Relative sources cost the root-served host nothing —
// the page is at `/`, so `./public-graph.json` IS `/public-graph.json` — while making a path-routed host
// (a gallery carrying many flats at /<owner>/<repo>/) possible at all. The one requirement they add is a
// trailing slash on the directory URL: at `/a/b` (no slash) the browser resolves `./x` against `/a/`, so a
// host serving these must redirect a directory to its slashed form, which is ordinary static-host behaviour.
export const PUBLIC_GRAPH_SOURCE = env.VITE_PUBLIC_GRAPH_SOURCE || './public-graph.json'
export const PUBLIC_GRAPH_DOCUMENT_SOURCE = env.VITE_PUBLIC_GRAPH_DOCUMENT_SOURCE || './specs'
export const PUBLIC_GRAPH_METADATA_SOURCE = env.VITE_PUBLIC_GRAPH_METADATA_SOURCE || './public-graph-meta.json'

// @@@ embedded payload - a single-file page (`spex graph --public --html`) carries its index, metadata and
// documents inside itself, because the place it is opened from may be a disk path where a browser refuses to
// fetch a sibling file. Its presence is a property of the PAGE, read once: every public reader asks this
// first and falls through to its relative source only when the page carries nothing.
export const PUBLIC_PAYLOAD_ELEMENT_ID = 'spexcode-public-payload'
let embedded
export function embeddedPublicPayload() {
  if (embedded !== undefined) return embedded
  const element = typeof document === 'undefined' ? null : document.getElementById(PUBLIC_PAYLOAD_ELEMENT_ID)
  embedded = element ? JSON.parse(element.textContent) : null
  return embedded
}
