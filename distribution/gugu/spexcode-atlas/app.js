// The SpexCode Atlas tab for gugu ([[gugu-atlas-tab]]). It reads the workspace's spec tree through the host's
// workspace bridge, draws each node's diagram in the page with archify's own renderer, and starts an agent on the
// atlas when asked. It writes nothing itself: the agent writes, and the tab follows the files it changes.
;(() => {
const { buildTree, renderMarkdown, SPEC_ROOT } = globalThis.SpexCodeAtlasModel
const { focusDiagram, scopeIds } = globalThis.SpexCodeAtlasFocus
const { ATLAS_PROMPT } = globalThis.SpexCodeAtlasPrompt

const gugu = window.gugu
const $ = (id) => document.getElementById(id)
// A walk that stops somewhere says so; it never shows a partial tree as the whole one.
const WALK_LIMIT = 4000

let context = null
let tree = { byId: new Map(), roots: [] }
let current = null
let truncated = false
let pendingLoad = null
let renderDiagram = null
// The status line is an OBSERVATION, never a hope. Two independent sources feed it: a write under `.spec/`
// (something happened), and the agent's own status through the host (what the agent is doing). `null` from the
// host means "cannot be told" — an agent whose panel is closed, or a terminal agent — and is never read as "no".
let atlasAgentId = null
let sawAtlasWrite = false
const open = new Set()

const has = (capability) => Boolean(context?.capabilities?.includes(capability))

async function walk(dir, found) {
  if (found.count >= WALK_LIMIT) { truncated = true; return }
  let entries = []
  try { entries = await window.gugu.listFiles(dir) } catch { return }
  for (const entry of entries) {
    found.count += 1
    const name = entry.path.split('/').pop() || ''
    if (entry.kind === 'directory') await walk(entry.path, found)
    else if (name === 'spec.md') found.specs.push(entry.path)
    else if (name === 'diagram.json') found.diagrams.add(entry.path)
  }
}

async function load() {
  if (!has('workspace:read')) {
    showEmpty('This tab reads the workspace\'s .spec folder. Allow "read the workspace" for SpexCode Atlas in Settings → Extensions.')
    return
  }
  truncated = false
  const found = { specs: [], diagrams: new Set(), count: 0 }
  await walk(SPEC_ROOT, found)
  const files = await Promise.all(found.specs.map(async (path) => ({ path, text: await window.gugu.readFile(path) })))
  tree = buildTree(files, found.diagrams)
  if (!tree.roots.length) {
    showEmpty('This workspace has no spec tree yet. "Draw the atlas" starts an agent that reads the repository into .spec/ and draws its pictures; this tab follows along as it writes.')
    return
  }
  $('empty').hidden = true
  $('atlas').hidden = false
  const first = current && tree.byId.has(current) ? current : tree.roots[0]
  renderTree()
  await select(first)
}

function showEmpty(message) {
  $('atlas').hidden = true
  $('empty').hidden = false
  $('empty-text').textContent = message
}

function renderTree() {
  const list = document.createElement('ul')
  for (const id of tree.roots) list.append(treeItem(id))
  $('tree').replaceChildren(list)
  $('tree-note').textContent = truncated ? `Showing the first ${WALK_LIMIT} entries under .spec/.` : `${tree.byId.size} nodes`
}

function treeItem(id) {
  const node = tree.byId.get(id)
  const item = document.createElement('li')
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'row'
  row.dataset.id = id
  if (id === current) row.setAttribute('aria-current', 'true')
  const twisty = document.createElement('span')
  twisty.className = 'twisty'
  twisty.textContent = node.children.length ? (open.has(id) ? '▾' : '▸') : ''
  const label = document.createElement('span')
  label.textContent = node.title
  row.append(twisty, label)
  if (node.diagram) {
    const mark = document.createElement('span')
    mark.className = 'has-diagram'
    mark.title = 'has a diagram'
    row.append(mark)
  }
  row.addEventListener('click', () => {
    if (node.children.length && id === current) toggle(id)
    else void select(id)
  })
  item.append(row)
  if (node.children.length && open.has(id)) {
    const children = document.createElement('ul')
    for (const child of node.children) children.append(treeItem(child))
    item.append(children)
  }
  return item
}

function toggle(id) {
  if (open.has(id)) open.delete(id)
  else open.add(id)
  renderTree()
}

async function select(id) {
  const node = tree.byId.get(id)
  if (!node) return
  current = id
  for (let up = node; up; up = up.parent ? tree.byId.get(up.parent) : null) open.add(up.id)
  renderTree()
  $('title').textContent = node.title
  $('desc').textContent = node.desc
  $('code').textContent = node.code.length ? node.code.join(' · ') : ''
  $('body').innerHTML = renderMarkdown(node.body.replace(/^\s*#\s+[^\n]*\n/, ''), (mention) => tree.byId.has(mention))
  await drawDiagram(node)
  $('document').scrollTop = 0
}

async function drawDiagram(node) {
  const figure = $('diagram')
  figure.hidden = !node.diagram
  if (!node.diagram) return
  const box = $('diagram-box')
  const note = $('diagram-note')
  note.textContent = ''
  try {
    const ir = JSON.parse(await window.gugu.readFile(node.diagram))
    const parts = await renderDiagram(ir.diagram_type, ir, { evidence: false })
    box.innerHTML = scopeIds(parts.svg, `atlas-${node.id.replace(/[^\w-]/g, '')}`)
    note.textContent = typeof parts.meta?.note === 'string' ? parts.meta.note : ''
    wireDiagram(box.querySelector('svg'), node)
  } catch (error) {
    const lines = [`${node.diagram} could not be drawn: ${error?.message ?? error}`]
    for (const d of error?.diagnostics ?? []) lines.push(`${d.code ? `${d.code}: ` : ''}${d.message}`)
    box.replaceChildren(Object.assign(document.createElement('pre'), { className: 'diagram-error', textContent: lines.join('\n') }))
  }
}

function wireDiagram(svg, node) {
  if (!svg) return
  const idOf = (event) => event.target.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
  svg.addEventListener('click', (event) => focusDiagram(svg, idOf(event)))
  svg.addEventListener('dblclick', (event) => {
    const id = idOf(event)
    if (id && node.children.includes(id)) void select(id)
  })
}

async function drawAtlas() {
  if (!has('agents:control')) {
    await window.gugu.reportError('Starting the atlas needs the "start and steer agents" permission for SpexCode Atlas (Settings → Extensions).')
    return
  }
  try {
    // spawnAgent resolving means the HOST ACCEPTED THE REQUEST — not that an agent is drawing. An agent that
    // dies on its first breath (no credential, a refused model) resolves this call just the same. So say only
    // what was done, and let the agent's own status and the first write say the rest.
    const started = await window.gugu.spawnAgent(ATLAS_PROMPT, 'SpexCode atlas')
    atlasAgentId = started?.agentId ?? null
    sawAtlasWrite = false
    $('status').textContent = 'Asked the host to start the atlas agent. Nothing written yet.'
    await readAtlasAgent()
  } catch (error) {
    await window.gugu.reportError(`Could not start the atlas agent: ${error?.message ?? error}`)
  }
}

// What the host says about OUR agent, asked for by id. `status` is the field that separates a run that ended in
// an error from one that never started: `lastStopReason` cannot — the host projects an errored turn as `null`,
// the same `null` it uses for "no turn has ended yet" — so keying on it would write a branch that never runs.
async function readAtlasAgent() {
  if (!atlasAgentId || !has('agents:read')) { paintStatus(null); return }
  try {
    const agents = await window.gugu.listAgents()
    paintStatus((agents ?? []).find((a) => a.agentId === atlasAgentId) ?? null)
  } catch { paintStatus(null) }
}

function paintStatus(agent) {
  const status = agent?.status ?? null
  const generating = agent?.isGenerating ?? null
  if (sawAtlasWrite) {
    // It wrote. Whether it is STILL writing is the host's to say: an agent that wrote and exited reports
    // `completed`, and a tab that kept saying "is writing" would be back to announcing a state nobody is in.
    $('status').textContent = status === 'error'
      ? 'The atlas agent stopped with an error; what it wrote is below.'
      : status === 'completed'
        ? 'The atlas agent finished; its writes are below.'
        : 'The atlas agent is writing; this tab follows its changes.'
  } else if (status === 'error') {
    $('status').textContent = 'The atlas agent stopped with an error and wrote nothing.'
  } else if (status === 'completed') {
    $('status').textContent = 'The atlas agent finished without writing anything.'
  } else if (status === 'working' || generating === true) {
    $('status').textContent = 'The atlas agent is running; nothing written yet.'
  } else {
    // null / 'idle' / anything unrecognised: the host cannot tell us, so neither can this tab.
    $('status').textContent = 'Asked the host to start the atlas agent. Nothing written yet.'
  }
}

function applyTheme() {
  document.documentElement.style.colorScheme = context?.themeMode === 'dark' ? 'dark' : 'light'
}

function onFiles(change) {
  const touchesSpec = change.kind === 'resync' || change.changes?.some((entry) => entry.path.startsWith(`${SPEC_ROOT}/`))
  if (!touchesSpec) return
  // A write is a fact about files, not a guess about the agent: something under `.spec/` actually changed.
  if (atlasAgentId && !sawAtlasWrite) { sawAtlasWrite = true; void readAtlasAgent() }
  // An agent writing a tree saves many files in a burst; read once it settles.
  clearTimeout(pendingLoad)
  pendingLoad = setTimeout(() => { pendingLoad = null; void load() }, 600)
}

document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[data-node]')
  if (link) { event.preventDefault(); void select(link.dataset.node); return }
  const external = event.target.closest?.('a[data-external]')
  if (external) { event.preventDefault(); void window.gugu.openBrowserTab(external.href) }
})
$('draw').addEventListener('click', () => void drawAtlas())
$('empty-draw').addEventListener('click', () => void drawAtlas())

async function start() {
  if (!gugu) {
    showEmpty('SpexCode Atlas runs inside gugu as a tab extension.')
    return
  }
  ({ renderDiagram } = await import('./archify.mjs'))
  context = await window.gugu.getContext()
  applyTheme()
  window.gugu.onContextChanged((next) => { context = next; applyTheme() })
  window.gugu.onCommand((id) => { if (id === 'draw') void drawAtlas(); if (id === 'refresh') void load() })
  if (has('workspace:read')) window.gugu.onFilesChanged(onFiles)
  // Whether the AGENT moved is the host's to say, not something to infer from files. Ids only, by design.
  if (has('agents:read')) window.gugu.onAgentsChanged((agentIds) => {
    if (atlasAgentId && agentIds.includes(atlasAgentId)) void readAtlasAgent()
  })
  await load()
}

void start()
})()
