import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { loadSpecs, specHistory } from './specs.js'
import { resolveLayout } from './layout.js'

const app = new Hono()
app.use('/api/*', cors())

app.get('/', (c) => c.text('spec-cli — GET /api/specs · GET /api/specs/:id/history · GET /api/layout'))
app.get('/api/specs', (c) => c.json(loadSpecs()))
app.get('/api/specs/:id/history', (c) => c.json(specHistory(c.req.param('id'))))
app.get('/api/layout', (c) => c.json(resolveLayout()))

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`spec-cli serving .spec (from git) on http://localhost:${port}`)
