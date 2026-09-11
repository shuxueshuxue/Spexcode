// The tab's reading of a workspace's spec tree ([[gugu-atlas-tab]]): pure functions over the files gugu hands the
// page, so the whole reading is testable without a host. A node is a folder under .spec/ holding a spec.md; its id
// is the folder's name; the tree is the folder tree. This is a reader, not SpexCode's assembly — no drift, no lint.

const SPEC_ROOT = '.spec'
// SpexCode's own seeded machinery (skills, hooks) lives here in an adopted repository; it is not the project.
const MACHINERY = '.plugins'

// The frontmatter subset spec files use: `key: value` scalars and `key:` followed by `  - item` lists.
function parseSpec(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { fm: {}, body: text }
  const fm = {}
  let list = null
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && list) { fm[list].push(unquote(item[1])); continue }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    if (pair[2] === '') { list = pair[1]; fm[list] = []; continue }
    list = null
    fm[pair[1]] = unquote(pair[2])
  }
  return { fm, body: match[2] }
}
const unquote = (value) => {
  const v = value.trim()
  return (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1) : v
}

// files: [{ path, text }] for every `.spec/**/spec.md`; diagrams: the set of `.spec/**/diagram.json` paths.
// Returns the nodes by id plus the roots, children in folder-name order.
function buildTree(files, diagrams = new Set()) {
  const byPath = new Map()
  for (const { path, text } of files) {
    const dir = path.slice(0, -'/spec.md'.length)
    const segments = dir.split('/')
    if (segments[0] !== SPEC_ROOT || segments.includes(MACHINERY)) continue
    const { fm, body } = parseSpec(text)
    const id = segments[segments.length - 1]
    byPath.set(dir, {
      id,
      dir,
      title: typeof fm.title === 'string' && fm.title ? fm.title : id,
      desc: typeof fm.desc === 'string' ? fm.desc : '',
      code: Array.isArray(fm.code) ? fm.code : [],
      related: Array.isArray(fm.related) ? fm.related : [],
      body,
      diagram: diagrams.has(`${dir}/diagram.json`) ? `${dir}/diagram.json` : null,
      parent: null,
      children: [],
    })
  }
  const roots = []
  for (const node of [...byPath.values()].sort((a, b) => a.dir.localeCompare(b.dir))) {
    let up = node.dir.slice(0, node.dir.lastIndexOf('/'))
    while (up.includes('/') && !byPath.has(up)) up = up.slice(0, up.lastIndexOf('/'))
    const parent = byPath.get(up)
    if (parent) { node.parent = parent.id; parent.children.push(node.id) } else roots.push(node.id)
  }
  const byId = new Map([...byPath.values()].map((node) => [node.id, node]))
  return { byId, roots }
}

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
// A marker no escaped text contains, so inline code is set aside before the other inline rules run over the line.
const HOLD = String.fromCharCode(1)
const HELD = new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g')

function inline(text, known) {
  const codes = []
  const html = escapeHtml(text.replaceAll(HOLD, ''))
    .replace(/`([^`]+)`/g, (_, code) => `${HOLD}${codes.push(code) - 1}${HOLD}`)
    .replace(/\[\[([^\]]+)\]\]/g, (_, id) => known(id) ? `<a href="#" data-node="${id}">${id}</a>` : `<span class="missing">${id}</span>`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-external="true">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  return html.replace(HELD, (_, i) => `<code>${codes[Number(i)]}</code>`)
}

// The body markdown spec files are written in: headings, paragraphs, lists, block quotes, fenced code, and inline
// code, emphasis, links and [[node]] mentions. Everything is escaped first; nothing in a body becomes markup of its own.
function renderMarkdown(markdown, known = () => false) {
  const out = []
  const lines = markdown.split(/\r?\n/)
  let paragraph = []
  let list = null
  const endParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '), known)}</p>`)
    paragraph = []
  }
  const flush = () => {
    endParagraph()
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) {
      flush()
      const code = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i])
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) { flush(); out.push(`<h${heading[1].length}>${inline(heading[2], known)}</h${heading[1].length}>`); continue }
    const bullet = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line)
    if (bullet) {
      const kind = bullet[1] ? 'ol' : 'ul'
      endParagraph()
      if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind }
      out.push(`<li>${inline(bullet[2], known)}</li>`)
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) { flush(); out.push(`<blockquote>${inline(quote[1], known)}</blockquote>`); continue }
    if (!line.trim()) { flush(); continue }
    if (list && /^\s{2,}\S/.test(line)) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim(), known)}</li>`); continue }
    if (list) { out.push(`</${list}>`); list = null }
    paragraph.push(line.trim())
  }
  flush()
  return out.join('\n')
}

globalThis.SpexCodeAtlasModel = { SPEC_ROOT, parseSpec, buildTree, renderMarkdown }
