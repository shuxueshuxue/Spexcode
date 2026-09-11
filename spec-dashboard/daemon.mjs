// The server runtime `spex serve` imports: re-exported from the package that carries it. Whoever serves the
// dashboard installs this package, so a CLI-only install (lint, diagrams, the public page) stays without an
// HTTP server or a native addon. Importing through this file resolves each dependency from this package's own
// tree, which holds in every install layout (global, project-local, workspace).
export { Hono } from 'hono'
export { cors } from 'hono/cors'
export { etag } from 'hono/etag'
export { streamSSE } from 'hono/streaming'
export { serve } from '@hono/node-server'
export { createNodeWebSocket } from '@hono/node-ws'
