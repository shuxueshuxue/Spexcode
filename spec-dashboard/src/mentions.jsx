import { useState } from 'react'
import { STATUS_COLOR, sessionHeadline } from './session.js'
import { useT } from './i18n/index.jsx'

// The dashboard's ONE mention-autocomplete ([[mentions]]): the `[[node]]` (topic) and `@session` (actor)
// triggers, their ranking, and the dropdown — shared by every input box that takes the grammar (the session
// console's New prompt + ❯ inbox in SessionInterface.jsx, the Issues page's reply/new-thread composers in
// IssuesPage.jsx, the eval remark composer in EventDetail.jsx). One implementation, never a per-surface
// fork: the CLI resolver is the semantics, this is
// its thin autocomplete.

// a `[[<id>]]` (Obsidian double-bracket) node-mention token. Optional leading dot so `[[.config]]` resolves
// (a node id is its dir basename — see [[spec-pointer]]). Group 1 = the id. Used for both the New Session
// launch grammar and the running-session send-time resolution — one pattern.
export const MENTION_RE = /\[\[(\.?[A-Za-z0-9_-]+)\]\]/g

// the menu's spec path, minus the `.spec/` shell and `/spec.md` leaf, so a row reads like a breadcrumb.
export const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// rank spec nodes for a partial `[[query`. The focused node always floats to the very top (so just typing
// `[[` lists it first — the convenient default target). Otherwise id beats path; a prefix beats a mid-match;
// shorter ids win ties so the most specific node floats up. Empty query (just typed `[[`) lists everything.
export function matchSpecs(specs, query, focusId) {
  const q = query.toLowerCase()
  const scored = []
  for (const s of specs) {
    const id = s.id.toLowerCase()
    const path = specPath(s.path).toLowerCase()
    let score
    if (!q) score = 3
    else if (id.startsWith(q)) score = 0
    else if (id.includes(q)) score = 1
    else if (path.includes(q)) score = 2
    else continue
    if (s.id === focusId) score = -1   // focused node first whenever it's in the result set
    scored.push({ s, score })
  }
  scored.sort((a, b) => a.score - b.score || a.s.id.length - b.s.id.length || a.s.id.localeCompare(b.s.id))
  return scored.slice(0, 8).map((x) => x.s)
}

// the actor twin of matchSpecs: rank ONLINE board sessions for a partial `@query`, plus the synthetic
// `@new` (spawn a fresh worker), which is ALWAYS present near the top (after any exact matches). A row
// reads as the SAME headline every other surface shows ([[session-label]] — sessionHeadline, never a bare
// title/name, which no longer ride the wire); `sub` is a hint (its node or status). Exact/prefix on
// id-or-handle leads, then most-recent (`created` desc) within a band. Returns up to 8 `{id, label, sub}`.
export function matchSessions(sessions, query) {
  const q = query.toLowerCase()
  const handle = (s) => sessionHeadline(s) || (s.id || '').slice(0, 8)
  const scored = []
  for (const s of sessions || []) {
    if (s.liveness !== 'online') continue
    const id = (s.id || '').toLowerCase()
    const h = handle(s).toLowerCase()
    let score
    if (!q) score = 3
    else if (id === q || h === q) score = 0
    else if (id.startsWith(q) || h.startsWith(q)) score = 1
    else if (id.includes(q) || h.includes(q)) score = 2
    else continue
    scored.push({ s, score })
  }
  scored.sort((a, b) => a.score - b.score || (b.s.created || 0) - (a.s.created || 0))
  const items = scored.map((x) => ({ id: x.s.id, label: handle(x.s), sub: x.s.node || x.s.status }))
  const exactCount = scored.filter((x) => x.score === 0).length
  items.splice(exactCount, 0, { id: 'new', label: 'new', sub: 'spawn a fresh worker' })
  return items.slice(0, 8)
}

// bold the first case-insensitive hit of the query inside a label (the part the user has typed so far).
export function highlight(text, q) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<b className="mention-hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>
}

// the node-mention trigger — positional (Obsidian `[[`): scan back from the caret over id-chars; if the two
// chars just before that run are `[[`, the caret sits inside an UNCLOSED `[[query` token — the query is the
// text between the `[[` and the caret. Returns the menu descriptor, or null when the caret isn't in a token.
export function nodeMentionAt(value, caret, specs, focusId) {
  let i = caret - 1
  while (i >= 0 && /[A-Za-z0-9_.\-]/.test(value[i])) i--
  // i now points just left of the id run; the id starts at i+1. `[[` must occupy value[i-1] and value[i].
  if (i >= 1 && value[i - 1] === '[' && value[i] === '[') {
    const query = value.slice(i + 1, caret)
    const items = matchSpecs(specs, query, focusId)
    if (!items.length) return null
    return { kind: 'mention', items, index: 0, start: i - 1, end: caret, query }
  }
  return null
}

// the actor-mention trigger — the `@` twin of nodeMentionAt. Positional like `[[`: scan back from the caret
// over handle-chars; if that run is preceded by an `@` at a WORD BOUNDARY (start of line or after
// whitespace), the caret sits inside an `@query` actor token. `[[`=topic, `@`=actor — the two triggers never
// collide (a bare `@` mid-word, e.g. an email, is not a boundary and stays inert).
export function actorMentionAt(value, caret, sessions) {
  let i = caret - 1
  while (i >= 0 && /[A-Za-z0-9_.\-]/.test(value[i])) i--
  // i now points at the char just left of the handle run — the `@` sigil for an actor token.
  if (i >= 0 && value[i] === '@' && (i === 0 || /\s/.test(value[i - 1]))) {
    const query = value.slice(i + 1, caret)
    const items = matchSessions(sessions, query)
    if (!items.length) return null
    return { kind: 'actor', items, index: 0, start: i, end: caret, query }
  }
  return null
}

// ONE render for the `[[`-node and `@`-actor dropdowns, on any surface — downward under a centered box, or
// `up` above a docked one. `menu` is the descriptor a trigger scanner built; onPick/onHover are the accept
// and index-follow callbacks. Rows: node = status dot + id + breadcrumb; actor = @handle + hint (the
// synthetic `@new` row wears a subtle distinct style). No emoji.
export function MentionMenu({ menu, up, onPick, onHover }) {
  const t = useT()
  const actor = menu.kind === 'actor'
  const head = menu.query
    ? (actor ? `@${menu.query}` : `[[${menu.query}]]`)
    : t(actor ? 'session.menuSessions' : 'session.menuSpecNodes')
  return (
    <ul className={up ? 'mention-menu up' : 'mention-menu'} role="listbox">
      <li className="mention-head">// {head} — {t('session.menuHint')}</li>
      {menu.items.map((it, i) => (
        <li
          key={it.id}
          role="option"
          aria-selected={i === menu.index}
          className={`${i === menu.index ? 'mention-item on' : 'mention-item'}${actor && it.id === 'new' ? ' new' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onPick(it) }}
          onMouseEnter={() => onHover(i)}
        >
          {!actor && <span className="mention-dot" style={{ background: STATUS_COLOR[it.status] || STATUS_COLOR.offline }} />}
          <span className="mention-id">{actor ? <>@{highlight(it.label, menu.query)}</> : highlight(it.id, menu.query)}</span>
          <span className="mention-path">{actor ? it.sub : specPath(it.path)}</span>
        </li>
      ))}
    </ul>
  )
}

// the whole autocomplete as ONE hook, for a plain textarea/input surface (the forum composers): owns the
// menu state, recomputes it from the live caret (sync), inserts the picked token (`[[<id>]] ` / `@<id> `)
// and drops the caret after it, and claims ↑/↓/Enter/Tab/Esc WHILE the menu is open (onKeyDown returns true
// when it consumed the key — Esc closes the menu only, never the page). The console keeps its own window-
// level state machine (it also multiplexes `/` menus) but builds from the SAME scanners and MentionMenu.
export function useMentionAutocomplete({ inputRef, value, setValue, specs = [], sessions = [], focusId = null, up = false }) {
  const [menu, setMenu] = useState(null)
  const sync = (el) => {
    if (!el) return setMenu(null)
    const caret = el.selectionStart
    setMenu(nodeMentionAt(el.value, caret, specs, focusId) || actorMentionAt(el.value, caret, sessions))
  }
  const navBy = (dir) => setMenu((m) => (m ? { ...m, index: (m.index + dir + m.items.length) % m.items.length } : m))
  const accept = (item) => {
    if (!item || !menu) return
    const insert = menu.kind === 'actor' ? `@${item.id} ` : `[[${item.id}]] `
    const before = value.slice(0, menu.start)
    setValue(before + insert + value.slice(menu.end))
    setMenu(null)
    const caret = before.length + insert.length
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
  }
  const onKeyDown = (e) => {
    if (!menu) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navBy(1); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); navBy(-1); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return true }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); return true }
    return false
  }
  const close = () => setMenu(null)
  const menuEl = menu
    ? <MentionMenu menu={menu} up={up} onPick={accept} onHover={(i) => setMenu((m) => (m ? { ...m, index: i } : m))} />
    : null
  return { menu, sync, onKeyDown, close, menuEl }
}
