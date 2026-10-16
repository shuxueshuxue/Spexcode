// The SpexCode tab for gugu ([[gugu-app]]). It shows the spec tree of the working copy of the session it sits beside —
// as `spex graph` assembles it, drift included — with the selected node's body and diagram, and it hands work to
// gugu: "start here" opens a new gugu session on the node, "cite" puts the node in this session's composer. It writes
// nothing itself. The tree comes from this App's own program (tools.js), because drift is a computation over git
// that a sandboxed page cannot make; bodies render with gugu's own markdown, diagrams with archify's renderer.
const { focusDiagram, scopeIds } = globalThis.SpexCodeAtlasFocus
const { ATLAS_PROMPT } = globalThis.SpexCodeAtlasPrompt
const $ = (id) => document.getElementById(id)

const WORDS = {
  en: {
    noHost: 'SpexCode runs inside gugu as an App.',
    noSession: 'Put this tab beside a task: it shows the spec tree of that task\'s working copy.',
    noRoot: 'This tab reads the task\'s working copy. Allow "read files" for SpexCode on the App page.',
    noTools: 'This tab reads the tree through SpexCode\'s own program. Allow "give agents its tools" for SpexCode on the App page.',
    noTree: 'This working copy has no spec tree yet. "Draw the atlas" starts a task that reads the repository into .spec/ and draws its pictures; this tab follows as it writes.',
    draw: 'Draw the atlas',
    reading: 'Reading the spec tree…',
    nodes: (n) => `${n} nodes`,
    drifted: (n) => `${n} drifted`,
    drift: (files) => `Drift: the code this spec governs changed after its last version${files.length ? ` — ${files.map((f) => `${f.file} (${f.behind} commit${f.behind === 1 ? '' : 's'})`).join(', ')}` : ''}.`,
    pending: 'A session has changed this spec and not landed it yet.',
    cite: 'Cite in this task',
    cited: 'Put in this task\'s composer.',
    askPlaceholder: 'What should a new task do on this node?',
    start: 'Start here',
    started: 'Started a new task on this node.',
    drawStarted: 'Started a task that draws the atlas.',
    needControl: 'Starting a task needs "start and steer agents" for SpexCode on the App page.',
    open: 'Open',
    diagramFailed: (path, why) => `${path} could not be drawn: ${why}`,
  },
  zh: {
    noHost: 'SpexCode 是咕咕里的 App,要在咕咕里打开。',
    noSession: '把这一格放在一条任务旁边:它显示那条任务工作副本里的规格树。',
    noRoot: '这一格要读任务的工作副本。请在「App」页给 SpexCode 打开「读文件」。',
    noTools: '这一格经 SpexCode 自带的程序读规格树。请在「App」页给 SpexCode 打开「给 agent 用它的工具」。',
    noTree: '这个工作副本还没有规格树。点「画规格图」会起一条任务,把仓库读成 .spec/ 并画图;它写的时候这一格跟着变。',
    draw: '画规格图',
    reading: '正在读规格树…',
    nodes: (n) => `${n} 个节点`,
    drifted: (n) => `${n} 个漂移`,
    drift: (files) => `漂移:这条规格管的代码在它最新一版之后改过${files.length ? `——${files.map((f) => `${f.file}(${f.behind} 个提交)`).join('、')}` : ''}。`,
    pending: '有会话改了这条规格,还没合进来。',
    cite: '引用到这条任务',
    cited: '已放进这条任务的输入框。',
    askPlaceholder: '新任务在这个节点上做什么?',
    start: '在这里开工',
    started: '已在这个节点上起了一条新任务。',
    drawStarted: '已起一条任务去画规格图。',
    needControl: '起任务要在「App」页给 SpexCode 打开「启动和操控 agent」。',
    open: '打开',
    diagramFailed: (path, why) => `${path} 画不出来:${why}`,
  },
}
let t = WORDS.en

let context = null
let renderDiagram = null
let markdown = null
let place = { session: null, root: null, project: null }
let tree = { byId: new Map(), roots: [] }
let current = null
let unwatch = null
let pendingLoad = null
let loadSeq = 0
const open = new Set()

const has = (capability) => Boolean(context?.capabilities?.includes(capability))

// Every failure is said where the person looks, and in the App's error log.
function fail(error) {
  const message = String(error?.message ?? error)
  $('error').textContent = message
  $('error').hidden = false
  void window.gugu.reportError(message)
}

async function call(tool, args) {
  const result = await window.gugu.callProgram(tool, args)
  const text = (result?.content ?? []).map((c) => c.text ?? '').join('')
  if (result?.isError) throw new Error(text || `${tool} failed`)
  return result.structuredContent ?? JSON.parse(text)
}

function showEmpty(message, withDraw = false) {
  $('atlas').hidden = true
  $('empty').hidden = false
  $('empty-text').textContent = message
  $('empty-draw').hidden = !withDraw
}

function buildTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    const parent = node.parent ? byId.get(node.parent) : null
    if (parent) parent.children.push(node.id)
    else roots.push(node.id)
  }
  return { byId, roots }
}

// One read at a time: a read takes seconds (npx + spex over git), so changes that arrive meanwhile mark the tree dirty
// and one more read follows, instead of several running side by side.
let loading = null
let dirty = false
function load() {
  if (loading) { dirty = true; return loading }
  loading = (async () => {
    do { dirty = false; await read() } while (dirty)
  })().finally(() => { loading = null })
  return loading
}

async function read() {
  const seq = ++loadSeq
  $('error').hidden = true
  if (!place.session) return showEmpty(t.noSession)
  if (!place.root) return showEmpty(t.noRoot)
  if (!has('agents:tools')) return showEmpty(t.noTools)
  if (!tree.byId.size) showEmpty(t.reading)
  let payload
  try {
    payload = await call('graph', { root: place.root })
  } catch (error) {
    if (seq !== loadSeq) return
    showEmpty(String(error?.message ?? error))
    void window.gugu.reportError(String(error?.message ?? error))
    return
  }
  if (seq !== loadSeq) return
  tree = buildTree(payload.nodes)
  if (!tree.roots.length) return showEmpty(t.noTree, true)
  $('empty').hidden = true
  $('atlas').hidden = false
  $('project').textContent = payload.title ?? ''
  const drifted = payload.nodes.filter((n) => n.status === 'drift').length
  $('tree-note').textContent = [t.nodes(tree.byId.size), drifted ? t.drifted(drifted) : ''].filter(Boolean).join(' · ')
  renderTree()
  await select(current && tree.byId.has(current) ? current : tree.roots[0], { keepScroll: true })
}

function renderTree() {
  const list = document.createElement('ul')
  for (const id of tree.roots) list.append(treeItem(id))
  $('tree').replaceChildren(list)
}

function treeItem(id) {
  const node = tree.byId.get(id)
  const item = document.createElement('li')
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'node-row'
  row.dataset.id = id
  if (id === current) row.setAttribute('aria-current', 'true')
  const twisty = document.createElement('span')
  twisty.className = 'twisty'
  twisty.textContent = node.children.length ? (open.has(id) ? '▾' : '▸') : ''
  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = node.title
  row.append(twisty, label)
  if (node.status === 'drift') row.append(mark('drift', 'drift'))
  else if (node.status === 'pending') row.append(mark('pending', 'pending'))
  if (node.diagram) row.append(mark('has-diagram', 'diagram'))
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

function mark(className, title) {
  const span = document.createElement('span')
  span.className = `mark ${className}`
  span.title = title
  return span
}

function toggle(id) {
  if (open.has(id)) open.delete(id)
  else open.add(id)
  renderTree()
}

// `[[node]]` mentions become in-page links; the renderer keeps `#…` links in place and this page follows them.
const withMentions = (body) => body.replace(/\[\[([^\]\n]+)\]\]/g, (whole, id) => {
  const node = tree.byId.get(id.trim())
  return node ? `[${node.title.replace(/[[\]]/g, '')}](#spec:${encodeURIComponent(node.id)})` : `\`${whole}\``
})

async function select(id, { keepScroll = false } = {}) {
  const node = tree.byId.get(id)
  if (!node) return
  current = id
  for (let up = node; up; up = up.parent ? tree.byId.get(up.parent) : null) open.add(up.id)
  renderTree()
  $('title').textContent = node.title
  $('desc').textContent = node.desc ?? ''
  $('code').textContent = (node.code ?? []).join(' · ')
  $('drift').hidden = node.status !== 'drift' && node.status !== 'pending'
  $('drift').textContent = node.status === 'drift' ? t.drift(node.driftFiles ?? []) : t.pending
  $('act-note').textContent = ''
  let read
  try {
    read = await call('node', { root: place.root, path: node.path })
  } catch (error) {
    fail(error)
    return
  }
  if (current !== id) return
  markdown.render($('body'), withMentions(read.body), { density: 'comfortable' })
  await drawDiagram(node, read.diagram)
  if (!keepScroll) $('document').scrollTop = 0
}

async function drawDiagram(node, text) {
  $('diagram').hidden = !text
  if (!text) return
  const box = $('diagram-box')
  $('diagram-note').textContent = ''
  try {
    const ir = JSON.parse(text)
    const parts = await renderDiagram(ir.diagram_type, ir, { evidence: false })
    box.innerHTML = scopeIds(parts.svg, `atlas-${node.id.replace(/[^\w-]/g, '')}`)
    $('diagram-note').textContent = typeof parts.meta?.note === 'string' ? parts.meta.note : ''
    const svg = box.querySelector('svg')
    const idOf = (event) => event.target.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
    svg?.addEventListener('click', (event) => focusDiagram(svg, idOf(event)))
    svg?.addEventListener('dblclick', (event) => {
      const child = idOf(event)
      if (child && node.children.includes(child)) void select(child)
    })
  } catch (error) {
    const lines = [t.diagramFailed(`${node.path.replace(/spec\.md$/, '')}diagram.json`, error?.message ?? error)]
    for (const d of error?.diagnostics ?? []) lines.push(`${d.code ? `${d.code}: ` : ''}${d.message}`)
    box.replaceChildren(Object.assign(document.createElement('pre'), { className: 'diagram-error', textContent: lines.join('\n') }))
  }
}

// A new task is a gugu session of its own, in this working copy's project; what it does is the person's words.
async function startTask(prompt, title, note) {
  if (!has('agents:control')) { $('act-note').textContent = t.needControl; return false }
  try {
    await window.gugu.spawnAgent(prompt, { title, project: place.project ?? place.root })
    $('act-note').textContent = note
    await paintAgents()
    return true
  } catch (error) {
    fail(error)
    return false
  }
}

async function startHere() {
  const node = tree.byId.get(current)
  const ask = $('ask').value.trim()
  if (!node || !ask) { $('ask').focus(); return }
  if (await startTask(`[[${node.id}]] ${ask}`, undefined, t.started)) $('ask').value = ''
}

async function cite() {
  const node = tree.byId.get(current)
  if (!node) return
  try {
    await window.gugu.compose(`[[${node.id}]] `, { session: place.session })
    $('act-note').textContent = t.cited
  } catch (error) {
    fail(error)
  }
}

const drawAtlas = () => startTask(ATLAS_PROMPT, 'SpexCode atlas', t.drawStarted)

// The tasks this App started, as gugu reports them (plain `agents:read` sees only those), each one click away.
async function paintAgents() {
  if (!has('agents:read')) return
  let agents
  try {
    agents = (await window.gugu.listAgents()).filter((a) => a.spawnedByThisExtension)
  } catch (error) {
    fail(error)
    return
  }
  const list = $('agents')
  list.hidden = !agents.length
  list.replaceChildren(...agents.slice(0, 8).map((agent) => {
    const li = document.createElement('li')
    const text = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = agent.title ?? agent.agentId
    const status = document.createElement('span')
    status.textContent = [agent.status, agent.detail].filter(Boolean).join(' · ')
    text.append(title, status)
    const go = document.createElement('button')
    go.type = 'button'
    go.textContent = t.open
    go.addEventListener('click', () => window.gugu.showSession(agent.sessionId).catch(fail))
    li.append(text, go)
    return li
  }))
}

function scheduleLoad() {
  clearTimeout(pendingLoad)
  pendingLoad = setTimeout(() => { pendingLoad = null; void load() }, 600)
}

// The session this tab sits beside: its working copy, its project, and the watch on that working copy's `.spec/`.
function bind(next) {
  const session = next.session ?? null
  if (session?.id === place.session && (session?.root ?? null) === place.root) return false
  unwatch?.()
  unwatch = null
  place = { session: session?.id ?? null, root: session?.root ?? null, project: session?.projectId ?? null }
  tree = { byId: new Map(), roots: [] }
  current = null
  open.clear()
  if (place.session && has('files:read')) {
    unwatch = window.gugu.files.onChanged({ session: place.session }, (change) => {
      if (change.kind === 'resync' || change.changes?.some((c) => c.path.startsWith('.spec/'))) scheduleLoad()
    })
  }
  return true
}

// A change brings what changed; the rest of the context stays as it was.
function applyContext(next) {
  context = { ...context, ...next }
  t = String(context.locale ?? '').toLowerCase().startsWith('zh') ? WORDS.zh : WORDS.en
  document.documentElement.lang = t === WORDS.zh ? 'zh-CN' : 'en'
  document.documentElement.style.colorScheme = context.themeMode === 'dark' ? 'dark' : 'light'
  $('empty-draw').textContent = t.draw
  $('cite').textContent = t.cite
  $('start').textContent = t.start
  $('ask').placeholder = t.askPlaceholder
  $('ask').setAttribute('aria-label', t.askPlaceholder)
}

document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href^="#spec:"]')
  if (!link) return
  event.preventDefault()
  void select(decodeURIComponent(link.getAttribute('href').slice('#spec:'.length)))
})
$('empty-draw').addEventListener('click', () => void drawAtlas())
$('cite').addEventListener('click', () => void cite())
$('start').addEventListener('click', () => void startHere())
$('ask').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.isComposing) void startHere() })

async function main() {
  if (!window.gugu) return showEmpty(WORDS.en.noHost)
  ;[{ renderDiagram }, markdown] = await Promise.all([import('./archify.mjs'), window.gugu.markdown()])
  applyContext(await window.gugu.getContext())
  bind(context)
  window.gugu.onContextChanged((next) => {
    applyContext(next)
    if (bind(context)) void load()
  })
  window.gugu.onCommand((id) => {
    if (id === 'draw') void drawAtlas()
    if (id === 'refresh') void load()
  })
  if (has('agents:read')) window.gugu.onAgentsChanged(() => void paintAgents())
  await Promise.all([load(), paintAgents()])
}

main().catch(fail)
