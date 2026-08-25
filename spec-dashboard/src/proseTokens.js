import MarkdownIt from 'markdown-it'
import katex from 'katex'

// This module owns the parser boundary for dashboard prose. Consumers receive markdown-it tokens with
// source maps intact; they do not receive pre-rendered HTML. KaTeX is the only renderer allowed to inject
// audited HTML, and it does so only when a math token is mapped.

const MATH_OPTIONS = Object.freeze({ throwOnError: false, strict: 'ignore' })

const isEscaped = (source, index) => {
  let slashes = 0
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) slashes += 1
  return slashes % 2 === 1
}

const findInlineClose = (source, start, close) => {
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '\n' || source[i] === '`') return -1
    if (!source.startsWith(close, i) || isEscaped(source, i)) continue
    if (close === '$' && (source[i + 1] === '$' || /\d/.test(source[i + 1] || ''))) continue
    return i
  }
  return -1
}

const hashFromUrl = (value) => {
  const match = /^\/api\/(?:evidence|yatsu\/blob)\/([0-9a-f]{64})$/i.exec(String(value || ''))
  return match?.[1] || null
}

const mathPlugin = (md) => {
  md.inline.ruler.before('escape', 'prose_math_inline', (state, silent) => {
    const start = state.pos
    let open = null
    let close = null
    if (state.src[start] === '$' && state.src[start + 1] !== '$'
      && state.src[start - 1] !== '$' && !isEscaped(state.src, start)) {
      open = '$'; close = '$'
    } else if (state.src.startsWith('\\(', start) && !isEscaped(state.src, start)) {
      open = '\\('; close = '\\)'
    }
    if (!open || /\s/.test(state.src[start + open.length] || '')) return false
    const end = findInlineClose(state.src, start + open.length, close)
    if (end < 0 || /\s/.test(state.src[end - 1] || '')) return false
    if (!silent) {
      const token = state.push('prose_math_inline', 'math', 0)
      token.content = state.src.slice(start + open.length, end)
      token.markup = open
    }
    state.pos = end + close.length
    return true
  })

  md.block.ruler.after('blockquote', 'prose_math_block', (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const firstEnd = state.eMarks[startLine]
    const open = state.src.startsWith('$$', start) ? '$$'
      : state.src.startsWith('\\[', start) ? '\\[' : null
    if (!open) return false
    const close = open === '$$' ? '$$' : '\\]'
    const lines = [state.src.slice(start + open.length, firstEnd)]
    let closeLine = -1
    for (let line = startLine; line < endLine; line += 1) {
      const value = line === startLine
        ? lines[0]
        : state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
      const closeAt = value.lastIndexOf(close)
      if (closeAt >= 0 && !isEscaped(value, closeAt)
        && value.slice(closeAt + close.length).trim() === '') {
        if (line === startLine) lines[0] = value.slice(0, closeAt)
        else lines.push(value.slice(0, closeAt))
        closeLine = line
        break
      }
      if (line !== startLine) lines.push(value)
    }
    const content = lines.join('\n').trim()
    if (closeLine < 0 || !content) return false
    if (silent) return true
    const token = state.push('prose_math_block', 'math', 0)
    token.block = true
    token.content = content
    token.map = [startLine, closeLine + 1]
    token.markup = open
    state.line = closeLine + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}

const semanticPlugin = (md) => {
  md.inline.ruler.before('link', 'prose_evidence', (state, silent) => {
    const rest = state.src.slice(state.pos)
    const match = /^!\[([^\]]*)\]\((\/api\/(?:evidence|yatsu\/blob)\/[0-9a-f]{64})(?:\s+["']([^"']*)["'])?\)/i.exec(rest)
    if (!match) return false
    if (!silent) {
      const token = state.push('prose_evidence', 'a', 0)
      token.content = match[1]
      token.meta = { hash: hashFromUrl(match[2]), src: match[2], alt: match[1], title: match[3] || null }
    }
    state.pos += match[0].length
    return true
  })

  md.inline.ruler.before('text', 'prose_spec_ref', (state, silent) => {
    if (!state.src.startsWith('[[', state.pos)) return false
    const end = state.src.indexOf(']]', state.pos + 2)
    if (end < 0 || end === state.pos + 2 || state.src.slice(state.pos + 2, end).includes('\n')) return false
    if (!silent) {
      const id = state.src.slice(state.pos + 2, end)
      const token = state.push('prose_spec_ref', 'a', 0)
      token.content = id
      token.meta = { id }
    }
    state.pos = end + 2
    return true
  })

  md.block.ruler.before('paragraph', 'prose_time_anchor', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const end = state.eMarks[startLine]
    const line = state.src.slice(start, end).trim()
    const match = /^▶\s*(\d+):([0-5]?\d)(?:\s*·\s*([^\n]*))?$/.exec(line)
    if (!match) return false
    if (silent) return true
    const token = state.push('prose_time_anchor', 'span', 0)
    token.block = true
    token.content = line
    token.map = [startLine, startLine + 1]
    token.meta = {
      tMs: (Number(match[1]) * 60 + Number(match[2])) * 1000,
      step: match[3]?.trim() || null,
      label: line,
    }
    state.line = startLine + 1
    return true
  })
}

const markdown = new MarkdownIt({ linkify: true, html: false })
  .use(mathPlugin)
  .use(semanticPlugin)

const inheritInlineMaps = (tokens) => {
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.children || !token.map) continue
    for (const child of token.children) if (!child.map) child.map = [...token.map]
  }
  return tokens
}

/** Parse source into the sole shared prose token stream. Maps stay zero-based, as markdown-it emits them. */
export function parseProseTokens(source) {
  const value = source == null ? '' : String(source)
  return inheritInlineMaps(markdown.parse(value, {}))
}

/** Remove the caller-owned document title while reporting how many source lines were consumed. */
export function stripProseTitle(source) {
  const value = source == null ? '' : String(source)
  const match = /^#\s+[^\n]*(?:\n+|$)/.exec(value)
  if (!match) return { source: value, removedLines: 0 }
  const removedLines = match[0].endsWith('\n') ? match[0].split('\n').length - 1 : 1
  return { source: value.slice(match[0].length), removedLines }
}

const safeUrl = (value) => /^(?:https?:|mailto:|#|\/)/i.test(String(value || '')) ? String(value) : null

const attrs = (token, lineBase) => {
  const map = token?.map
  if (!map || !Number.isInteger(lineBase) || lineBase <= 0) return {}
  return { 'data-l0': lineBase + map[0], 'data-l1': lineBase + map[1] - 1 }
}

const attr = (token, name) => token?.attrGet?.(name) ?? null

// markdown-it table alignment is emitted as a CSS declaration string (`text-align:center`). React's
// `style` prop is deliberately stricter: passing that string works in development with a warning but throws
// minified error #62 in production. Keep the parser boundary responsible for translating the tiny inline
// style vocabulary instead of leaking a DOM/CSS representation into every prose consumer.
const reactStyle = (value) => {
  if (!value) return undefined
  const result = {}
  for (const declaration of String(value).split(';')) {
    const i = declaration.indexOf(':')
    if (i < 0) continue
    const rawName = declaration.slice(0, i).trim()
    const rawValue = declaration.slice(i + 1).trim()
    if (!rawName || !rawValue) continue
    const name = rawName.startsWith('--')
      ? rawName
      : rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    result[name] = rawValue
  }
  return Object.keys(result).length ? result : undefined
}

// @@@math typesetting cache - KaTeX is the one expensive step here and a pure function of (source, mode).
// Mapping runs on every re-render (see Prose.js), so without this a new timeline message re-typesets every
// formula already on screen. `null` records a source KaTeX rejected, so a bad formula is not retried either.
const MATH_CACHE = new Map()
const MATH_CACHE_MAX = 512

const renderMath = (source, display) => {
  const key = `${display ? 'd' : 'i'}\u0000${source}`
  if (MATH_CACHE.has(key)) return MATH_CACHE.get(key)
  let html = null
  try {
    html = katex.renderToString(source, { ...MATH_OPTIONS, displayMode: display })
  } catch {
    html = null
  }
  if (MATH_CACHE.size >= MATH_CACHE_MAX) MATH_CACHE.clear()
  MATH_CACHE.set(key, html)
  return html
}

const mathElement = (h, token, display, lineAttrs = {}) => {
  const html = renderMath(token.content, display)
  if (html === null) return h(display ? 'pre' : 'span', { ...lineAttrs, className: 'doc-math-error' }, token.content)
  return h(display ? 'div' : 'span', {
    ...lineAttrs,
    className: display ? 'doc-math-block' : 'doc-math',
    'data-math-source': token.content,
    dangerouslySetInnerHTML: { __html: html },
  })
}

const inlineElement = (h, token, children, options) => {
  const lineAttrs = attrs(token, options.lineBase)
  if (token.type === 'link_open') {
    const href = safeUrl(attr(token, 'href'))
    return href ? h('a', { ...lineAttrs, className: 'doc-link doc-external', href, target: '_blank', rel: 'noreferrer' }, children) : children
  }
  if (token.type === 'strong_open') return h('strong', lineAttrs, children)
  if (token.type === 'em_open') return h('em', lineAttrs, children)
  if (token.type === 's_open') return h('del', lineAttrs, children)
  return children
}

const renderInline = (h, children = [], options) => {
  const root = []
  const stack = [{ token: null, children: root }]
  const current = () => stack[stack.length - 1].children
  for (const token of children) {
    if (token.type === 'text') current().push(token.content)
    // @@@two kinds of newline - a hard break (trailing spaces or backslash) is authored content and always
    // breaks. A soft break is only where the author's line ended; whether that is a break is the surface's
    // call, not the parser's, so `softBreak` decides and documents reflow by default, as Markdown specifies.
    else if (token.type === 'hardbreak') current().push(h('br'))
    else if (token.type === 'softbreak') current().push(options.softBreak === 'break' ? h('br') : ' ')
    else if (token.type === 'code_inline') current().push(h('code', attrs(token, options.lineBase), token.content))
    else if (token.type === 'prose_math_inline') current().push(mathElement(h, token, false, attrs(token, options.lineBase)))
    else if (token.type === 'prose_spec_ref') {
      const value = options.renderSpecRef?.(token.meta.id, token, attrs(token, options.lineBase))
      current().push(value ?? h('span', { ...attrs(token, options.lineBase), className: 'doc-ref', 'data-spec-id': token.meta.id }, token.meta.id))
    } else if (token.type === 'prose_evidence') {
      const value = options.renderEvidence?.(token.meta, token, attrs(token, options.lineBase))
      current().push(value ?? h('a', { ...attrs(token, options.lineBase), className: 'doc-evidence', href: token.meta.src, 'data-evidence-hash': token.meta.hash }, token.meta.alt))
    } else if (token.type === 'image') {
      const src = safeUrl(attr(token, 'src'))
      current().push(src ? h('img', { ...attrs(token, options.lineBase), className: 'doc-image', src, alt: token.content || attr(token, 'alt') || '', title: attr(token, 'title') || undefined }) : token.content)
    } else if (token.type === 'link_open' || token.type === 'strong_open' || token.type === 'em_open' || token.type === 's_open') {
      stack.push({ token, children: [] })
    } else if (token.type === 'link_close' || token.type === 'strong_close' || token.type === 'em_close' || token.type === 's_close') {
      if (stack.length === 1) continue
      const frame = stack.pop()
      current().push(inlineElement(h, frame.token, frame.children, options))
    }
  }
  while (stack.length > 1) {
    const frame = stack.pop()
    current().push(inlineElement(h, frame.token, frame.children, options))
  }
  return root
}

const blockElement = (h, token, children, options) => {
  const lineAttrs = attrs(token, options.lineBase)
  switch (token.type) {
    case 'paragraph_open': return h('p', lineAttrs, children)
    case 'heading_open': return h(token.tag, { ...lineAttrs, className: `doc-h doc-h-level doc-h${token.tag.slice(1)}` }, children)
    case 'blockquote_open': return h('blockquote', { ...lineAttrs, className: 'doc-quote' }, children)
    case 'bullet_list_open': return h('ul', lineAttrs, children)
    case 'ordered_list_open': return h('ol', { ...lineAttrs, start: attr(token, 'start') || undefined }, children)
    case 'list_item_open': return h('li', lineAttrs, children)
    case 'table_open': return h('table', { ...lineAttrs, className: 'doc-table' }, children)
    case 'thead_open': return h('thead', lineAttrs, children)
    case 'tbody_open': return h('tbody', lineAttrs, children)
    case 'tr_open': return h('tr', lineAttrs, children)
    case 'th_open': return h('th', { ...lineAttrs, style: reactStyle(attr(token, 'style')) }, children)
    case 'td_open': return h('td', { ...lineAttrs, style: reactStyle(attr(token, 'style')) }, children)
    default: return children
  }
}

/**
 * Map tokens to React elements. Callers supply only semantic handlers; no HTML renderer is accepted.
 * `softBreak` is the one dialect knob: 'break' renders an authoring wrap as a line break (message surfaces,
 * where a newline the writer typed is part of the reply), anything else reflows it into a space (documents).
 */
export function renderProseTokens(tokens, options = {}) {
  const h = options.h
  if (typeof h !== 'function') throw new TypeError('renderProseTokens requires a React-compatible h function')
  const root = []
  const stack = [{ token: null, children: root }]
  const current = () => stack[stack.length - 1].children
  for (const token of tokens || []) {
    if (token.type === 'inline') current().push(...renderInline(h, token.children, options))
    else if (token.type === 'fence' || token.type === 'code_block') {
      const language = token.info?.trim().split(/\s+/, 1)[0]
      current().push(h('pre', { ...attrs(token, options.lineBase), className: 'doc-pre' }, h('code', { className: language ? `language-${language}` : undefined }, token.content)))
    } else if (token.type === 'prose_math_block') current().push(mathElement(h, token, true, attrs(token, options.lineBase)))
    else if (token.type === 'prose_time_anchor') {
      const value = options.renderTimeAnchor?.(token.meta, token, attrs(token, options.lineBase))
      current().push(value ?? h('span', { ...attrs(token, options.lineBase), className: 'fv-anchor static', 'data-time-ms': token.meta.tMs }, token.meta.label))
    } else if (token.type === 'hr') current().push(h('hr', attrs(token, options.lineBase)))
    else if (token.type === 'html_block' || token.type === 'html_inline') current().push(token.content)
    else if (token.nesting === 1) stack.push({ token, children: [] })
    else if (token.nesting === -1) {
      if (stack.length === 1) continue
      const frame = stack.pop()
      current().push(blockElement(h, frame.token, frame.children, options))
    }
  }
  while (stack.length > 1) {
    const frame = stack.pop()
    current().push(blockElement(h, frame.token, frame.children, options))
  }
  return root
}
