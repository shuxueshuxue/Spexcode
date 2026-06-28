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

// the attach affordance — a monochrome inline glyph in the dashboard's own SVG vocabulary (currentColor
// stroke, so it inherits the .si-attach muted→blue hover), NOT a color emoji. AttachGlyph is the paperclip;
// BusyGlyph is the in-flight (uploading) state, a spinning ring.
const AttachGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.5 7.2 L7 12.6 a2.6 2.6 0 0 1-3.7-3.7 L9 3.2 a1.7 1.7 0 0 1 2.4 2.4 L5.8 11.2 a0.8 0.8 0 0 1-1.2-1.2 L9.7 5" />
  </svg>
)
const BusyGlyph = () => (
  <svg className="si-attach-busy" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" opacity="0.3" /><path d="M8 2.5 a5.5 5.5 0 0 1 5.5 5.5" />
  </svg>
)
const AnthropicGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
  </svg>
)
const OpenAIGlyph = () => (
  <svg className="si-agent-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z" />
  </svg>
)

// Window-level (capture) key handling, not panel onKeyDown: arrowing off the New Session tab unmounts its
// textarea, so a panel listener would lose focus and kill nav; a window listener is focus-independent.

// DOM KeyboardEvent.key → the base key name /rawkey feeds tmux send-keys (non-printables only; modifier
// combos are encoded by navKeyToken). Escape is intentionally absent — handled separately.
const RAWKEY = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', ' ': 'Space' }

// Encode a keydown into a tmux token (⌃→`C-`, ⌥/⌘→`M-`, Shift→`S-` on named keys). The base of a
// modified letter/digit comes from e.code, not e.key: a held modifier makes e.key unreliable (⌥B prints
// '∫' on a mac), but the physical KeyB/Digit3 code is stable. null = nothing sendable → key swallowed.
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

// the menu's spec path, minus the `.spec/` shell and `/spec.md` leaf, so a row reads like a breadcrumb.
const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// an `@<id>` mention token at a word boundary. Optional leading dot so `@.config` resolves (a node id is
// its dir basename — see [[spec-pointer]]). Group 1 = the boundary (BOL or whitespace), 2 = the id. Used
// for both the New Session launch grammar and the running-session send-time resolution — one pattern.
const MENTION_RE = /(^|\s)@(\.?[A-Za-z0-9_-]+)/g

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

// the shared auto-grow routine: reset to `auto` (so it can shrink), then height = scrollHeight clamped at
// `maxH`. overflow-y stays HIDDEN below the cap so a scrollbar never appears from the height transition
// lagging or from scrollHeight's sub-pixel rounding; only past the cap does it flip to `auto`. `maxH` is the
// only per-surface difference.
function fitTextarea(ta, maxH) {
  if (!ta) return
  ta.style.height = 'auto'
  ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
  ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`
}

// filter the command list by the typed prefix: startsWith beats a mid-string include; server order is
// preserved within a score band (stable sort). Empty query (just `/`) lists everything.
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

// the New Session `/` palette over config presets — same prefix-rank shape as matchSlash.
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

// the harnesses the backend can launch (spec-cli/src/harness.ts HARNESSES) — `claude` is the default. The
// New Session box lets the user pick one; its id rides along in the POST /api/sessions body.
const HARNESSES = [
  { id: 'claude', label: 'Claude Code', Glyph: AnthropicGlyph },
  { id: 'codex', label: 'Codex', Glyph: OpenAIGlyph },
]

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
  // which harness the next New Session launches (claude | codex). Remembered for the session of use so a
  // user who works in one harness doesn't re-pick each launch; rides along in the POST body (default claude).
  const [harness, setHarness] = useState(() => {
    try { return localStorage.getItem('si.harness') || 'claude' } catch { return 'claude' }
  })
  const pickHarness = (id) => { setHarness(id); try { localStorage.setItem('si.harness', id) } catch {} }
  const [sendErr, setSendErr] = useState(false)   // last /keys dispatch failed — surfaced under the ❯ box
  const [navMode, setNavMode] = useState(false)
  const [menuById, setMenuById] = useState({})   // per-pane menu-sniff flag from each SessionTerm; drives the nav button's `.suggest` pulse
  const [proofOpen, setProofOpen] = useState(false)
  // the graph's `?` legend, lifted here so the console's Esc handler can close it before the console
  // (Esc precedence — see the key router below).
  const [graphLegend, setGraphLegend] = useState(false)
  // the graph's edges, polled HERE in the always-mounted console (not inside SessionGraph, which remounts on
  // every reselect): owning them one level up frames the FINAL clustered web on reselect with no cold fetch
  // or edgeless-then-jump, and keeps the web live in the background. `graphEdgesLoaded` holds the graph's
  // first reveal until the real edges land.
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

  // [[session-reorder]] drag: a POINTER drag from the per-row handle, not native HTML5 DnD. keepFocus
  // preventDefaults the row mousedown to keep the ❯ box focused, which would block native DnD; a pointer
  // drag rides window mousemove/mouseup, immune to that preventDefault. dropHint lights the insertion line.
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
  const dragHandle = (s) => (
    <span
      className="si-drag-handle"
      title={t('session.dragHandle')}
      onMouseDown={(e) => onHandleDown(e, s)}
      onClick={(e) => e.stopPropagation()}
    >⠿</span>
  )

  const order = useMemo(() => ['new', ...sessions.map((s) => s.id)], [sessions])
  const active = sel === 'graph' || order.includes(sel) ? sel : 'new'
  // a removed session (closed here, ended on its own, or closed elsewhere) leaves the tab unresolved: land
  // on New only if you're still on the now-gone tab. Mirrors `active`'s validity test.
  useEffect(() => {
    if (sel !== 'graph' && !order.includes(sel)) setSel('new')
  }, [order, sel, setSel])
  const focusId = focusNode?.id || null
  const selSession = sessions.find((s) => s.id === active)
  // liveness, not the lifecycle label, gates terminal vs relaunch ([[state]]). showRelaunch skips `queued`
  // (it self-starts as a slot frees, so it gets no relaunch button).
  const noLivePane = selSession?.liveness === 'offline'
  const showRelaunch = noLivePane && selSession?.status !== 'queued'
  // the active session tab's bottom-input draft (per-session, see `drafts`).
  const msg = drafts[active] || ''
  const setMsg = (v) => setDrafts((d) => ({ ...d, [active]: v }))

  // fetch the `/` command list for the ACTIVE session's harness — recomputed when you switch tabs, so a codex
  // session gets codex's menu and a claude session gets claude's. The same data each harness's `/` menu uses.
  // Display+insert only; never executed.
  useEffect(() => {
    const harness = selSession?.harness || 'claude'
    fetch(`/api/slash-commands?harness=${harness}`).then((r) => r.json()).then((d) => { if (Array.isArray(d)) setSlashCmds(d) }).catch(() => {})
  }, [selSession?.harness])

  // fetch the config presets once — the New Session box's `/` palette (tidy/health/…). Picking one composes
  // its body into the launch prompt (see submit); listing is display-only, like the slash menu.
  useEffect(() => {
    loadConfig().then((d) => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})
  }, [])
  // /api/config returns only slash-surface nodes, so the presets ARE the launchable set — no client filter.
  const slashPresets = presets

  // nav mode binds to ONE live session's menu — leaving the tab (or it going offline) exits it, so raw
  // keystrokes can never leak into the wrong pane.
  useEffect(() => { setNavMode(false); setSendErr(false); setMenu(null); setProofOpen(false) }, [active])
  useEffect(() => { if (selSession?.liveness === 'offline') setNavMode(false) }, [selSession?.liveness])
  // leaving nav mode hands focus back to the ❯ box. Guarded to the on→off edge for a live tab — a tab
  // switch or going offline exits nav too, but the tab-focus effect owns focus there.
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

  // track exactly the set of live sessions (liveness, not lifecycle, gates membership) so every live pane
  // stays mounted — see the warm-terminals contract in [[session-console]].
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

  // a board chord (nn/dd) seeds this surface with an @-directive. Apply ONCE to the New draft, then clear it
  // upstream so a later reopen restores the user's own draft. Clobbering the draft is intended here.
  useEffect(() => {
    if (seed == null) return
    setSel('new')
    setPrompt(seed)
    setMenu(null)
    onSeedConsumed?.()
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(seed.length, seed.length) } })
  }, [seed])

  // on landing on a tab, focus that tab's input (New prompt or a live session's ❯ box). No setPrompt here —
  // the per-tab drafts must survive a tab switch / reopen, so we never clobber them. Launch never blurs the box
  // (it stays enabled and fires in the background), so there's no disable→re-enable round-trip to chase here.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      if (active === 'new') taRef.current?.focus()
      // the graph tab has no docked input — it owns the keyboard itself (hjkl/⏎/?), so focus nothing.
      else if (selSession && selSession.liveness !== 'offline') msgRef.current?.focus()
    }, 0)
    return () => clearTimeout(id)
  }, [open, active, selSession?.liveness])

  // auto-grow the new-session box; re-runs on `open` so a reopened multi-line draft restores its height.
  // Its cap lives in CSS (max-height) — read it back and hand it to fitTextarea.
  useEffect(() => {
    const ta = taRef.current
    if (!ta || active !== 'new' || !open) return
    fitTextarea(ta, parseFloat(getComputedStyle(ta).maxHeight) || Infinity)
  }, [prompt, active, open])

  // the ❯ box auto-grows UPWARD (anchored to the wrap's bottom). Its cap is dynamic — half the terminal
  // height — so we set max-height in JS, then hand the same value to fitTextarea.
  useEffect(() => {
    const ta = msgRef.current
    if (!ta || active === 'new' || !open) return
    const maxH = Math.round((termRef.current?.clientHeight || 360) * 0.5)
    ta.style.maxHeight = `${maxH}px`
    fitTextarea(ta, maxH)
  }, [msg, active, open])

  // assemble the `/<preset> @<node>… <free text>` launch grammar into one prompt: the preset body with its
  // {{targets}} placeholder filled from the @-mentions (the server later derives the node from the first
  // @<id>), free text appended. A `/` naming no known preset, or a plain/@-only prompt, passes through.
  const composeLaunch = (raw) => {
    const m = raw.match(/^\/(\S+)\s*([\s\S]*)$/)
    if (!m) return raw
    const preset = slashPresets.find((p) => p.name === m[1])
    if (!preset) return raw
    const ids = []
    const free = m[2].replace(MENTION_RE, (_, sp, id) => { ids.push(id); return sp }).trim()
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

  // the running-session twin of composeLaunch's @-resolution: expand each `@<id>` in a keyed message to an
  // inline pointer at the node's live spec.md (`@<id> (<path>)`), so the driven agent is aimed at that
  // contract and reads the file itself — never a pasted body (see [[spec-pointer]]). Unknown ids pass through.
  const expandMentions = (text) =>
    text.replace(MENTION_RE, (m, sp, id) => {
      const s = specs.find((x) => x.id === id)
      return s ? `${sp}@${s.id} (${s.path})` : m
    })

  // launch a session, then stay on the New tab — it appears in the list below on the next reload/poll.
  // The box NEVER disables or blurs: clear the draft optimistically (so a fresh draft can't be clobbered when
  // the POST lands) and fire the launch in the BACKGROUND. Gating the box on the in-flight POST + a board re-read
  // (both seconds of real work — worktree, branch, tmux) left the whole pane greyed and unfocused until they
  // returned; keeping it live makes the next launch type-ready at once. The empty-draft check guards double-fire.
  const submit = () => {
    const raw = prompt.trim()
    if (!raw) return
    const text = composeLaunch(raw)
    setPrompt('')
    fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, harness }),
    })
      .then((res) => res.json().catch(() => null))
      .then(() => reload?.())
      .catch(() => {})
  }

  // the @-mention dropdown — shared by the New prompt and a running session's ❯ inbox (one menu, not two).
  // The trigger is purely positional: scan back from the caret over non-space chars to an `@` at a word
  // boundary. Returns the menu descriptor, or null when the caret isn't inside a mention token.
  const mentionMenu = (value, caret) => {
    let i = caret - 1
    while (i >= 0 && value[i] !== '@' && !/\s/.test(value[i])) i--
    if (i >= 0 && value[i] === '@' && (i === 0 || /\s/.test(value[i - 1]))) {
      const query = value.slice(i + 1, caret)
      const items = matchSpecs(specs, query, focusId)
      if (!items.length) return null
      return { kind: 'mention', items, index: 0, start: i, end: caret, query }
    }
    return null
  }
  // build the completion dropdown for the active surface: @-mention (spec nodes) works on BOTH; the New
  // prompt adds the config-preset (`/`) palette, a session's ❯ inbox adds the slash-command menu.
  const buildMenu = (value, caret) => {
    const mm = mentionMenu(value, caret)
    if (mm) return mm
    if (active === 'new') {
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
      // a board command RUNS on pick (the typed twin of its button); CC commands only insert text.
      if (item.board) { const c = boardCmds.find((x) => x.name === item.name); setMsg(''); setMenu(null); c?.run(); return }
      const insert = `/${item.name} `
      const before = msg.slice(0, menu.start)
      setMsg(before + insert + msg.slice(menu.end))
      setMenu(null)
      const caret = before.length + insert.length
      requestAnimationFrame(() => { const el = msgRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
      return
    }
    // config preset → the New prompt (composed at launch); a mention → whichever box is active: the New
    // prompt (resolved at launch) or a running session's ❯ inbox (resolved at send, see expandMentions).
    const insert = menu.kind === 'config' ? `/${item.name} ` : `@${item.id} `
    const onMsg = menu.kind === 'mention' && active !== 'new'
    const ref = onMsg ? msgRef : taRef
    const cur = onMsg ? msg : prompt
    const setCur = onMsg ? setMsg : setPrompt
    const before = cur.slice(0, menu.start)
    setCur(before + insert + cur.slice(menu.end))
    setMenu(null)
    const caret = before.length + insert.length
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
  }

  // ONE render for both `/` palettes — the inbox's CC-command menu (`up`, opens above the box) and the New
  // box's config-preset menu (downward). Only the right-hand tag differs. `head` is the dim title label.
  const slashMenu = (up, head) => (
    <ul className={up ? 'mention-menu up' : 'mention-menu'} role="listbox">
      <li className="mention-head">// {head} — {t('session.menuHint')}</li>
      {menu.items.map((it, i) => {
        // a board command carries its identity hue (sc-<color>); CC commands → source tag, presets → kind.
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

  // ONE render for the @-mention menu, on either surface — downward under the centered New box, or `up`
  // above the docked ❯ inbox. Same rows, same data; only the open direction differs (like slashMenu).
  const mentionMenuEl = (up) => (
    <ul className={up ? 'mention-menu up' : 'mention-menu'} role="listbox">
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
  )

  const sendMsg = async () => {
    const raw = msg
    if (!raw.trim() || active === 'new') return
    // a line that is EXACTLY `/<name>` of an available board command runs HERE instead of being sent to the
    // agent (this covers the no-menu submit; accept() handles the menu pick). trim() covers the `/`
    // completion's trailing space and a stray newline.
    const cmd = boardCmds.find((c) => raw.trim() === `/${c.name}`)
    if (cmd) { setMsg(''); setMenu(null); cmd.run(); return }
    // resolve any `@<node>` to a live spec.md pointer before it reaches the agent (the running-session twin
    // of the New Session launch composition — see [[term-input]]).
    const text = expandMentions(raw)
    setMsg('')
    setSendErr(false)
    try {
      const res = await fetch(`/api/sessions/${active}/keys`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, enter: true }),
      })
      if (!res.ok) throw new Error(`keys ${res.status}`)
    } catch {
      setMsg(raw)       // don't lose the message — put the ORIGINAL line back so the human can retry
      setSendErr(true)
    }
  }

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

  // lifecycle actions — thin POSTs to the session state machine, then reload the board.
  const act = async (verb) => {
    await fetch(`/api/sessions/${active}/${verb}`, { method: 'POST' }).catch(() => {})
    await reload?.()
  }

  // `runners` binds each board-command name to the closure that DOES it — the SAME closure the header
  // button's onClick fires; `boardCmds` narrows the registry to the current session state. See [[term-input]].
  const runners = {
    nav: () => setNavMode((v) => !v),
    proof: () => setProofOpen(true),
    merge: () => act('merge'),
    exit: () => act('exit'),     // soft stop: kill tmux + socket, KEEP the worktree → session goes offline + relaunch panel
    close: () => act('close'),   // removal: kill + remove the worktree + branch (the row right-click Close's twin)
  }
  const boardCmds = boardCommandsFor(selSession?.status, runners)
  // window-level key router: ↑/↓ walk the list regardless of focus; Enter on New launches.
  const stateRef = useRef({})
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey, graphLegend, setGraphLegend }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey, graphLegend, setGraphLegend } = stateRef.current
      if (!open) return   // panel hidden (board not the active surface): nothing here listens
      // reserved ⌥/⌘+I toggles nav mode: handled before everything else, never forwarded to tmux. Matched by
      // e.code (the physical I key) because ⌥I on a mac prints a dead-key glyph, not 'i'.
      const isI = e.code === 'KeyI' || e.key === 'i' || e.key === 'I'
      if ((e.altKey || e.metaKey) && isI && active !== 'new' && active !== 'graph') {
        e.preventDefault(); e.stopPropagation(); setNavMode((v) => !v); return
      }
      // ⌥+N snaps to New Session; ⌘/⌥/⌃+↑/↓ walk the session list. Kept ABOVE the graph branch and the
      // nav-mode passthrough so they fire from the graph and even while raw-key mode forwards to a pane — and
      // the modifier frees ↑/↓ from any caret/typing conflict, so the switch fires whatever input holds focus.
      // N is matched by e.code (the physical N key), not e.key: ⌥N on a mac emits a dead-key glyph (˜) for e.key,
      // not 'n' — the same reason ⌥I above keys off e.code. ⌘N (mac) / ⌃N (win/linux) are the browser's
      // hard-reserved new-window accelerator whose keydown never reaches the page to be cancelled, so ⌥N is the
      // one modifier+N chord the app can actually own (the e.metaKey/ctrlKey arms below stay best-effort).
      if (e.metaKey || e.altKey || e.ctrlKey) {
        if (e.code === 'KeyN' || e.key === 'n' || e.key === 'N') { e.preventDefault(); e.stopPropagation(); setSel('new'); return }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation()
          let i = order.indexOf(active); if (i < 0) i = 0   // off-list (graph) → enter the list from New
          const ni = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
          setSel(order[ni]); return
        }
      }
      // graph tab: hjkl/⏎/? pass through to the graph's own listener; ← returns to New Session; the other
      // arrows are swallowed (so they neither scroll nor fall through to tab nav). Esc closes the `?` legend
      // first, else the console.
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
      // nav mode: forward EVERY key raw to the pane (⌃/⌥/⌘ combos encoded by navKeyToken), nothing else fires.
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
      // from New, → crosses into the graph, but ONLY when the prompt is empty (a non-empty draft moves the
      // caret normally). The graph's ← crosses back.
      if (active === 'new' && e.key === 'ArrowRight' && (taRef.current?.value ?? '') === '') {
        e.preventDefault(); e.stopPropagation(); setSel('graph'); return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // a text input keeps plain ↑/↓ ENTIRELY — they're its own caret keys and never switch tabs, even at
        // the first/last line, so typing in the box never jerks you onto another session. Tab switching while
        // typing is the modifier combos' job (handled above). Plain ↑/↓ walk the list only outside any input.
        if (e.target?.tagName === 'TEXTAREA') return
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

  // keep the docked input focused: preventDefault on a left-click mousedown over non-text chrome blocks the
  // blur but not the click (buttons still fire onClick). Left clicks ONLY — preventDefault on a right-button
  // mousedown suppresses the contextmenu in some browsers (Safari/Firefox), killing the rename pop-over;
  // right-click focus retention is handled by the contextmenu blocker below. The terminal owns its selection.
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

  // suppress the OS context menu via a native window listener in the CAPTURE phase (a React onContextMenu is
  // unreliable for repeated right-clicks), then refocus the docked input (the right-press may have blurred
  // it). preventDefault here does not stop propagation, so a row's own onContextMenu still opens the rename.
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
            // single click switches tab; double-click locks the session (needs an overlay to focus, else a
            // no-op beyond the switch). The face is the shared SessionRow.
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
          {/* nodes (preloaded `sessions`) and edges (polled in this console) are handed straight in, so a
              reselect frames the final web with no cold fetch; onOpen is a tab switch, not a cross-surface jump. */}
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
                />
                <button
                  type="button"
                  className="si-attach"
                  title={t('session.attachTitle')}
                  onClick={() => pickFiles('new')}
                  disabled={uploading}
                >{uploading && attachAt === 'new' ? <BusyGlyph /> : <AttachGlyph />}</button>
                {uploadErr && attachAt === 'new' && <span className="si-attach-err" role="alert">{t('session.attachError')}</span>}
                {menu && menu.kind === 'mention' && mentionMenuEl(false)}
                {/* config-preset palette — same `/` dropdown, opening downward under the centered box. */}
                {menu && menu.kind === 'config' && slashMenu(false, menu.query ? `/${menu.query}` : t('session.menuPresets'))}
              </div>
              {/* agent picker — icon-only radios; the label lives in aria/title, not visible copy. */}
              <div className="si-agent-picker" role="radiogroup" aria-label={t('session.harnessLabel')}>
                {HARNESSES.map((h) => {
                  const Glyph = h.Glyph
                  return (
                    <button
                      key={h.id}
                      type="button"
                      role="radio"
                      aria-checked={harness === h.id}
                      aria-label={h.label}
                      title={h.label}
                      className={harness === h.id ? 'si-agent-opt on' : 'si-agent-opt'}
                      onClick={() => pickHarness(h.id)}
                    ><Glyph /></button>
                  )
                })}
              </div>
              <div className="si-hint">
                {t('session.hint.before')}<code>@</code>{t('session.hint.mid')}<code>/</code>{t('session.hint.after')}
              </div>
            </div>
          )}
          {/* the session pane stays MOUNTED even on the new/graph tabs (just display:none) so the terminals'
              WebSockets + scroll survive the tab switch. */}
          <div
            className="si-session-wrap"
            style={{ display: (active === 'new' || active === 'graph') ? 'none' : 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
          >
              <div className="si-term" ref={termRef}>
                <div className="si-term-head">
                  <span className="si-dot" style={{ background: STATUS_COLOR[selSession?.status] || STATUS_COLOR.offline }} />
                  {/* the title reads the shared sessionHeadline ([[session-activity]]) — same source/content
                      as the session rows, so it never disagrees with the row that opened it. */}
                  <span className="si-th-name" title={selSession ? sessionHeadline(selSession) : active}>{(selSession && sessionHeadline(selSession)) || active}</span>
                  <span className="si-th-st" style={{ color: STATUS_COLOR[selSession?.status] }}>{selSession?.status ? t(`status.${selSession.status}`) : ''}</span>
                  {selSession?.merges > 0 && <span className="si-merges" title={t('session.mergesTitle')}>{t('session.merges', { n: selSession.merges })}</span>}
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
                  >{uploading && attachAt === 'msg' ? <BusyGlyph /> : <AttachGlyph />}</button>
                  {uploadErr && attachAt === 'msg' && <span className="si-attach-err" role="alert">{t('session.attachError')}</span>}
                  {sendErr && <span className="si-send-err" role="alert">{t('session.msgError')}</span>}
                  {/* slash-command + @-mention menus — docked at the bottom, so they open UPWARD above the ❯ box. */}
                  {menu && menu.kind === 'slash' && slashMenu(true, menu.query ? `/${menu.query}` : t('session.menuCommands'))}
                  {menu && menu.kind === 'mention' && mentionMenuEl(true)}
                </div>
              )}
          </div>
        </section>
      </div>
    </div>
    <SessionContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} onChanged={reload} />
    {/* the review-proof overlay ([[review-proof]]) — one instance driven by the lifted `proofOpen`. */}
    {proofOpen && active !== 'new' && active !== 'graph' && <ProofOverlay sessionId={active} onClose={() => setProofOpen(false)} />}
    </>
  )
}
