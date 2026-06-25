import { useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'
import SessionGraph from './SessionGraph.jsx'
import { loadConfig, setSessionSort } from './data.js'
import { reorderPlan } from './sessionReorder.js'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { STATUS_COLOR, sessionHeadline } from './session.js'
import { SessionRow } from './SessionWindow.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import { ProofOverlay } from './ReviewProof.jsx'
import { boardCommandsFor } from './sessionCommands.js'
import { useT } from './i18n/index.jsx'

// @@@ SessionInterface - the Enter surface. TWO panes: a left session list and a right content area
// that MORPHS by what's focused in the list:
//   · "New Session" focused -> input box + avatar CENTERED (terminal vibe). Nothing is prefilled — the
//     focused spec node is instead the FIRST @-mention suggestion, so you opt into targeting it by typing
//     `@`. Enter launches a real session, then we SWITCH to it.
//   · "View Session Relationship" focused -> the content becomes the live monitor GRAPH (SessionGraph): the
//     who-watches-whom network of all sessions, filling the pane. Its trigger (was a fullscreen `t` overlay)
//     is a compact icon button paired with the ＋ New Session button in a top ROW — neither sits in the ↑/↓
//     path to a session. New ⇄ graph is a HORIZONTAL axis: → from an EMPTY New Session enters the graph, ←
//     leaves it. Inside, hjkl walk the web and clicking a node (or ⏎) switches to that session's tab.
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

// @@@ nav-mode keymap - DOM KeyboardEvent.key → the BASE key NAME our /rawkey backend feeds to tmux
// send-keys. Modifier combos (⌃/⌥/⌘) are encoded separately by navKeyToken below; this maps only the
// non-printable bases. Escape is handled separately (it cancels a menu, and a second Esc exits nav mode),
// so it's intentionally absent here.
const RAWKEY = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', ' ': 'Space' }

// @@@ navKeyToken - encode a keydown into the tmux-style token /rawkey forwards (`C-r`, `M-b`, `S-Tab`,
// `C-M-x`, or a bare char / named key). Nav mode drives the agent's REAL terminal, so modifier combos must
// REACH tmux, not be dropped. A terminal knows only three modifiers, so we map ⌃→`C-`, ⌥/⌘→`M-` (the
// Command key has no terminal meaning, so it folds into Meta beside Option — the same modifier a mac user
// already reaches for), and Shift→`S-` on a NAMED key (e.g. S-Tab); a modified letter carries Shift as its
// case (`M-B`) and a bare shifted printable already carries its glyph. The BASE of a MODIFIED letter/digit
// is read from e.code, NOT e.key: the moment a
// real modifier is held, e.key is unreliable — ⌥B prints '∫' on a mac, ⌃-letters print control chars — but
// the physical KeyB / Digit3 code is stable. Returns null when there is no sendable base (a lone modifier,
// an unmapped non-printable), so those keys are simply swallowed rather than forwarded as junk.
function navKeyToken(e) {
  const named = RAWKEY[e.key]
  const mod = e.ctrlKey || e.altKey || e.metaKey
  let base = null
  if (named) base = named
  else if (mod) {
    // a modified LETTER carries Shift as its CASE (`M-B`), never an `S-` prefix — tmux can't parse `S-`
    // on a printable, and case is how Meta-shift is actually spelled.
    if (/^Key[A-Z]$/.test(e.code)) base = e.shiftKey ? e.code.slice(3) : e.code.slice(3).toLowerCase()
    else if (/^Digit[0-9]$/.test(e.code)) base = e.code.slice(5)
    else if (e.key.length === 1) base = e.key
  } else if (e.key.length === 1) base = e.key
  if (base == null) return null
  let pfx = ''
  if (e.ctrlKey) pfx += 'C-'
  if (e.altKey || e.metaKey) pfx += 'M-'
  if (e.shiftKey && named) pfx += 'S-'   // `S-` only for NAMED keys (e.g. S-Tab, S-Up); the backend maps it
  return pfx + base
}

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

// the row's trailing source tag, mirroring CC: `(user)` / `(project)` / `[skill]` / `built-in`. `[board]`
// flags one of OUR commands (close/merge/nav/proof) — it runs HERE, not in the agent (see boardCommandsFor).
const SRC_TAG = { user: '(user)', project: '(project)', skill: '[skill]', 'built-in': 'built-in', board: '[board]' }

// bold the first case-insensitive hit of the query inside a label (the part the user has typed so far).
function highlight(text, q) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<b className="mention-hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>
}

export default function SessionInterface({ sessions, specs = [], focusNode, open, sel, setSel, seed, onSeedConsumed, onClose, onPickSession, reload }) {
  const t = useT()
  const [prompt, setPrompt] = useState('')    // the New Session tab's own draft (its boarding-switch cache)
  const [menu, setMenu] = useState(null)      // completion dropdown: { kind:'mention'|'config'|'slash', items, index, start, end, query }
  const [ctxMenu, setCtxMenu] = useState(null) // session-row right-click menu { x, y, session } — the RENAME gesture lives here, on the board's session list
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
  // @@@ proof overlay - the review-proof iframe's open state lives HERE (not inside the button) so the typed
  // `/proof` board command and the header button drive the ONE same overlay (see the command registry below).
  const [proofOpen, setProofOpen] = useState(false)
  // @@@ graph legend - the relationship tab's `?` keymap modal. LIFTED here (not inside SessionGraph) so the
  // console's own Esc handler can close it before closing the console — the console's window listener runs
  // first, so it must own this Esc precedence (see the key router below).
  const [graphLegend, setGraphLegend] = useState(false)
  // @@@ relationship-graph edges - the live monitor + comms network for the "View Session Relationship" tab,
  // polled HERE in the always-mounted console rather than inside SessionGraph. The graph tab REMOUNTS on every
  // reselect, so a poll living inside it would cold-refetch each time and flash an edgeless placeholder that
  // then re-lays-out and jumps once the first poll lands. Owning the edges one level up keeps them in hand
  // across reselects (instant FINAL layout, no jump) and keeps the web current in the BACKGROUND while the
  // console is open — a new watch / rising comms count appears live, no tab round-trip. `graphEdgesLoaded`
  // lets the graph hold its first reveal until the real edges land, so the first visible frame is already the
  // final clustered web. The NODES are the preloaded `sessions`; only these observational edges are polled.
  const [graphEdges, setGraphEdges] = useState([])
  const [graphEdgesLoaded, setGraphEdgesLoaded] = useState(false)
  useEffect(() => {
    if (!open) return                                  // only while the console is open (the graph's only home)
    let live = true
    const pull = async () => {
      try {
        const res = await fetch('/api/sessions/graph')
        const g = await res.json()
        if (live) setGraphEdges(Array.isArray(g.edges) ? g.edges : [])
      } catch { /* transient; keep the last good edges */ }
      finally { if (live) setGraphEdgesLoaded(true) }
    }
    pull()
    const id = setInterval(pull, 4000)
    return () => { live = false; clearInterval(id) }
  }, [open])
  // @@@ file attach - a pasted/dropped/picked file is uploaded to the backend (= worker) machine's /tmp and
  // its returned path is spliced into the prompt. `uploading` guards/announces the in-flight POST; `uploadErr`
  // is the fail-loud flag; `dragTarget` lights the surface ('new' | 'msg') a file is currently dragged over.
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState(false)
  const [dragTarget, setDragTarget] = useState(null)
  const [attachAt, setAttachAt] = useState(null)  // surface the in-flight/last upload targets — drives the spinner + error placement
  const lastEscRef = useRef(0)
  const taRef = useRef(null)
  const msgRef = useRef(null)
  const panelRef = useRef(null)
  const termRef = useRef(null)
  const fileRef = useRef(null)         // the one hidden <input type=file>; the attach buttons trigger it
  const fileTargetRef = useRef('new')  // which surface the pending pick inserts into ('new' | 'msg')

  // @@@ drag-reorder ([[session-reorder]]) - a POINTER drag started ONLY from the per-row handle (mousedown →
  // window mousemove past a threshold → mouseup). NOT native HTML5 DnD: that needs an un-preventDefaulted
  // mousedown, but keepFocus preventDefaults the row mousedown to keep the ❯ box focused — the two can't both
  // win, and native dnd on a span-in-a-button was unreliable for a real mouse anyway. A pointer drag is immune
  // to that preventDefault (it rides window mousemove/mouseup), so the handle's mousedown can flow through
  // keepFocus untouched — the input KEEPS focus — while the drag still works. dropHint lights the insertion line.
  const [dropHint, setDropHint] = useState(null)
  const applyReorder = async (plan) => {
    if (!plan) return
    try { await Promise.all(plan.updates.map((u) => setSessionSort(u.id, u.key))) }
    catch { /* the next board poll reconciles */ }
    reload?.()
  }
  // start a drag from a row's handle. Do NOT stopPropagation: keepFocus then still runs and preventDefaults the
  // mousedown, so the docked ❯ input never loses focus — and preventDefault does not stop the window
  // mousemove/mouseup this drag rides on. The whole gesture lives on `window`, so it survives the re-render
  // applyReorder triggers and works even if the cursor leaves the list.
  const onHandleDown = (e, s) => {
    if (e.button !== 0) return
    const startY = e.clientY
    const list = sessions               // snapshot for this gesture (a drag is far shorter than the 4s poll)
    let dragging = false, hint = null
    const onMove = (ev) => {
      if (!dragging) { if (Math.abs(ev.clientY - startY) < 4) return; dragging = true }
      ev.preventDefault()
      const rows = [...(panelRef.current?.querySelectorAll('.si-item') || [])]
      hint = null
      for (const el of rows) {
        const r = el.getBoundingClientRect()
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) { hint = { id: el.dataset.sid, place: ev.clientY < r.top + r.height / 2 ? 'before' : 'after' }; break }
      }
      if (!hint && rows.length && ev.clientY > rows[rows.length - 1].getBoundingClientRect().bottom) hint = { end: true }
      setDropHint(hint && !hint.end ? hint : null)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp)
      setDropHint(null)
      if (!dragging) return
      let beforeId
      if (hint?.end) beforeId = null
      else if (hint) beforeId = hint.place === 'before' ? hint.id : (list[list.findIndex((x) => x.id === hint.id) + 1]?.id ?? null)
      else return
      applyReorder(reorderPlan(list, s.id, beforeId))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  // @@@ dragHandle - the grip at the far right of row 2, the ONLY drag affordance. Its mousedown starts a
  // POINTER drag (onHandleDown) and flows through keepFocus so the ❯ input keeps focus; its click is stopped so
  // grabbing the grip never switches tab. The row body keeps every other gesture — click, double-click, focus.
  const dragHandle = (s) => (
    <span
      className="si-drag-handle"
      title={t('session.dragHandle')}
      onMouseDown={(e) => onHandleDown(e, s)}
      onClick={(e) => e.stopPropagation()}
    >⠿</span>
  )

  // @@@ the vertical ↑/↓ ring - New Session, then each live session. The relationship graph is DELIBERATELY
  // NOT in this ring: it sits on a HORIZONTAL axis off New (New's → enters it when the prompt is empty, the
  // graph's ← returns) so it never blocks the path down to a session. 'graph' is a valid `sel` all the same.
  const order = useMemo(() => ['new', ...sessions.map((s) => s.id)], [sessions])
  const active = sel === 'graph' || order.includes(sel) ? sel : 'new'
  // @@@ stale-tab fallback - a selected session can leave the board out from under you: closed via the
  // header here, ended on its own, or closed from another window. This removal — not the close button — is
  // what drives tab fallback. If `sel` no longer resolves (you're still on the now-gone tab) we land on New
  // Session; if you'd already switched to another valid tab the close stands and `sel` still resolves, so
  // this never fires. Mirrors `active`'s validity test so the lifted `sel` is never left stale behind it.
  useEffect(() => {
    if (sel !== 'graph' && !order.includes(sel)) setSel('new')
  }, [order, sel, setSel])
  const focusId = focusNode?.id || null
  const selSession = sessions.find((s) => s.id === active)
  // liveness (NOT the lifecycle label) gates the terminal vs the relaunch panel — see [[state]]/[[session-console]].
  // noLivePane: no live tmux to attach or message (offline, incl a never-launched `queued`). showRelaunch:
  // offer to resume — every dead session EXCEPT `queued`, which self-starts as a slot frees, so it gets no button.
  const noLivePane = selSession?.liveness === 'offline'
  const showRelaunch = noLivePane && selSession?.status !== 'queued'
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
  useEffect(() => { setNavMode(false); setSendErr(false); setMenu(null); setProofOpen(false) }, [active])
  useEffect(() => { if (selSession?.liveness === 'offline') setNavMode(false) }, [selSession?.liveness])
  // @@@ refocus on nav exit - leaving nav mode (chord, double-Esc, header button, or bottom-bar click)
  // hands the keyboard back to the bottom message box, so you can type without re-clicking it. Guarded to
  // the on→off edge for a live session tab; a tab switch or going offline exits nav too, but the tab-focus
  // effect owns focus there (and an offline tab has no input box to land in).
  const wasNavRef = useRef(false)
  useEffect(() => {
    if (wasNavRef.current && !navMode && active !== 'new' && selSession?.liveness !== 'offline') msgRef.current?.focus()
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
  // relaunch panel, not a dead terminal). Liveness — NOT the lifecycle label — gates this: a session whose
  // process is gone reads liveness 'offline' whatever its authored lifecycle (asking/review/error/…), so we
  // never mount a tmux client against a dead id (which would leak tmux's bare "no sessions"). queued reads
  // 'offline' too (never launched), so it also stays unmounted. This is the key experience — no warmth is
  // traded for laziness.
  const [opened, setOpened] = useState(() => new Set())
  useEffect(() => {
    setOpened((prev) => {
      const next = new Set()
      for (const s of sessions) if (s.liveness !== 'offline') next.add(s.id)
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
      // the graph tab has no docked input — it owns the keyboard itself (hjkl/⏎/?), so focus nothing.
      else if (selSession && selSession.liveness !== 'offline') msgRef.current?.focus()
    }, 0)
    return () => clearTimeout(id)
  }, [open, active, selSession?.liveness])

  // @@@ auto-grow - the new-session box grows with its content (line wraps + newlines) up to the CSS
  // max-height, then scrolls. Reset to 0/auto first so it can also shrink when text is deleted. Re-runs
  // on `open` too, so a reopen with a cached multi-line draft restores its height instead of collapsing.
  useEffect(() => {
    const ta = taRef.current
    if (!ta || active !== 'new' || !open) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt, active, open])

  // @@@ docked input auto-grow - the session ❯ box grows with its content too, but UPWARD: the bar is
  // absolutely anchored to the wrap's bottom (see CSS), so added lines extend over the terminal's lower
  // edge and never push the terminal or any sibling. It caps at HALF the terminal's height — only there
  // does overflow-y kick a scrollbar in; below the cap the textarea is exactly tall enough, so no scrollbar.
  useEffect(() => {
    const ta = msgRef.current
    if (!ta || active === 'new' || !open) return
    const maxH = Math.round((termRef.current?.clientHeight || 360) * 0.5)
    ta.style.maxHeight = `${maxH}px`
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`
  }, [msg, active, open])

  // @@@ composeLaunch - the grammar `/<preset> @<node>… <free text>` assembles ONE launch prompt:
  //   · /<preset>  → a config preset (GET /api/config) whose `body` is the contract the agent runs.
  //   · @<node>…   → the targets; resolved (via the @-mention specs) to `@id — path` lines that REPLACE the
  //                  body's {{targets}} placeholder. No @ = a no-target note: use the prompt's scope, else ask the human (never assume a node).
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
      : '(No target was @-mentioned. If the prompt names the scope, use it; otherwise ask the human to define the scope before proceeding — unless this task needs no scope, in which case proceed.)'
    const body = preset.body.includes('{{targets}}')
      ? preset.body.replace('{{targets}}', targets)
      : `${preset.body}\n\n${targets}`
    return free ? `${body}\n\n${free}` : body
  }

  // launch a real session, then STAY on the New tab — no tab switch. The new session just appears in the
  // list below once `reload` (and the 4s poll) picks it up, so you can fire off several in a row. Removing
  // the old jump-to-the-new-session also kills its race with the stale-tab fallback, which used to bounce
  // you back to New whenever the backend hadn't listed the session yet by the time the post-create reload
  // landed — the unstable "sometimes the new tab, sometimes back to New" jump.
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
      await reload?.()
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
      // the board's own commands (coloured, run HERE) lead the menu; CC's commands follow. matchSlash is a
      // stable prefix rank, so the board set keeps its lead within each score band.
      const board = boardCmds.map((c) => ({ name: c.name, description: t(c.descKey), board: true, color: c.color }))
      const items = matchSlash([...board, ...slashCmds], sm[1])
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
      // a BOARD command is the one row that RUNS rather than inserts: it IS the board's control plane (the
      // typed twin of its header button), so accepting it does the thing — close / merge / nav / open proof —
      // exactly as clicking the button would. CC's own commands still only insert text (you Enter to dispatch).
      if (item.board) { const c = boardCmds.find((x) => x.name === item.name); setMsg(''); setMenu(null); c?.run(); return }
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
        // a BOARD command carries its own identity hue (sc-<color> sets --sc), tinting BOTH its `/name` and
        // its `[board]` tag the same colour as its header button. CC commands → source tag; presets → kind.
        const tag = it.board ? 'board' : (it.source ?? it.kind)
        const hue = it.board ? ` sc-${it.color}` : ''
        return (
          <li
            key={`${tag}:${it.name}`}
            role="option"
            aria-selected={i === menu.index}
            className={`${i === menu.index ? 'mention-item on' : 'mention-item'}${hue}`}
            onMouseDown={(e) => { e.preventDefault(); accept(it) }}
            onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
          >
            <span className={it.board ? 'slash-name board' : 'slash-name'}>/{highlight(it.name, menu.query)}</span>
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
    // @@@ board command → run, don't dispatch - a line that is EXACTLY `/<name>` of an available board
    // command (close, merge, nav, proof) runs that command HERE instead of being sent to the agent — the
    // same action its header button fires, from the same registry. This generalises the old `/exit`-only
    // intercept: `/exit` still closes this session directly (the no-prompt removal the row-menu Close does),
    // and sending any of these words to a live agent would only drive the agent's own process, not the board.
    // The menu's accept() already runs a board command on pick; this covers the no-menu submit (line typed or
    // pasted whole). trim() covers the trailing space the `/` completion leaves and a stray newline.
    const cmd = boardCmds.find((c) => text.trim() === `/${c.name}`)
    if (cmd) { setMsg(''); setMenu(null); cmd.run(); return }
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

  // @@@ file attach - paste, drop, or pick a file → POST it to /api/uploads (the backend writes it to the
  // worker machine's /tmp) → splice the returned path into the active input. The path is the whole handoff:
  // the agent runs on that same machine, so `/tmp/spexcode-uploads/<file>` is a path it can just read. Works
  // on both surfaces; `target` ('new' | 'msg') picks which draft receives the path. Fail-loud: an upload that
  // doesn't return a path flags `uploadErr` instead of silently dropping the file.
  const uploadFile = async (file) => {
    const fd = new FormData()
    fd.append('file', file, file.name || 'pasted')
    const res = await fetch('/api/uploads', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`upload ${res.status}`)
    const data = await res.json().catch(() => null)
    if (!data?.path) throw new Error('upload: no path')
    return data.path
  }
  // splice `text` at the caret of a textarea (ref+value+setter), padding with spaces so it never glues to
  // neighbouring words, then drop the caret after it. The auto-grow effects re-run on the new value.
  const insertAtCaret = (ref, value, setValue, text) => {
    const el = ref.current
    const start = el ? el.selectionStart : value.length
    const end = el ? el.selectionEnd : value.length
    const pre = value.slice(0, start)
    const insert = (pre && !/\s$/.test(pre) ? ' ' : '') + text + ' '
    setValue(pre + insert + value.slice(end))
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const c = pre.length + insert.length
      el.setSelectionRange(c, c)
    })
  }
  // upload every file in a list (paste/drop/pick), then insert the joined /tmp paths into the target surface.
  const attachFiles = async (fileList, target) => {
    const files = [...(fileList || [])]
    if (!files.length || uploading) return
    setUploadErr(false)
    setAttachAt(target)
    setUploading(true)
    try {
      const paths = []
      for (const f of files) paths.push(await uploadFile(f))
      if (target === 'new') insertAtCaret(taRef, prompt, setPrompt, paths.join(' '))
      else insertAtCaret(msgRef, msg, setMsg, paths.join(' '))
    } catch {
      setUploadErr(true)
    } finally {
      setUploading(false)
    }
  }
  // a paste carrying file(s) (a screenshot, a copied file) attaches them instead of pasting text; a plain
  // text paste has no files and falls through to the textarea's normal behaviour untouched.
  const onPasteFiles = (e, target) => {
    const files = e.clipboardData?.files
    if (files && files.length) { e.preventDefault(); attachFiles(files, target) }
  }
  // drag-drop onto an input surface: highlight while a file hovers, attach on drop.
  const onDropFiles = (e, target) => {
    e.preventDefault(); setDragTarget(null)
    attachFiles(e.dataTransfer?.files, target)
  }
  const onDragOverFiles = (e, target) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragTarget(target) }
  }
  // open the file picker, remembering which surface its result should land in.
  const pickFiles = (target) => { fileTargetRef.current = target; fileRef.current?.click() }

  // lifecycle actions — thin POSTs to the session state machine, then reload the board. No tab jump on
  // close: the reload drops the closed session from the board and the stale-tab fallback above lands the
  // viewer on New Session only if they're still on that tab.
  const act = async (verb) => {
    await fetch(`/api/sessions/${active}/${verb}`, { method: 'POST' }).catch(() => {})
    await reload?.()
  }

  // @@@ board commands - ONE registry (sessionCommands.js) feeds BOTH the header buttons AND the `❯` inbox's
  // `/`-command interception, so a typed `/<name>` and the clicked button are the same action with the same
  // identity colour. `runners` binds each command name to the closure that DOES it — the SAME closure the
  // button's onClick fires — so the two surfaces can never drift. `boardCmds` is that registry narrowed to
  // the commands available in the current session state (nav whenever live; proof/merge at review/done; exit
  // whenever live). Used by buildMenu (to list them, coloured, atop the inbox `/` menu), accept/sendMsg (to
  // RUN one), and the action row (to render the buttons).
  const runners = {
    nav: () => setNavMode((v) => !v),
    proof: () => setProofOpen(true),
    merge: () => act('merge'),
    exit: () => act('close'),
  }
  const boardCmds = boardCommandsFor(selSession?.status, runners)
  // @@@ window-level list nav - ↑/↓ move the selection regardless of focus; Enter on New launches.
  const stateRef = useRef({})
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey, graphLegend, setGraphLegend }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey, graphLegend, setGraphLegend } = stateRef.current
      if (!open) return   // panel hidden (board not the active surface): nothing here listens
      // @@@ reserved nav-toggle (⌥/⌘+I) - the dependable keyboard entry/exit, alongside the header button.
      // ⌥I and ⌘I are RESERVED: handled before everything else (so they work whether nav mode is on or off),
      // never forwarded to tmux, never overridable by the app. Matched by e.code (the physical I key) because
      // ⌥I on a mac prints a dead-key glyph rather than 'i', which a plain e.key check would miss.
      const isI = e.code === 'KeyI' || e.key === 'i' || e.key === 'I'
      if ((e.altKey || e.metaKey) && isI && active !== 'new' && active !== 'graph') {
        e.preventDefault(); e.stopPropagation(); setNavMode((v) => !v); return
      }
      // @@@ jump to New Session - ⌃/⌘+N (also ⌃/⌘+↑/Home) snaps the selection to the New Session tab from
      // anywhere in the panel, no arrowing up the whole list. Kept ABOVE both the relationship-tab branch and
      // the nav-mode passthrough so it works from the graph and even while raw-key mode forwards to a pane.
      // The tab-switch focus effect then drops the caret into the prompt box. (⌘+N is OS-reserved on macOS.)
      if (((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) ||
          ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'Home'))) {
        e.preventDefault(); e.stopPropagation(); setSel('new'); return
      }
      // @@@ relationship-tab keys - the graph fills the pane and walks by hjkl ALONE (handled in its own
      // listener, which runs after ours). Arrows are NOT the graph's: ← returns to New Session (the spatial
      // twin of New's → into the graph), and the other arrows are inert here — we swallow them so they never
      // scroll or fall through to tab nav. Esc closes the graph's `?` legend first (if open), else the console;
      // ⌃/⌘+N above still escapes to New. We let hjkl / ⏎ / ? pass UNTOUCHED to the graph's own listener.
      if (active === 'graph') {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation()
          if (graphLegend) setGraphLegend(false); else onClose()
          return
        }
        if (graphLegend) { if (e.key.startsWith('Arrow')) { e.preventDefault(); e.stopPropagation() } return }
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setSel('new'); return }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); return }
        return
      }
      // @@@ nav mode passthrough - while ON, EVERY key is forwarded raw to the session pane and nothing else
      // fires (no list nav, no page scroll), so the human drives the agent's terminal directly — INCLUDING
      // ⌃/⌥/⌘ + key combos (encoded by navKeyToken into a `C-r` / `M-b` / `S-Tab` token tmux understands).
      // The only keys NOT forwarded are the ones claimed above: the reserved ⌥/⌘+I toggle and the
      // jump-to-New chords. Esc is forwarded too (it cancels the agent's menu); a SECOND Esc within 600ms
      // exits nav mode. preventDefault/stopPropagation keep keys from leaking anywhere else.
      if (navMode && active !== 'new') {
        e.preventDefault(); e.stopPropagation()
        if (e.key === 'Escape') {
          sendRawKey('Escape')
          const now = Date.now()
          if (now - lastEscRef.current < 600) setNavMode(false)
          lastEscRef.current = now
          return
        }
        const token = navKeyToken(e)
        if (token) sendRawKey(token)
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
      // Esc closes the whole interface (App delegates it here so the menu can claim it first, above). The
      // relationship tab's Esc is owned by its branch up top (legend-then-console); this is the other tabs'.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      // @@@ New → graph - from New Session, → crosses into the relationship graph, but ONLY when the prompt is
      // EMPTY, so a non-empty draft still moves the caret normally. The graph's ← crosses back (see its branch
      // above). This is the horizontal twin of the vertical ↑/↓ ring, mirroring the New/graph button pair.
      if (active === 'new' && e.key === 'ArrowRight' && (taRef.current?.value ?? '') === '') {
        e.preventDefault(); e.stopPropagation(); setSel('graph'); return
      }
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

  // focus the docked input — whichever box is currently mounted (the New-tab prompt when it's up, else the
  // session ❯ box; both null in nav mode / offline, where there's no input to land in).
  const refocusInput = () => {
    const el = taRef.current || msgRef.current
    if (el) requestAnimationFrame(() => el.focus())
  }

  // @@@ keep input focus - mousedown is what MOVES focus, so a LEFT click on panel chrome (a tab button, the
  // list's empty padding, the header) would blur the docked input and leave you with nowhere to type. We
  // cancel that focus shift for any left-click target that isn't itself a text field: preventDefault on
  // mousedown blocks the blur, not the click, so buttons still fire their onClick. The terminal is the one
  // exception — it owns its own text selection. RIGHT clicks are NOT our concern here: focus retention on a
  // right-press belongs to the contextmenu blocker below (refocusInput), and preventDefault on a right-button
  // mousedown SUPPRESSES the subsequent contextmenu in some browsers (Safari/Firefox), which would silently
  // kill the rename pop-over. So we touch left clicks only — right clicks fall straight through to onContextmenu.
  const keepFocus = (e) => {
    e.stopPropagation()   // also guards the backdrop from closing on an inside click (any button)
    if (e.button !== 0) return
    const t = e.target
    if (isTextField(t)) return
    // the terminal owns its own text selection; the relationship graph owns its own mousedown (ReactFlow's
    // pan / drag-to-monitor / node click) — preventing default on either would break those gestures.
    if (t.closest && (t.closest('.si-term-body') || t.closest('.session-graph'))) return
    e.preventDefault()
  }

  // @@@ no browser context menu - blocking the menu must NOT rely on a React onContextMenu (unreliable for
  // repeated right-clicks). A native WINDOW listener in the CAPTURE phase intercepts every contextmenu over
  // the panel — first, double, triple click alike — and cancels it: a terminal-app feel, and crucially the
  // menu can no longer seize focus. We also refocus the docked input afterwards, since the right-button press
  // itself may already have blurred it (preventDefault on the menu can't undo a blur the mousedown caused).
  // This blocks EVERYWHERE in the panel, list rows included — preventDefault here does not stop propagation,
  // so a row's own onContextMenu still fires and opens the rename pop-over; we just also kill the OS menu.
  useEffect(() => {
    if (!open) return
    const onMenu = (e) => {
      if (!panelRef.current?.contains(e.target)) return
      e.preventDefault()
      refocusInput()
    }
    window.addEventListener('contextmenu', onMenu, true)
    return () => window.removeEventListener('contextmenu', onMenu, true)
  }, [open])

  return (
    <>
    <div className="si-backdrop" onMouseDown={onClose} style={open ? undefined : { display: 'none' }}>
      <div className="si-panel" ref={panelRef} onMouseDown={keepFocus}>
        {/* one hidden picker for both surfaces; pickFiles sets fileTargetRef so the result lands in the
            surface whose attach button was clicked. Reset value so re-picking the same file still fires. */}
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { attachFiles(e.target.files, fileTargetRef.current); e.target.value = '' }}
        />
        <aside className="si-list">
          {/* @@@ top button row - two compact icon buttons, NOT full-width list rows, so neither blocks the
              ↑/↓ path down to a session. `＋` starts a New Session; the network glyph opens the relationship
              graph (same glyph the spec board's HUD carries). New ⇄ graph is the ←/→ horizontal axis (see the
              key router); the live session rows below are the ↑/↓ vertical ring. */}
          <div className="si-toprow">
            <button className={active === 'new' ? 'si-pill new on' : 'si-pill new'} title={t('session.newSessionTitle')} onClick={() => setSel('new')}>
              <span className="si-pill-glyph">＋</span>
            </button>
            <button className={active === 'graph' ? 'si-pill graph on' : 'si-pill graph'} title={t('session.relationshipTitle')} onClick={() => setSel('graph')}>
              <svg className="si-pill-glyph" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="3.5" cy="4" r="1.8" /><circle cx="12.5" cy="4" r="1.8" /><circle cx="8" cy="12.5" r="1.8" />
                <path d="M4.9 5.1 L7 11 M11.1 5.1 L9 11 M5 4 H11" />
              </svg>
            </button>
          </div>
          {sessions.map((s) => (
            // @@@ single = switch, double = lock - a single click just switches to the tab; a DOUBLE click
            // locks that session and returns to the graph focused on its overlay (onPickSession toggle=false
            // always grips). Precondition: a node to focus — with no overlay the double click is a no-op
            // beyond the switch. The face is the SHARED SessionRow, so a tab reads IDENTICALLY to the
            // top-right window (same status + same overlay tally, e.g. "review ~2"), not a divergent subset.
            <button
              key={s.id}
              data-sid={s.id}
              className={`si-item${active === s.id ? ' on' : ''}${dropHint?.id === s.id ? ` drop-${dropHint.place}` : ''}`}
              style={{ '--ov': labelColor(s.id) }}
              onClick={() => setSel(s.id)}
              onDoubleClick={() => { if (s.ops?.length && onPickSession) { onPickSession(s, false); onClose() } }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, session: s }) }}
              title={s.ops?.length ? t('session.opsTitle') : undefined}
            >
              <SessionRow s={s} locked={false} handle={dragHandle(s)} />
            </button>
          ))}
        </aside>

        <section className={active === 'new' ? 'si-content is-new' : active === 'graph' ? 'si-content is-graph' : 'si-content is-session'}>
          {/* @@@ relationship graph - mounted only while its tab is active AND the console is open. It
              remounts (instantly framed) on reselect, but both its NODES (the preloaded `sessions`) AND its
              EDGES (graphEdges, polled HERE in the always-mounted console) are handed straight in — so reselect
              frames the FINAL clustered web with no cold fetch and no edgeless-then-jump shuffle, and the web
              keeps updating live while the console is open. onOpen switches the console to the clicked
              session's tab — the graph's "open" is a tab switch, not a cross-surface jump. Its legend is
              lifted here (graphLegend) for Esc precedence (see key router). */}
          {open && active === 'graph' && (
            <SessionGraph sessions={sessions} onOpen={(id) => setSel(id)} active legend={graphLegend} setLegend={setGraphLegend} edges={graphEdges} edgesLoaded={graphEdgesLoaded} />
          )}
          {active === 'new' && (
            <div className="si-new-center">
              <div className="si-avatar">◠‿◠</div>
              <div className="si-ask">{t('session.ask')}</div>
              <div
                className={dragTarget === 'new' ? 'si-inputwrap dragover' : 'si-inputwrap'}
                onDragOver={(e) => onDragOverFiles(e, 'new')}
                onDragLeave={() => setDragTarget(null)}
                onDrop={(e) => onDropFiles(e, 'new')}
              >
                <textarea
                  ref={taRef}
                  className="si-input"
                  rows={1}
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); syncMenu(e.target) }}
                  onSelect={(e) => syncMenu(e.target)}
                  onPaste={(e) => onPasteFiles(e, 'new')}
                  onBlur={() => setMenu(null)}
                  placeholder={t('session.inputPlaceholder')}
                  spellCheck={false}
                  disabled={sending}
                />
                <button
                  type="button"
                  className="si-attach"
                  title={t('session.attachTitle')}
                  onClick={() => pickFiles('new')}
                  disabled={uploading || sending}
                >{uploading && attachAt === 'new' ? '⏳' : '📎'}</button>
                {uploadErr && attachAt === 'new' && <span className="si-attach-err" role="alert">{t('session.attachError')}</span>}
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
                        <span className="mention-dot" style={{ background: STATUS_COLOR[it.status] || STATUS_COLOR.offline }} />
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
            style={{ display: (active === 'new' || active === 'graph') ? 'none' : 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
          >
              <div className="si-term" ref={termRef}>
                <div className="si-term-head">
                  <span className="si-dot" style={{ background: STATUS_COLOR[selSession?.status] || STATUS_COLOR.offline }} />
                  {/* the big-title reads the SHARED sessionHeadline (live tmux self-summary, else a launch-
                      prompt placeholder; a rename always wins) — the SAME source/content as the session rows
                      ([[session-activity]]), only with more room before it truncates, so the title over the
                      terminal never disagrees with the row that opened it. */}
                  <span className="si-th-name" title={selSession ? sessionHeadline(selSession) : active}>{(selSession && sessionHeadline(selSession)) || active}</span>
                  <span className="si-th-st" style={{ color: STATUS_COLOR[selSession?.status] }}>{selSession?.status ? t(`status.${selSession.status}`) : ''}</span>
                  {selSession?.merges > 0 && <span className="si-merges" title={t('session.mergesTitle')}>{t('session.merges', { n: selSession.merges })}</span>}
                  {/* @@@ action row - the buttons are the SAME board commands as the typed `/` commands, from
                      the one registry: each carries its identity hue (sc-<color>) and fires the SAME run()
                      the typed command does, so button and command never diverge. exit has no button here
                      (button:false) — closing lives on the row's right-click menu, behind a confirm; relaunch
                      is a plain lifecycle action, not a board command. No "request review": agents propose it
                      at the stop-gate (`session done --propose merge`). */}
                  <div className="si-actions">
                    {showRelaunch
                      ? <button className="si-act go" onClick={() => act('resume')}>{t('session.relaunch')}</button>
                      : boardCmds.filter((c) => c.button).map((c) => {
                          // nav alone carries extra state: `.on` while active, `.suggest` while the pane sniff
                          // thinks a select menu is up (the pulse that invites nav mode).
                          const state = c.name === 'nav' ? (navMode ? ' on' : (menuById[active] ? ' suggest' : '')) : ''
                          return (
                            <button
                              key={c.name}
                              className={`si-act board sc-${c.color} ${c.name}${state}`}
                              title={t(c.titleKey)}
                              onClick={c.run}
                            >{t(c.labelKey)}</button>
                          )
                        })}
                  </div>
                </div>
                <div className="si-term-body" style={{ position: 'relative' }}>
                  {/* every opened session's terminal stays mounted; only the active one is shown */}
                  {[...opened].map((id) => (
                    <div key={id} className="si-term-layer" style={{ position: 'absolute', inset: 0, display: id === active ? 'block' : 'none' }}>
                      {/* active → this pane is the only one that holds a WebGL context (see SessionTerm). */}
                      <SessionTerm sessionId={id} active={id === active} onMenu={reportMenu} />
                    </div>
                  ))}
                  {showRelaunch && (
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
                <div
                  className={`${sendErr ? 'si-bottom err' : 'si-bottom'}${dragTarget === 'msg' ? ' dragover' : ''}`}
                  onDragOver={(e) => { if (!noLivePane) onDragOverFiles(e, 'msg') }}
                  onDragLeave={() => setDragTarget(null)}
                  onDrop={(e) => { if (!noLivePane) onDropFiles(e, 'msg') }}
                >
                  <span className="si-prompt">❯</span>
                  <textarea
                    ref={msgRef}
                    className="si-input"
                    rows={1}
                    value={msg}
                    onChange={(e) => { setMsg(e.target.value); if (sendErr) setSendErr(false); syncMenu(e.target) }}
                    onSelect={(e) => syncMenu(e.target)}
                    onPaste={(e) => { if (!noLivePane) onPasteFiles(e, 'msg') }}
                    onBlur={() => setMenu(null)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); sendMsg() } }}
                    placeholder={noLivePane ? t('session.msgOffline') : t('session.msgPlaceholder')}
                    spellCheck={false}
                    disabled={noLivePane}
                  />
                  <button
                    type="button"
                    className="si-attach"
                    title={t('session.attachTitle')}
                    onClick={() => pickFiles('msg')}
                    disabled={uploading || noLivePane}
                  >{uploading && attachAt === 'msg' ? '⏳' : '📎'}</button>
                  {uploadErr && attachAt === 'msg' && <span className="si-attach-err" role="alert">{t('session.attachError')}</span>}
                  {sendErr && <span className="si-send-err" role="alert">{t('session.msgError')}</span>}
                  {/* slash-command menu — docked at the bottom, so it opens UPWARD (`up`) above the ❯ box. */}
                  {menu && menu.kind === 'slash' && slashMenu(true, menu.query ? `/${menu.query}` : t('session.menuCommands'))}
                </div>
              )}
          </div>
        </section>
      </div>
    </div>
    <SessionContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} onChanged={reload} />
    {/* the review-proof overlay ([[review-proof]]) — one instance driven by the lifted `proofOpen`, opened
        identically by the `proof` header button and the typed `/proof` board command. */}
    {proofOpen && active !== 'new' && active !== 'graph' && <ProofOverlay sessionId={active} onClose={() => setProofOpen(false)} />}
    </>
  )
}
