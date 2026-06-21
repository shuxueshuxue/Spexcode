import { useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'
import { loadConfig } from './data.js'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { STATUS_DOT, sessionName } from './session.js'
import { useT } from './i18n/index.jsx'

// @@@ SessionInterface - the Enter surface. TWO panes: a left session list and a right content area
// that MORPHS by what's focused in the list:
//   · "New Session" focused -> input box + avatar CENTERED (terminal vibe). Nothing is prefilled — the
//     focused spec node is instead the FIRST @-mention suggestion, so you opt into targeting it by typing
//     `@`. Enter launches a real session, then we SWITCH to it.
//   · an existing session focused -> the content becomes a READ-ONLY live tmux terminal (SessionTerm),
//     with the SINGLE human input docked at the BOTTOM. The terminal never accepts typing; the bottom box
//     is the only input — submitting dispatches the line through the CONTROL SOCKET (POST /keys, which
//     injects via the daemon socket, bypassing tmux), NEVER by writing into the pane. That is what makes a
//     message land even when tmux is in copy-mode (which scrolling the terminal enters); the WebSocket the
//     terminal holds is for the read-only display + scroll only.
// "BOARDING SWITCH" not "temporary modal": the surface stays MOUNTED while the board is open AND while
// it's hidden (driven by the `open` prop — App never unmounts it). So the selected tab (`sel`, lifted to
// App) AND any typed-but-unsent input survive a close/reopen — you switch back to exactly where you were.
//
// KEY HANDLING is at the WINDOW level (capture), not the panel's onKeyDown: when you arrow off the
// New Session tab its textarea unmounts and focus would leave the panel, which used to kill further
// nav. A window listener is focus-independent, so ↑/↓ keep walking the list no matter what's focused.

// @@@ nav-mode keymap - DOM KeyboardEvent.key → the key NAME our /rawkey backend feeds to tmux send-keys.
// Anything not listed and length-1 (a printable char) is forwarded verbatim. Escape is handled separately
// (it cancels a menu, and a second Esc exits nav mode), so it's intentionally absent here.
const RAWKEY = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', ' ': 'Space' }

// @@@ @-mention helpers - the spec path the menu matches against (`.spec/a/b/<id>/spec.md`), shown
// minus the `.spec/` shell and the `/spec.md` leaf, so the row reads like the tree breadcrumb it is.
const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// rank spec nodes for a partial @query. The focused node always floats to the very top (so just typing
// `@` lists it first — the convenient default target). Otherwise id beats path; a prefix beats a mid-match;
// shorter ids win ties so the most specific node floats up. Empty query (just typed `@`) lists everything.
function matchSpecs(specs, query, focusId) {
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

// @@@ caretAtEdge - is the <textarea> caret on its FIRST (dir:'up') or LAST (dir:'down') VISUAL line,
// counting WRAPPED lines, not just '\n'? The window-level ↑/↓ owns tab nav, but inside a multi-line
// input the arrows must first walk the caret; only at the visual edge — no line to move to in that
// direction — should they fall through to switching tabs. Browsers expose no caret-line API for a
// textarea, so we mirror it into an off-screen div with the SAME wrapping geometry (width, padding,
// font) and read which line the caret pixel lands on. One reused hidden node, measured synchronously.
let mirror
function caretAtEdge(el, dir) {
  const cs = getComputedStyle(el)
  if (!mirror) { mirror = document.createElement('div'); document.body.appendChild(mirror) }
  const s = mirror.style
  s.position = 'absolute'; s.visibility = 'hidden'; s.top = '0'; s.left = '-9999px'
  s.whiteSpace = 'pre-wrap'; s.wordWrap = 'break-word'; s.overflow = 'hidden'
  s.boxSizing = 'border-box'; s.border = '0'; s.width = `${el.clientWidth}px`
  for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize',
    'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textIndent', 'textTransform', 'tabSize']) s[p] = cs[p]
  const caret = el.selectionStart
  mirror.textContent = el.value.slice(0, caret)
  const mark = document.createElement('span')
  mark.textContent = el.value.slice(caret) || '.'   // mark's box top = the caret's visual-line top
  mirror.appendChild(mark)
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
  const padTop = parseFloat(cs.paddingTop) || 0, padBottom = parseFloat(cs.paddingBottom) || 0
  const top = mark.offsetTop - padTop                          // caret line top from text start; 0 = first line
  const textHeight = mirror.scrollHeight - padTop - padBottom  // height of all (wrapped) lines
  return dir === 'up' ? top < lh : top >= textHeight - lh - 1
}

// @@@ slash-command match - filter the fetched command list by the typed prefix (the text after `/`).
// startsWith beats a mid-string include; server order (custom → built-in → skill) is preserved within a
// score band because Array.sort is stable. Empty query (just `/`) lists everything. Mirrors CC's `/` menu.
function matchSlash(cmds, query) {
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

// @@@ config-preset match - the New Session `/` palette: same prefix-rank shape as matchSlash, over the
// config presets (GET /api/config). startsWith beats a mid-string include; empty query (just `/`) lists all.
function matchConfig(presets, query) {
  const q = query.toLowerCase()
  const scored = []
  for (const p of presets) {
    const n = p.name.toLowerCase()
    let score
    if (!q) score = 1
    else if (n.startsWith(q)) score = 0
    else if (n.includes(q)) score = 1
    else continue
    scored.push({ p, score })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, 10).map((x) => x.p)
}

// the row's trailing source tag, mirroring CC: `(user)` / `(project)` / `[skill]` / `built-in`.
const SRC_TAG = { user: '(user)', project: '(project)', skill: '[skill]', 'built-in': 'built-in' }

// bold the first case-insensitive hit of the query inside a label (the part the user has typed so far).
function highlight(text, q) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<b className="mention-hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>
}

export default function SessionInterface({ sessions, specs = [], focusNode, open, sel, setSel, seed, onSeedConsumed, onClose, onCreated }) {
  const t = useT()
  const [prompt, setPrompt] = useState('')    // the New Session tab's own draft (its boarding-switch cache)
  const [menu, setMenu] = useState(null)      // completion dropdown: { kind:'mention'|'config'|'slash', items, index, start, end, query }
  const [slashCmds, setSlashCmds] = useState([])   // the `/` command list (built-in + user/project/skill), fetched once
  const [presets, setPresets] = useState([])       // the config presets (GET /api/config) — the New Session box's `/` palette
  // bottom-input drafts, keyed by session id — each session tab keeps its OWN typed-but-unsent line, never
  // a single shared box. Survives tab switches and close/reopen (the panel stays mounted, see `open`).
  const [drafts, setDrafts] = useState({})
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState(false)   // last /keys dispatch failed — surfaced under the ❯ box
  // @@@ nav mode - when ON, the ❯ box is disabled and every keystroke is forwarded RAW to the active
  // session's pane (POST /rawkey → tmux send-keys) so the human drives the agent's interactive TUI menus.
  // `menuById` is the best-effort, NON-authoritative hint (set by each SessionTerm) that a pane currently
  // looks like a select menu — used only to SUGGEST nav mode (pulse the button), never to seize keys.
  const [navMode, setNavMode] = useState(false)
  const [menuById, setMenuById] = useState({})
  const lastEscRef = useRef(0)
  const taRef = useRef(null)
  const msgRef = useRef(null)

  const order = useMemo(() => ['new', ...sessions.map((s) => s.id)], [sessions])
  const active = order.includes(sel) ? sel : 'new'
  const focusId = focusNode?.id || null
  const selSession = sessions.find((s) => s.id === active)
  // the active session tab's bottom-input draft (per-session, see `drafts`).
  const msg = drafts[active] || ''
  const setMsg = (v) => setDrafts((d) => ({ ...d, [active]: v }))

  // fetch the `/` command list once — same data CC's own `/` menu is built from (see backend
  // /api/slash-commands). Purely for display+insert; we never execute a command from it.
  useEffect(() => {
    fetch('/api/slash-commands').then((r) => r.json()).then((d) => { if (Array.isArray(d)) setSlashCmds(d) }).catch(() => {})
  }, [])

  // fetch the config presets once — the New Session box's `/` palette (tidy/health/…). Picking one composes
  // its body into the launch prompt (see submit); listing is display-only, like the slash menu.
  useEffect(() => {
    loadConfig().then((d) => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})
  }, [])
  // @@@ slash surface - /api/config returns ONLY slash-surface nodes (those living under a `slash/` dir;
  // the backend routes on location now, see specs.ts loadSurface), so the presets ARE the launchable set —
  // no client-side filter. system nodes plug in via the launcher's system prompt and never reach here.
  const slashPresets = presets

  // nav mode binds to ONE live session's menu — leaving the tab (or it going offline) exits it, so raw
  // keystrokes can never leak into the wrong pane.
  useEffect(() => { setNavMode(false); setSendErr(false); setMenu(null) }, [active])
  useEffect(() => { if (selSession?.status === 'offline') setNavMode(false) }, [selSession?.status])
  // @@@ refocus on nav exit - leaving nav mode (chord, double-Esc, header button, or bottom-bar click)
  // hands the keyboard back to the bottom message box, so you can type without re-clicking it. Guarded to
  // the on→off edge for a live session tab; a tab switch or going offline exits nav too, but the tab-focus
  // effect owns focus there (and an offline tab has no input box to land in).
  const wasNavRef = useRef(false)
  useEffect(() => {
    if (wasNavRef.current && !navMode && active !== 'new' && selSession?.status !== 'offline') msgRef.current?.focus()
    wasNavRef.current = navMode
  }, [navMode])
  // forward one raw key to the active session's pane (fire-and-forget; the backend tmux send-keys it).
  const sendRawKey = (key) => {
    fetch(`/api/sessions/${active}/rawkey`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    }).catch(() => {})
  }
  // each SessionTerm reports whether its pane currently looks like a select menu (best-effort hint).
  const reportMenu = (id, likely) => setMenuById((m) => (m[id] === likely ? m : { ...m, [id]: likely }))

  // @@@ warm, always-connected terminals - mount EVERY live session's terminal as soon as the board data
  // arrives, not lazily on first focus. Each SessionTerm opens its WebSocket on mount, so by the time you
  // click a tab the socket + scroll are already live and switching is instant — never a focus-triggered
  // cold load. And because App keeps this whole surface mounted (hidden via `open`, never unmounted), the
  // sockets stay connected even while the session console is CLOSED — reopening the board reveals panes
  // that are already warm. Mounting while hidden is safe: SessionTerm's fit bails on a near-0 host (its
  // shrink guard) and re-fits via ResizeObserver/animationend the instant a layer is revealed. We track
  // exactly the set of live sessions, dropping any that vanish or go offline (an offline tab shows the
  // relaunch panel, not a dead terminal). This is the key experience — no warmth is traded for laziness.
  const [opened, setOpened] = useState(() => new Set())
  useEffect(() => {
    setOpened((prev) => {
      const next = new Set()
      for (const s of sessions) if (s.status !== 'offline') next.add(s.id)
      if (next.size !== prev.size) return next
      for (const id of next) if (!prev.has(id)) return next
      return prev
    })
  }, [sessions])

  // @@@ seed - a board chord (nn/dd) opens this surface with a pre-filled @-directive. Apply it to the
  // New Session draft ONCE, land on the New tab, place the caret at the end, then clear it upstream so a
  // later reopen restores the user's own draft instead of re-seeding. Clobbering the draft is intended
  // here (unlike a normal tab switch): the chord is an explicit "start this op".
  useEffect(() => {
    if (seed == null) return
    setSel('new')
    setPrompt(seed)
    setMenu(null)
    onSeedConsumed?.()
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(seed.length, seed.length) } })
  }, [seed])

  // @@@ focus on tab switch - whenever the board is open and you land on a tab, focus that tab's input:
  // the New Session prompt, or a live session's bottom message box. NOTHING is prefilled — the focused
  // node is instead the first @-mention suggestion, so you opt into it by typing `@`. (No setPrompt here:
  // the per-tab drafts must survive a tab switch / reopen, so we never clobber them.)
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      if (active === 'new') taRef.current?.focus()
      else if (selSession?.status !== 'offline') msgRef.current?.focus()
    }, 0)
    return () => clearTimeout(id)
  }, [open, active, selSession?.status])

  // @@@ auto-grow - the new-session box grows with its content (line wraps + newlines) up to the CSS
  // max-height, then scrolls. Reset to 0/auto first so it can also shrink when text is deleted. Re-runs
  // on `open` too, so a reopen with a cached multi-line draft restores its height instead of collapsing.
  useEffect(() => {
    const ta = taRef.current
    if (!ta || active !== 'new' || !open) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt, active, open])

  // @@@ composeLaunch - the grammar `/<preset> @<node>… <free text>` assembles ONE launch prompt:
  //   · /<preset>  → a config preset (GET /api/config) whose `body` is the contract the agent runs.
  //   · @<node>…   → the targets; resolved (via the @-mention specs) to `@id — path` lines that REPLACE the
  //                  body's {{targets}} placeholder. No @ = a "current/focused" note (the body handles it).
  //   · free text  → appended after the body as the human's extra steer.
  // Keeping each target as `@id` in the targets block is load-bearing: the server derives the session's node
  // from the FIRST `@<id>` it sees, so the composed prompt stays node-associated for free. A leading `/` that
  // names no known preset is left verbatim (no hijack) — and a plain or @-only prompt returns unchanged, so
  // the existing launch paths keep working.
  const composeLaunch = (raw) => {
    const m = raw.match(/^\/(\S+)\s*([\s\S]*)$/)
    if (!m) return raw
    const preset = slashPresets.find((p) => p.name === m[1])
    if (!preset) return raw
    const ids = []
    const free = m[2].replace(/(^|\s)@(\.?[A-Za-z0-9_-]+)/g, (_, sp, id) => { ids.push(id); return sp }).trim()
    const targets = ids.length
      ? ids.map((id) => {
          const s = specs.find((x) => x.id === id)
          return s ? `- @${s.id} — ${specPath(s.path)}` : `- @${id}`
        }).join('\n')
      : '(no target specified — operate on the current/focused node.)'
    const body = preset.body.includes('{{targets}}')
      ? preset.body.replace('{{targets}}', targets)
      : `${preset.body}\n\n${targets}`
    return free ? `${body}\n\n${free}` : body
  }

  // launch a real session, then SWITCH to it (onCreated reloads the board, then App sets sel to the id).
  const submit = async () => {
    const raw = prompt.trim()
    if (!raw || sending) return
    setSending(true)
    try {
      // compose a `/preset @node text` prompt into the preset's body (targets filled); a plain/@-only prompt
      // passes through unchanged. The server then derives the node from the @-mention the prompt carries and
      // titles a node-agnostic session by its first words — so the @ you type decides the node.
      const text = composeLaunch(raw)
      const res = await fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      })
      const data = await res.json().catch(() => null)
      setPrompt('')
      await onCreated?.(data?.id)
    } finally {
      setSending(false)
    }
  }

  // @@@ completion menus - one state machine, but each input surface drives its own dropdowns:
  //   · New Session prompt → mention + config - an `@` that begins a word opens the spec-node dropdown
  //     (the node a new session targets); a leading `/token` (whole line, no space yet) opens the CONFIG
  //     PRESET palette (tidy/health/…, GET /api/config). The two compose: `/tidy @node text` picks a preset
  //     and its targets (see submit). Picking a preset only inserts `/<name> ` — composition happens at launch.
  //   · a session's ❯ inbox → slash - the WHOLE line is a single `/token` (no space yet): mirrors Claude
  //     Code's `/` menu, listing commands whose name matches the prefix. Typing a space (→ args) dismisses
  //     it, exactly like CC. DECOUPLED — picking one only inserts `/<name> ` text into the draft, nothing
  //     runs; you still press Enter to dispatch the line to the agent.
  // The trigger is purely positional. For mention we scan back from the caret over non-space chars; it's
  // a mention only if we hit an `@` at a word boundary with no space up to the caret.
  const buildMenu = (value, caret) => {
    if (active === 'new') {
      let i = caret - 1
      while (i >= 0 && value[i] !== '@' && !/\s/.test(value[i])) i--
      if (i >= 0 && value[i] === '@' && (i === 0 || /\s/.test(value[i - 1]))) {   // @ at a word boundary → mention
        const query = value.slice(i + 1, caret)
        const items = matchSpecs(specs, query, focusId)
        if (!items.length) return null
        return { kind: 'mention', items, index: 0, start: i, end: caret, query }
      }
      const cm = value.match(/^\/(\S*)$/)   // leading `/preset` (no space yet) → config-preset palette
      if (cm) {
        const items = matchConfig(slashPresets, cm[1])
        if (!items.length) return null
        return { kind: 'config', items, index: 0, start: 0, end: value.length, query: cm[1] }
      }
      return null
    }
    const sm = value.match(/^\/(\S*)$/)
    if (sm) {
      const items = matchSlash(slashCmds, sm[1])
      if (!items.length) return null
      return { kind: 'slash', items, index: 0, start: 0, end: value.length, query: sm[1] }
    }
    return null
  }
  // recompute from the textarea's live value + caret (covers typing, deletes, and bare caret moves).
  const syncMenu = (el) => setMenu(el ? buildMenu(el.value, el.selectionStart) : null)
  const navMenu = (dir) => setMenu((m) => (m ? { ...m, index: (m.index + dir + m.items.length) % m.items.length } : m))
  // replace the menu's span under the caret with the picked item's token, then drop the caret after it.
  // Each kind writes its OWN surface: slash → the active session's ❯ draft (msgRef), insert-only and never
  // executed; mention → the New Session prompt (taRef). `@<id> ` / `/<name> ` both leave a trailing space.
  const accept = (item) => {
    if (!item || !menu) return
    if (menu.kind === 'slash') {
      const insert = `/${item.name} `
      const before = msg.slice(0, menu.start)
      setMsg(before + insert + msg.slice(menu.end))
      setMenu(null)
      const caret = before.length + insert.length
      requestAnimationFrame(() => { const el = msgRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
      return
    }
    // config preset and mention both write the New Session prompt (taRef); the preset is composed at launch.
    const insert = menu.kind === 'config' ? `/${item.name} ` : `@${item.id} `
    const before = prompt.slice(0, menu.start)
    setPrompt(before + insert + prompt.slice(menu.end))
    setMenu(null)
    const caret = before.length + insert.length
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
  }

  // @@@ slash dropdown - ONE render for both `/` palettes: the session inbox's CC-command menu (`up`, opens
  // above the docked box) and the New Session box's config-preset menu (opens downward). Same markup, keys,
  // and CSS; only the right-hand tag differs — a command's source (user/project/skill/built-in) vs a preset's
  // kind (mutating/report). `head` is the dim title row's label.
  const slashMenu = (up, head) => (
    <ul className={up ? 'mention-menu up' : 'mention-menu'} role="listbox">
      <li className="mention-head">// {head} — {t('session.menuHint')}</li>
      {menu.items.map((it, i) => {
        const tag = it.source ?? it.kind   // command → source; preset → kind
        return (
          <li
            key={`${tag}:${it.name}`}
            role="option"
            aria-selected={i === menu.index}
            className={i === menu.index ? 'mention-item on' : 'mention-item'}
            onMouseDown={(e) => { e.preventDefault(); accept(it) }}
            onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
          >
            <span className="slash-name">/{highlight(it.name, menu.query)}</span>
            <span className="slash-desc">{it.description ?? it.desc}</span>
            <span className={`slash-src src-${tag}`}>{SRC_TAG[tag] || tag}</span>
          </li>
        )
      })}
    </ul>
  )

  // @@@ control-socket dispatch - the message ALWAYS goes through the rendezvous CONTROL SOCKET
  // (POST /keys → daemon socket, bypassing tmux), NEVER by writing into the tmux pane. Writing pane bytes
  // (the old WebSocket path) breaks whenever tmux is in COPY MODE — which scrolling the terminal enters —
  // because copy-mode eats those bytes as navigation instead of delivering them to the agent. /keys injects
  // out-of-band, so a message lands regardless of scroll/copy-mode state. The WebSocket stays for the
  // read-only DISPLAY stream + wheel→copy-mode scroll only. Fail-loud: /keys 502s if dispatch fails, and we
  // surface that (restore the draft, flag the error) rather than pretend it sent.
  const sendMsg = async () => {
    const text = msg
    if (!text.trim() || active === 'new') return
    setMsg('')
    setSendErr(false)
    try {
      const res = await fetch(`/api/sessions/${active}/keys`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, enter: true }),
      })
      if (!res.ok) throw new Error(`keys ${res.status}`)
    } catch {
      setMsg(text)      // don't lose the message — put it back so the human can retry
      setSendErr(true)
    }
  }

  // lifecycle actions — thin POSTs to the session state machine, then reload the board.
  const act = async (verb, after) => {
    await fetch(`/api/sessions/${active}/${verb}`, { method: 'POST' }).catch(() => {})
    if (after) after()
    await onCreated?.(null)
  }
  // @@@ window-level list nav - ↑/↓ move the selection regardless of focus; Enter on New launches.
  const stateRef = useRef({})
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey } = stateRef.current
      if (!open) return   // panel hidden (board not the active surface): the graph owns the keys
      // @@@ nav-mode toggle chord (⌃/⌘+I) - the dependable keyboard entry/exit, alongside the header button.
      // Handled before everything else so it works whether nav mode is currently on or off.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I') && active !== 'new') {
        e.preventDefault(); e.stopPropagation(); setNavMode((v) => !v); return
      }
      // @@@ jump to New Session - ⌃/⌘+N (also ⌃/⌘+↑/Home) snaps the selection to the New Session tab from
      // anywhere in the panel, no arrowing up the whole list. Handled before the nav-mode passthrough so it
      // works even while raw-key mode is forwarding keystrokes to a session pane. The tab-switch focus effect
      // then drops the caret into the prompt box. (⌘+N is OS-reserved on macOS; ⌃+N is the dependable one.)
      if (((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) ||
          ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'Home'))) {
        e.preventDefault(); e.stopPropagation(); setSel('new'); return
      }
      // @@@ nav mode passthrough - while ON, EVERY key is forwarded raw to the session pane and nothing else
      // fires (no list nav, no page scroll). Esc is forwarded too (it cancels the agent's menu); a SECOND Esc
      // within 600ms exits nav mode. preventDefault/stopPropagation keep keys from leaking anywhere else.
      if (navMode && active !== 'new') {
        e.preventDefault(); e.stopPropagation()
        if (e.key === 'Escape') {
          sendRawKey('Escape')
          const now = Date.now()
          if (now - lastEscRef.current < 600) setNavMode(false)
          lastEscRef.current = now
          return
        }
        const named = RAWKEY[e.key]
        if (named) { sendRawKey(named); return }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) sendRawKey(e.key)
        return
      }
      // a completion menu owns navigation/commit/dismiss while it's open — on the New Session prompt
      // (@-mention) OR a session's ❯ inbox (slash). The capture-phase listener claims Enter before the
      // inbox textarea's own onKeyDown, so picking a command never also dispatches the line.
      if (menu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navMenu(1); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); navMenu(-1); return }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return }
        if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
      }
      // Esc closes the whole interface (App delegates it here so the menu can claim it first, above).
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // inside a multi-line input, ↑/↓ first walk the caret between (possibly wrapped) lines; only at
        // the visual edge — no line to move to in that direction — do they fall through to tab nav.
        const el = e.target
        if (el?.tagName === 'TEXTAREA' && !caretAtEdge(el, e.key === 'ArrowUp' ? 'up' : 'down')) return
        e.preventDefault(); e.stopPropagation()
        const i = order.indexOf(active)
        const ni = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
        setSel(order[ni]); return
      }
      if (e.key === 'Enter' && !e.shiftKey && active === 'new') { e.preventDefault(); e.stopPropagation(); submit() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setSel])

  const isTextField = (t) => t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)

  // @@@ keep input focus - mousedown is what MOVES focus, so clicking panel chrome (a tab button, the
  // list's empty padding, the header) would blur the docked input and leave you with nowhere to type. We
  // cancel the focus shift for any target that isn't itself a text field or the live terminal (which owns
  // its own selection): preventDefault on mousedown blocks the blur, not the click, so buttons still fire
  // their onClick. (Switching to a different tab refocuses via the tab-switch effect; this is what saves
  // clicking the ALREADY-active tab, which never re-runs that effect.)
  const keepFocus = (e) => {
    e.stopPropagation()   // also guards the backdrop from closing on an inside click
    const t = e.target
    if (isTextField(t)) return
    if (t.closest && t.closest('.si-term-body')) return
    e.preventDefault()
  }

  // @@@ no browser context menu - keepFocus can't save a right-click: the NATIVE context menu seizes
  // focus when it opens (a blur a mousedown handler can't prevent), so the only fix is to stop the menu
  // itself. We suppress it across the panel — terminal-app feel — EXCEPT over a text field, where the menu
  // stays on the already-focused box (no focus lost) and its paste entry is genuinely useful.
  const blockMenu = (e) => { if (!isTextField(e.target)) e.preventDefault() }

  return (
    <div className="si-backdrop" onMouseDown={onClose} style={open ? undefined : { display: 'none' }}>
      <div className="si-panel" onMouseDown={keepFocus} onContextMenu={blockMenu}>
        <aside className="si-list">
          <div className="si-list-head">// {t('session.title')}</div>
          <button className={active === 'new' ? 'si-item new on' : 'si-item new'} title={t('session.newSessionTitle')} onClick={() => setSel('new')}>
            ＋ {t('session.newSession')}
          </button>
          {sessions.map((s) => (
            <button
              key={s.id}
              className={active === s.id ? 'si-item on' : 'si-item'}
              style={{ '--ov': labelColor(s.id) }}
              onClick={() => setSel(s.id)}
            >
              <Avatar seed={s.id} status={s.status} title={`${sessionName(s)} · ${t(`status.${s.status}`)}`} />
              <span className="si-dot" style={{ background: STATUS_DOT[s.status] || '#93a1a1' }} />
              <span className="si-name">{sessionName(s)}</span>
              <span className="si-st">{t(`status.${s.status}`)}</span>
            </button>
          ))}
        </aside>

        <section className={active === 'new' ? 'si-content is-new' : 'si-content is-session'}>
          {active === 'new' && (
            <div className="si-new-center">
              <div className="si-avatar">◠‿◠</div>
              <div className="si-ask">{t('session.ask')}</div>
              <div className="si-inputwrap">
                <textarea
                  ref={taRef}
                  className="si-input"
                  rows={1}
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); syncMenu(e.target) }}
                  onSelect={(e) => syncMenu(e.target)}
                  onBlur={() => setMenu(null)}
                  placeholder={t('session.inputPlaceholder')}
                  spellCheck={false}
                  disabled={sending}
                />
                {menu && menu.kind === 'mention' && (
                  <ul className="mention-menu" role="listbox">
                    <li className="mention-head">// {menu.query ? `@${menu.query}` : t('session.menuSpecNodes')} — {t('session.menuHint')}</li>
                    {menu.items.map((it, i) => (
                      <li
                        key={it.id}
                        role="option"
                        aria-selected={i === menu.index}
                        className={i === menu.index ? 'mention-item on' : 'mention-item'}
                        onMouseDown={(e) => { e.preventDefault(); accept(it) }}
                        onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
                      >
                        <span className="mention-dot" style={{ background: STATUS_DOT[it.status] || '#93a1a1' }} />
                        <span className="mention-id">@{highlight(it.id, menu.query)}</span>
                        <span className="mention-path">{specPath(it.path)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* config-preset palette — same `/` dropdown, opening downward under the centered box. */}
                {menu && menu.kind === 'config' && slashMenu(false, menu.query ? `/${menu.query}` : t('session.menuPresets'))}
              </div>
              <div className="si-hint">
                {t('session.hint.before')}<code>@</code>{t('session.hint.mid')}<code>/</code>{t('session.hint.after')}
              </div>
            </div>
          )}
          {/* @@@ persistent session pane - stays MOUNTED even while the "new session" tab is active
              (just hidden via display:none) so the terminals' WebSockets + scroll survive the tab
              switch. Earlier this branch was a ternary alternative to "new", so visiting "new" tore
              down every SessionTerm and coming back forced a reconnect/repaint — the "reload" feel. */}
          <div
            className="si-session-wrap"
            style={{ display: active === 'new' ? 'none' : 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}
          >
              <div className="si-term">
                <div className="si-term-head">
                  <span className="si-dot" style={{ background: STATUS_DOT[selSession?.status] || '#93a1a1' }} />
                  <span className="si-th-name">{sessionName(selSession) || active}</span>
                  <span className="si-th-st">{selSession?.status ? t(`status.${selSession.status}`) : ''}</span>
                  {selSession?.merges > 0 && <span className="si-merges" title={t('session.mergesTitle')}>{t('session.merges', { n: selSession.merges })}</span>}
                  <div className="si-actions">
                    {selSession?.status !== 'offline' && (
                      <button
                        className={navMode ? 'si-act nav on' : (menuById[active] ? 'si-act nav suggest' : 'si-act nav')}
                        title={t('session.navTitle')}
                        onClick={() => setNavMode((v) => !v)}
                      >⌨ {t('session.navBtn')}</button>
                    )}
                    {selSession?.status === 'offline' && <button className="si-act go" onClick={() => act('resume')}>{t('session.relaunch')}</button>}
                    {/* no manual "request review": agents propose review themselves at the stop-gate
                        (`session done --propose merge`). proposals (review/done/close-pending) resolve to
                        merge / close */}
                    {(selSession?.status === 'review' || selSession?.status === 'done') && <button className="si-act go" onClick={() => act('merge')}>{t('session.merge')}</button>}
                    <button className="si-act kill" onClick={() => act('close', () => setSel('new'))}>{t('session.close')}</button>
                  </div>
                </div>
                {selSession?.promptPreview && (
                  /* the originating prompt — "what was this session asked to do?" — full text on hover */
                  <div className="si-th-prompt" title={selSession.prompt || ''}>{t('session.asked', { text: selSession.promptPreview })}</div>
                )}
                <div className="si-term-body" style={{ position: 'relative' }}>
                  {/* every opened session's terminal stays mounted; only the active one is shown */}
                  {[...opened].map((id) => (
                    <div key={id} className="si-term-layer" style={{ position: 'absolute', inset: 0, display: id === active ? 'block' : 'none' }}>
                      {/* active → this pane is the only one that holds a WebGL context (see SessionTerm). */}
                      <SessionTerm sessionId={id} active={id === active} onMenu={reportMenu} />
                    </div>
                  ))}
                  {selSession?.status === 'offline' && (
                    <div className="si-offline">
                      <div className="si-offline-msg">{t('session.offlineMsg')}</div>
                      <div className="si-offline-sub">{t('session.offlineSubBefore')}<code>{active.slice(0, 8)}…</code>{t('session.offlineSubAfter')}</div>
                      <button className="si-act go big" onClick={() => act('resume')}>{t('session.relaunchResume')}</button>
                    </div>
                  )}
                </div>
              </div>
              {navMode ? (
                // nav mode replaces the prompt box: keys go straight to the pane (handled at the window level).
                <div className="si-bottom nav" onClick={() => setNavMode(false)} title={t('session.navExit')}>
                  <span className="si-nav-ind">{t('session.navInd')}</span>
                  <span className="si-nav-help">{t('session.navHelp')}</span>
                </div>
              ) : (
                <div className={sendErr ? 'si-bottom err' : 'si-bottom'}>
                  <span className="si-prompt">❯</span>
                  <textarea
                    ref={msgRef}
                    className="si-input"
                    rows={1}
                    value={msg}
                    onChange={(e) => { setMsg(e.target.value); if (sendErr) setSendErr(false); syncMenu(e.target) }}
                    onSelect={(e) => syncMenu(e.target)}
                    onBlur={() => setMenu(null)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); sendMsg() } }}
                    placeholder={selSession?.status === 'offline' ? t('session.msgOffline') : t('session.msgPlaceholder')}
                    spellCheck={false}
                    disabled={selSession?.status === 'offline'}
                  />
                  {sendErr && <span className="si-send-err" role="alert">{t('session.msgError')}</span>}
                  {/* slash-command menu — docked at the bottom, so it opens UPWARD (`up`) above the ❯ box. */}
                  {menu && menu.kind === 'slash' && slashMenu(true, menu.query ? `/${menu.query}` : t('session.menuCommands'))}
                </div>
              )}
          </div>
        </section>
      </div>
    </div>
  )
}
