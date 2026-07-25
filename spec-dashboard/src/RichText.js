import { createElement, useMemo } from 'react'
import MarkdownIt from 'markdown-it'
import katex from 'katex'

const MATH_OPTIONS = Object.freeze({
  trust: false,
  throwOnError: false,
  strict: 'ignore',
})

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

const renderMath = (source, displayMode, escapeHtml) => {
  try {
    const rendered = katex.renderToString(source, { ...MATH_OPTIONS, displayMode })
    return displayMode ? `<div class="katex-block">${rendered}</div>` : rendered
  } catch (error) {
    console.error('[rich-text] math render failed; showing source text', error)
    return `<span class="katex-error">${escapeHtml(source)}</span>`
  }
}

const mathPlugin = (md) => {
  md.inline.ruler.before('escape', 'rich_math_inline', (state, silent) => {
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
      const token = state.push('rich_math_inline', 'math', 0)
      token.content = state.src.slice(start + open.length, end)
      token.markup = open
    }
    state.pos = end + close.length
    return true
  })

  md.block.ruler.after('blockquote', 'rich_math_block', (state, startLine, endLine, silent) => {
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
    const token = state.push('rich_math_block', 'math', 0)
    token.block = true
    token.content = content
    token.map = [startLine, closeLine + 1]
    token.markup = open
    state.line = closeLine + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  md.renderer.rules.rich_math_inline = (tokens, index) => (
    renderMath(tokens[index].content, false, md.utils.escapeHtml)
  )
  md.renderer.rules.rich_math_block = (tokens, index) => (
    `${renderMath(tokens[index].content, true, md.utils.escapeHtml)}\n`
  )
}

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
}).use(mathPlugin)

// Remote Markdown images are tracking and layout surfaces. Keep their alt text without issuing a request.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || '')

export function renderRichText(value) {
  const source = value == null ? '' : String(value)
  try {
    return markdown.render(source)
  } catch (error) {
    console.error('[rich-text] render failed; showing source text', error)
    return `<p>${markdown.utils.escapeHtml(source).replace(/\n/g, '<br>\n')}</p>`
  }
}

export default function RichText({ children, className = '' }) {
  const html = useMemo(() => renderRichText(children), [children])
  return createElement('div', {
    className: `rich-text${className ? ` ${className}` : ''}`,
    dangerouslySetInnerHTML: { __html: html },
  })
}
