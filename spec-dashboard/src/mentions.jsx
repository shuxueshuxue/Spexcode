import { useEffect, useRef, useState } from 'react'
import { STATUS_COLOR, sessionHeadline } from './session.js'
import { STATUS } from './specMeta.js'
import { SessionPickerRow } from './SessionPicker.jsx'
import { useT } from './i18n/index.jsx'

// The dashboard's ONE mention-autocomplete ([[mentions]]): the `[[node]]` (topic) and `@session` (session)
// triggers, their ranking, and the dropdown — shared by every input box that takes the grammar (the session
// console's New prompt + ❯ inbox in SessionInterface.jsx, the Issues page's reply/new-thread composers in
// IssuesPage.jsx, the eval remark composer in EventDetail.jsx). One implementation, never a per-surface
// fork. References only edit the current draft; the exact @new token opens the shared worker launcher door.

// a `[[<id>]]` (Obsidian double-bracket) node-mention token. Optional leading dot so `[[.plugins]]` resolves
// (a node id is its dir basename — see [[spec-pointer]]). Group 1 = the id. Used for both the New Session
// launch grammar and the running-session send-time resolution — one pattern. Token chars are any unicode
// letter/number (a CJK dir name is a legal node id), mirroring the server's MENTION.
export const MENTION_RE = /\[\[(\.?[\p{L}\p{N}_-]+)\]\]/gu

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

// The session twin of matchSpecs: rank retained board sessions for a partial `@query`. A row reads as the
// same derived title every other surface shows; matching also searches the retained raw/name/prompt/note
// candidates so a pane-title change or rename does not strand a session under text the human already saw.
// `sub` is a hint (its node or status). Exact/prefix on id-or-candidate leads, then most-recent (`created`
// desc) within a band. Returns up to 8 `{id, label, sub}`.
export function matchSessions(sessions, query) {
  const q = query.toLowerCase()
  const handle = (s) => sessionHeadline(s) || (s.id || '').slice(0, 8)
  const candidates = (s) => [s?.title, s?.label, s?.raw?.name, s?.raw?.title, s?.activity, s?.promptPreview, s?.note]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.toLowerCase())
  const scored = []
  for (const s of sessions || []) {
    const id = (s.id || '').toLowerCase()
    const names = candidates(s)
    let score
    if (!q) score = 3
    else if (id === q || names.some((name) => name === q)) score = 0
    else if (id.startsWith(q) || names.some((name) => name.startsWith(q))) score = 1
    else if (id.includes(q) || names.some((name) => name.includes(q))) score = 2
    else continue
    scored.push({ s, score })
  }
  scored.sort((a, b) => a.score - b.score || (b.s.created || 0) - (a.s.created || 0))
  const items = scored.map((x) => ({ id: x.s.id, label: handle(x.s), sub: x.s.node || x.s.status, session: x.s }))
  const exactCount = scored.filter((x) => x.score === 0).length
  const beforeNew = items.slice(0, Math.min(exactCount, 7))
  return [...beforeNew, { id: 'new', label: 'new', sub: 'choose a launcher' }, ...items.slice(beforeNew.length)].slice(0, 8)
}

export function matchLaunchers(launchers, query) {
  const q = query.toLowerCase()
  return (launchers || [])
    .map((launcher) => {
      const name = (launcher.name || '').toLowerCase()
      const score = !q ? 1 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : -1
      return { launcher, score }
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.launcher.name.localeCompare(b.launcher.name))
    .slice(0, 8)
    .map(({ launcher }) => ({ id: launcher.name, label: launcher.name, sub: launcher.cmd || launcher.harness || '' }))
}

// bold the first case-insensitive hit of the query inside a label (the part the user has typed so far).
export function highlight(text, q) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<b className="mention-hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>
}

// filter a `/` command list by the typed prefix: startsWith beats a mid-string include; server order is
// preserved within a score band (stable sort). Empty query (just `/`) lists everything. ONE matcher for
// every `/` palette — the ❯ inbox's command menu, the New box's preset palette, the eval detail's review
// menu ([[review-commands]]) — so the palettes rank identically.
export function matchSlash(cmds, query) {
  const q = query.toLowerCase()
  const scored = []
  for (const c of cmds) {
    const n = c.name.toLowerCase()
    let score
    if (!q) score = 1
    else if (n.startsWith(q)) score = 0
    else if (n.includes(q)) score = 1
    else continue
    scored.push({ c, score })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, 10).map((x) => x.c)
}

// the positional `/` trigger used by launch-preset authoring: scan back from the caret to this
// whitespace-delimited token, then rank it through the same matcher every slash palette uses. A slash
// inside a word (URL/email/path prose) is inert; a bare `/` at a token boundary lists every command.
export function slashTokenAt(value, caret, commands) {
  let start = caret
  while (start > 0 && !/\s/.test(value[start - 1])) start--
  if (value[start] !== '/') return null
  const query = value.slice(start + 1, caret)
  const items = matchSlash(commands, query)
  if (!items.length) return null
  return { items, index: 0, start, end: caret, query }
}

// dropdown descriptions read as sentences — capitalise the first letter (idempotent; CC's already are).
const capDesc = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// the row's trailing source tag, mirroring CC: `(user)` / `(project)` / `[skill]` / `built-in`. `[board]`
// flags one of OUR commands (close/merge/eval — or the eval detail's /ok): it runs HERE, not in the
// agent (see sessionCommands.js / reviewCommands.js). `[preset]` is a SpexCode agent-prompt preset;
// `[review]` tags a review-track preset.
const SRC_TAG = { user: '(user)', project: '(project)', skill: '[skill]', 'built-in': 'built-in', ui: '[ui]', preset: '[preset]', review: '[review]' }

// ONE render for every `/` dropdown — Command Box's menu (`up`), the New
// box's preset palette (downward), and the eval composer's review menu (`up`). Rows: /name · description ·
// source tag; a board/review command carries its identity hue (`sc-<color>`), CC commands their source tag,
// presets their kind. `head` is the dim title label.
export function SlashMenu({ menu, up, head, onPick, onHover }) {
  const t = useT()
  return (
    <ul className={up ? 'mention-menu up' : 'mention-menu'} role="listbox">
      <li className="mention-head">// {head} — {t('session.menuHint')}</li>
      {menu.items.map((it, i) => {
        const tag = it.ui ? 'ui' : (it.source ?? it.kind)
        const hue = it.ui ? ` sc-${it.color}` : ''
        return (
          <li
            key={`${tag}:${it.name}`}
            role="option"
            aria-selected={i === menu.index}
            className={`${i === menu.index ? 'mention-item on' : 'mention-item'}${hue}`}
            onMouseDown={(e) => { e.preventDefault(); onPick(it) }}
            onMouseEnter={() => onHover(i)}
          >
            <span className={it.ui ? 'slash-name ui' : 'slash-name'}>/{highlight(it.name, menu.query)}</span>
            <span className="slash-desc">{capDesc(it.description ?? it.desc)}</span>
            <span className={`slash-src src-${tag}`}>{SRC_TAG[tag] || tag}</span>
          </li>
        )
      })}
    </ul>
  )
}

// the node-mention trigger — positional (Obsidian `[[`): scan back from the caret over id-chars; if the two
// chars just before that run are `[[`, the caret sits inside an UNCLOSED `[[query` token — the query is the
// text between the `[[` and the caret. Returns the menu descriptor, or null when the caret isn't in a token.
export function nodeMentionAt(value, caret, specs, focusId) {
  let i = caret - 1
  while (i >= 0 && /[\p{L}\p{N}_.\-]/u.test(value[i])) i--
  // i now points just left of the id run; the id starts at i+1. `[[` must occupy value[i-1] and value[i].
  if (i >= 1 && value[i - 1] === '[' && value[i] === '[') {
    const query = value.slice(i + 1, caret)
    const items = matchSpecs(specs, query, focusId)
    if (!items.length) return null
    return { kind: 'mention', items, index: 0, start: i - 1, end: caret, query }
  }
  return null
}

// the session-reference trigger — the `@` twin of nodeMentionAt. Positional like `[[`: scan back from the caret
// over handle-chars; if that run is preceded by an `@` at a WORD BOUNDARY (start of line or after
// whitespace), the caret sits inside an `@query` session token. `[[`=topic, `@`=session — the two triggers never
// collide (a bare `@` mid-word, e.g. an email, is not a boundary and stays inert).
export function sessionMentionAt(value, caret, sessions, launchers = []) {
  let i = caret - 1
  while (i >= 0 && /[\p{L}\p{N}_.:\-]/u.test(value[i])) i--
    // i now points at the char just left of the handle run — the `@` sigil for a session token.
  if (i >= 0 && value[i] === '@' && (i === 0 || /\s/.test(value[i - 1]))) {
    const query = value.slice(i + 1, caret)
    if (query.startsWith('new:')) {
      const items = matchLaunchers(launchers, query.slice('new:'.length))
      if (!items.length) return null
      return { kind: 'launcher', items, index: 0, start: i, end: caret, query: query.slice('new:'.length) }
    }
    const items = matchSessions(sessions, query)
    if (!items.length) return null
    return { kind: 'session', items, index: 0, start: i, end: caret, query }
  }
  return null
}

// ONE render for the `[[`-node and `@`-session dropdowns, on any surface — downward under a centered box, or
// `up` above a docked one. `menu` is the descriptor a trigger scanner built; onPick/onHover are the accept
// and index-follow callbacks. Rows: node = status dot + id + breadcrumb; session = @handle + hint.
export function MentionMenu({ menu, up, fixedStyle, onPick, onHover }) {
  const t = useT()
  const launcher = menu.kind === 'launcher'
  const session = menu.kind === 'session' || launcher
  const head = launcher
    ? `@new:${menu.query}`
    : menu.query
      ? (session ? `@${menu.query}` : `[[${menu.query}]]`)
      : t(session ? 'session.menuSessions' : 'session.menuSpecNodes')
  return (
    <ul className={`${up ? 'mention-menu up' : 'mention-menu'}${fixedStyle ? ' fixed' : ''}`} style={fixedStyle || undefined} role="listbox">
      <li className="mention-head">// {head} — {t('session.menuHint')}</li>
      {menu.items.map((it, i) => session && it.session
        ? <SessionPickerRow key={it.id} session={it.session} compact active={i === menu.index} onPick={() => onPick(it)} onHover={() => onHover(i)} className="mention-item" name={<>{'@'}{highlight(it.label, menu.query)}</>} />
        : (
          <li
            key={it.id}
            role="option"
            aria-selected={i === menu.index}
            className={`${i === menu.index ? 'mention-item on' : 'mention-item'}${launcher || (menu.kind === 'session' && it.id === 'new') ? ' new' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onPick(it) }}
            onMouseEnter={() => onHover(i)}
          >
            {!session && <span className="mention-dot" style={{ background: STATUS[it.status]?.color || STATUS.pending.color }} />}
            <span className="mention-id">{launcher ? <>@new:{highlight(it.label, menu.query)}</> : session ? <>@{highlight(it.label, menu.query)}</> : highlight(it.id, menu.query)}</span>
            <span className="mention-path">{session ? it.sub : specPath(it.path)}</span>
          </li>
        ))}
    </ul>
  )
}

// the whole autocomplete as ONE hook, for a plain textarea/input surface (the issue composers): owns the
// menu state, recomputes it from the live caret (sync), inserts the picked token (`[[<id>]] ` / `@<id> `)
// and drops the caret after it, and claims ↑/↓/Enter/Tab/Esc WHILE the menu is open (onKeyDown returns true
// when it consumed the key — Esc closes the menu only, never the page). The console keeps its own window-
// level state machine (it also multiplexes `/` menus) but builds from the SAME scanners and MentionMenu.
export function useMentionAutocomplete({ inputRef, value, setValue, specs = [], sessions = [], launchers = [], focusId = null, up = false, fixedAbove = null }) {
  const [menu, setMenu] = useState(null)
  const [fixedStyle, setFixedStyle] = useState(null)
  // React synthesizes onSelect after Escape keyup even when the native selection did not move. Without a
  // dismissal key that synthetic sync immediately reopened the menu Esc had just closed. The dismissal is
  // only for this exact draft+caret; typing or moving naturally changes the key and re-enables completion.
  const dismissed = useRef(null)
  const caretKey = (el) => `${el.value}\0${el.selectionStart}`
  const sync = (el) => {
    if (!el) { setMenu(null); setFixedStyle(null); return }
    const key = caretKey(el)
    if (dismissed.current === key) { setMenu(null); setFixedStyle(null); return }
    dismissed.current = null
    const caret = el.selectionStart
    const next = nodeMentionAt(el.value, caret, specs, focusId) || sessionMentionAt(el.value, caret, sessions, launchers)
    setMenu(next)
    if (!next || !fixedAbove) { setFixedStyle(null); return }
    const input = el.getBoundingClientRect()
    const boundary = el.closest(fixedAbove)?.getBoundingClientRect()
    const above = boundary?.top ?? input.top
    setFixedStyle({
      left: `${input.left}px`,
      width: `${input.width}px`,
      right: 'auto',
      bottom: `${Math.max(8, window.innerHeight - above + 8)}px`,
    })
  }
  useEffect(() => {
    const el = inputRef.current
    if (launchers.length && el && document.activeElement === el) sync(el)
  }, [launchers])
  const navBy = (dir) => setMenu((m) => (m ? { ...m, index: (m.index + dir + m.items.length) % m.items.length } : m))
  const accept = (item) => {
    if (!item || !menu) return
    dismissed.current = null
    const before = value.slice(0, menu.start)
    if (menu.kind === 'session' && item.id === 'new') {
      const insert = '@new:'
      const nextValue = before + insert + value.slice(menu.end)
      const caret = before.length + insert.length
      setValue(nextValue)
      setMenu(sessionMentionAt(nextValue, caret, sessions, launchers))
      requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
      return
    }
    const insert = menu.kind === 'session' ? `@${item.id} `
      : menu.kind === 'launcher' ? `@new:${item.id} `
        : `[[${item.id}]] `
    setValue(before + insert + value.slice(menu.end))
    setMenu(null)
    setFixedStyle(null)
    const caret = before.length + insert.length
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
  }
  const onKeyDown = (e) => {
    if (!menu) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navBy(1); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); navBy(-1); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return true }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); return true }
    return false
  }
  // `dismiss` is Escape's close — it remembers this exact draft+caret so the synthetic onSelect that follows
  // cannot reopen the menu — for a host whose Escape arrives through the layer stack rather than the key.
  const dismiss = () => {
    if (inputRef.current) dismissed.current = caretKey(inputRef.current)
    setMenu(null); setFixedStyle(null)
  }
  const close = () => { dismissed.current = null; setMenu(null); setFixedStyle(null) }
  const menuEl = menu
    ? <MentionMenu menu={menu} up={up} fixedStyle={fixedStyle} onPick={accept} onHover={(i) => setMenu((m) => (m ? { ...m, index: i } : m))} />
    : null
  return { menu, sync, onKeyDown, close, dismiss, menuEl }
}

// the keyboard contract of ANY open completion menu — ↑/↓ walk, Enter/Tab accept, Escape closes — for a
// host that keeps its own menu state (the `/` palettes, which multiplex beside the mention hook). Returns
// true when it consumed the key, so the caller falls through to its own bindings otherwise.
export function menuKeyDown(e, menu, setMenu, accept) {
  if (!menu) return false
  if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setMenu((m) => (m ? { ...m, index: (m.index + 1) % m.items.length } : m)); return true }
  if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setMenu((m) => (m ? { ...m, index: (m.index - 1 + m.items.length) % m.items.length } : m)); return true }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return true }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); return true }
  return false
}

// The grammar's DISCOVERABILITY DOOR, as ONE mechanism: type the EXACT trigger (`@` / `[[` / `/`) at the
// caret so the SAME shared autocomplete opens naturally. It only types what the hand would — any selection
// replaced, the rest of the draft preserved, the caret parked right after the trigger, the surface
// refocused, and the host's own caret `sync` re-run — so no composer needs its own insertion dialect.
export function typeTrigger(el, trigger, setValue, sync = null) {
  if (!el) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  setValue(el.value.slice(0, start) + trigger + el.value.slice(end))
  const caret = start + trigger.length
  requestAnimationFrame(() => {
    if (!el.isConnected) return
    el.focus()
    el.setSelectionRange(caret, caret)
    sync?.(el)
  })
}

// the door's chrome: a compact symbol button wearing the localized tooltip + accessible name, swallowing
// mousedown so a click never blurs the surface it types into.
export function TriggerButton({ label, onClick, disabled = false, children }) {
  return (
    <button type="button" className="fv-trigger-btn" data-tip={label} aria-label={label} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  )
}
