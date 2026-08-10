const env = import.meta.env ?? {}

export const PUBLIC_GRAPH_ONLY = env.VITE_PUBLIC_GRAPH_ONLY === '1'
export const PUBLIC_GRAPH_SOURCE = env.VITE_PUBLIC_GRAPH_SOURCE || '/public-graph.json'
export const PUBLIC_GRAPH_DOCUMENT_SOURCE = env.VITE_PUBLIC_GRAPH_DOCUMENT_SOURCE || '/specs'
