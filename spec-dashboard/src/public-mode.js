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
