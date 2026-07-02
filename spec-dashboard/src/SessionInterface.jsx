import { useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'
import { loadConfig } from './data.js'
import { labelColor } from './color.js'
import { sessionForest } from './session.js'
import { MENTION_RE, specPath, highlight, nodeMentionAt, actorMentionAt, MentionMenu } from './mentions.jsx'
import { SessionRow, RowLead, useFold } from './SessionWindow.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import SessionEvalPane from './SessionEval.jsx'
import { useResizable } from './useResizable.js'
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

// the `[[`/`@` mention machinery — trigger scanners, ranking, MENTION_RE, the MentionMenu dropdown — is the
// SHARED module ./mentions.jsx ([[mentions]]): one autocomplete for the console and the forum composers.

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

// dropdown descriptions read as sentences — capitalise the first letter (idempotent; CC's already are).
const capDesc = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

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

export default function SessionInterface({ sessions, specs = [], focusNode, open, searchOpen = false, sel, setSel, seed, onSeedConsumed, onClose, onPickSession, onOpenSearch, reload }) {
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
  // which of the right pane's two tabs is showing: the live terminal (default) or the always-available proof.
  const [rightTab, setRightTab] = useState('terminal')
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

  // the session list is grouped into two triage zones (needs-you over self-running, [[session-console]]) AND
  // nested — a session folds under its spawner ([[session-nesting]]). `forest` is that display structure (zone
  // headers + rows, children present only while their parent is expanded); `visible` is its flat row order,
  // which ↑/↓ nav walks, so display and nav never disagree (a collapsed child is off-screen AND out of the nav
  // order, never a hidden target). Within a zone the newest session sits on top (automatic ordering).
  const { expanded, toggle: toggleFold } = useFold()
  const forest = useMemo(() => sessionForest(sessions, (id) => expanded.has(id)), [sessions, expanded])
  const visible = useMemo(() => forest.filter((it) => it.type === 'row').map((it) => it.s), [forest])
  const order = useMemo(() => ['new', ...visible.map((s) => s.id)], [visible])
  // content mode: 'new' or a session id (the forum left for its own page — [[issues-view]] / [[side-nav]]).
  const active = order.includes(sel) ? sel : 'new'
  // a removed session (closed here, ended on its own, or closed elsewhere) leaves the tab unresolved: land
  // on New only if you're still on the now-gone tab. Mirrors `active`'s validity test. Only while the page
  // is showing — a background board refresh must not clobber the remembered tab (or the URL echo) mid-boot.
  useEffect(() => {
    if (open && !order.includes(sel)) setSel('new')
  }, [open, order, sel, setSel])
  // the session list is a user-resizable pane ([[resizable-panes]]): drag the divider, width persists.
  const [listW, listDrag] = useResizable('spex.siListWidth', 240, { min: 180, max: 480 })
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
  // /api/config returns only command-surface nodes, so the presets ARE the launchable set — no client filter.
  const commandPresets = presets

  // nav mode binds to ONE live session's menu — leaving the tab (or it going offline) exits it, so raw
  // keystrokes can never leak into the wrong pane.
  useEffect(() => { setNavMode(false); setSendErr(false); setMenu(null); setRightTab('terminal') }, [active])
  // returning to the Terminal tab re-focuses the ❯ input — switching to Proof and back must not strand the
  // caret. Only when live and not in nav mode; rAF waits for the input to (re)mount under the Terminal tab.
  useEffect(() => {
    if (rightTab === 'terminal' && active !== 'new' && !navMode && selSession && selSession.liveness !== 'offline') {
      requestAnimationFrame(() => msgRef.current?.focus())
    }
  }, [rightTab])
  useEffect(() => { if (selSession?.liveness === 'offline') setNavMode(false) }, [selSession?.liveness])
  // leaving nav mode hands focus back to the ❯ box. Guarded to the on→off edge for a live tab — a tab
  // switch or going offline exits nav too, but the tab-focus effect owns focus there.
  const wasNavRef = useRef(false)
  useEffect(() => {
    if (wasNavRef.current && !navMode && active !== 'new' && selSession?.liveness !== 'offline') msgRef.current?.focus()
    wasNavRef.current = navMode
  }, [navMode])
  // forward raw keys to the active session's pane IN TAP ORDER ([[nav-mode-key-ordering]]). Naive per-key
  // fire-and-forget POSTs raced (browser + server + send-keys all parallel), scrambling fast typing. So per
  // session keep ONE request in flight and COALESCE: the first key flushes at once (typing stays跟手), keys
  // struck during that round-trip queue and go out together as one ordered batch when it returns — strict
  // order, and typing stays snappy: no per-key latency stack-up on a remote link.
  const rawKeyQ = useRef(new Map())
  const flushRawKeys = (id) => {
    const q = rawKeyQ.current.get(id)
    if (!q || q.busy || q.keys.length === 0) return
    const keys = q.keys; q.keys = []; q.busy = true
    fetch(`/api/sessions/${id}/rawkey`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }),
    }).catch(() => {}).finally(() => { q.busy = false; flushRawKeys(id) })
  }
  const sendRawKey = (key) => {
    const id = active
    let q = rawKeyQ.current.get(id)
    if (!q) { q = { keys: [], busy: false }; rawKeyQ.current.set(id, q) }
    q.keys.push(key)
    flushRawKeys(id)
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
  // height — so we set max-height in JS, then hand the same value to fitTextarea. The box UNMOUNTS while
  // the Eval tab or nav mode replaces it and remounts at rows=1, so those flips must re-fit it too — the
  // draft survives the round-trip and the grown height must survive with it.
  useEffect(() => {
    const ta = msgRef.current
    if (!ta || active === 'new' || !open) return
    const maxH = Math.round((termRef.current?.clientHeight || 360) * 0.5)
    ta.style.maxHeight = `${maxH}px`
    fitTextarea(ta, maxH)
  }, [msg, active, open, rightTab, navMode])

  // assemble the `/<preset> [[<node>]]… <free text>` launch grammar into one prompt: the preset body with its
  // {{targets}} placeholder filled from the mentions (the server later derives the node from the first
  // `[[<id>]]`), free text appended. A `/` naming no known preset, or a plain/mention-only prompt, passes through.
  const composeLaunch = (raw) => {
    const m = raw.match(/^\/(\S+)\s*([\s\S]*)$/)
    if (!m) return raw
    const preset = commandPresets.find((p) => p.name === m[1])
    if (!preset) return raw
    const ids = []
    const free = m[2].replace(MENTION_RE, (_, id) => { ids.push(id); return '' }).trim()
    const targets = ids.length
      ? ids.map((id) => {
          const s = specs.find((x) => x.id === id)
          return s ? `- [[${s.id}]] — ${specPath(s.path)}` : `- [[${id}]]`
        }).join('\n')
      : '(No target was mentioned. If the prompt names the scope, use it; otherwise ask the human to define the scope before proceeding — unless this task needs no scope, in which case proceed.)'
    const body = preset.body.includes('{{targets}}')
      ? preset.body.replace('{{targets}}', targets)
      : `${preset.body}\n\n${targets}`
    return free ? `${body}\n\n${free}` : body
  }

  // the running-session twin of composeLaunch's mention resolution: expand each `[[<id>]]` in a keyed message
  // to an inline pointer at the node's live spec.md (`[[<id>]] (<path>)`), so the driven agent is aimed at that
  // contract and reads the file itself — never a pasted body (see [[spec-pointer]]). Unknown ids pass through.
  const expandMentions = (text) =>
    text.replace(MENTION_RE, (m, id) => {
      const s = specs.find((x) => x.id === id)
      return s ? `[[${s.id}]] (${s.path})` : m
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

  // build the completion dropdown for the active surface: `[[`-mention (spec nodes) and `@`-actor (sessions)
  // — the shared scanners from ./mentions.jsx — work on BOTH; the New prompt adds the config-preset (`/`)
  // palette, a session's ❯ inbox adds the slash menu.
  const buildMenu = (value, caret) => {
    const mm = nodeMentionAt(value, caret, specs, focusId)
    if (mm) return mm
    const am = actorMentionAt(value, caret, sessions)
    if (am) return am
    if (active === 'new') {
      const cm = value.match(/^\/(\S*)$/)   // leading `/preset` (no space yet) → config-preset palette
      if (cm) {
        const items = matchConfig(commandPresets, cm[1])
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
      // a board command OVERRIDES a same-named CC command (CC's own `/exit`) — one identity, one row, never a duplicate.
      const owned = new Set(board.map((c) => c.name))
      const items = matchSlash([...board, ...slashCmds.filter((c) => !owned.has(c.name))], sm[1])
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
  // executed; mention → the New Session prompt (taRef). `[[<id>]] ` / `/<name> ` both leave a trailing space.
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
    // config preset → the New prompt (composed at launch); a `[[`-mention/`@`-actor → whichever box is
    // active: the New prompt (resolved at launch) or a running session's ❯ inbox (resolved at send). An
    // actor inserts `@<id> ` (the id, so the server/CLI resolver matches) — text expansion only, no dispatch.
    const insert = menu.kind === 'config' ? `/${item.name} `
      : menu.kind === 'actor' ? `@${item.id} `
      : `[[${item.id}]] `
    const onMsg = (menu.kind === 'mention' || menu.kind === 'actor') && active !== 'new'
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
            <span className="slash-desc">{capDesc(it.description ?? it.desc)}</span>
            <span className={`slash-src src-${tag}`}>{SRC_TAG[tag] || tag}</span>
          </li>
        )
      })}
    </ul>
  )

  // the node-mention/`@`-actor dropdown, on either surface — downward under the centered New box, or `up`
  // above the docked ❯ inbox. The rows are the shared MentionMenu ([[mentions]]); only the open direction
  // and the pick/hover wiring into THIS surface's menu state are ours.
  const mentionMenuEl = (up) => (
    <MentionMenu menu={menu} up={up} onPick={accept} onHover={(i) => setMenu((m) => (m ? { ...m, index: i } : m))} />
  )

  const sendMsg = async () => {
    const raw = msg
    if (!raw.trim() || active === 'new') return
    // a line that is EXACTLY `/<name>` of an available board command runs HERE instead of being sent to the
    // agent (this covers the no-menu submit; accept() handles the menu pick). trim() covers the `/`
    // completion's trailing space and a stray newline.
    const cmd = boardCmds.find((c) => raw.trim() === `/${c.name}`)
    if (cmd) { setMsg(''); setMenu(null); cmd.run(); return }
    // resolve any `[[<node>]]` to a live spec.md pointer before it reaches the agent (the running-session twin
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
    proof: () => setRightTab('proof'),
    merge: () => act('merge'),
    exit: () => act('exit'),     // soft stop: kill tmux + socket, KEEP the worktree → session goes offline + relaunch panel
    close: () => act('close'),   // removal: kill + remove the worktree + branch (the row right-click Close's twin)
  }
  const boardCmds = boardCommandsFor(selSession?.status, runners)
  // window-level key router: ↑/↓ walk the list regardless of focus; Enter on New launches.
  const stateRef = useRef({})
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, searchOpen, navMode, setNavMode, sendRawKey }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, searchOpen, navMode, setNavMode, sendRawKey } = stateRef.current
      if (!open || searchOpen) return   // panel hidden, OR the search palette modal is open above us and owns the keys: nothing here listens
      // reserved ⌥/⌘+I toggles nav mode: handled before everything else, never forwarded to tmux. Matched by
      // e.code (the physical I key) because ⌥I on a mac prints a dead-key glyph, not 'i'. The chord is a
      // SINGLE modifier + I: ⌥+I XOR ⌘+I. Both held together (⌥⌘I) is the browser's own devtools accelerator —
      // let it through so the console opens rather than toggling nav mode.
      const isI = e.code === 'KeyI' || e.key === 'i' || e.key === 'I'
      if ((e.altKey !== e.metaKey) && isI && active !== 'new') {
        e.preventDefault(); e.stopPropagation(); setNavMode((v) => !v); return
      }
      // the app's GLOBAL ⌥ command family — ⌥N (New Session composer), ⌥F (forum), ⌥1..⌥4 (pages) — is
      // reserved over the console too, nav mode included (the same standing as ⌥/⌘+I above): fall through
      // UNHANDLED so the App-level window listener (registered after this child's, so next in the capture
      // chain) routes it — never forwarded to tmux. Matched by e.code for the same mac ⌥-dead-key reason as
      // ⌥I. ⌘/⌃ variants stay with the browser (⌘N/⌃N are its hard-reserved new-window accelerator anyway).
      if (e.altKey && !e.metaKey && !e.ctrlKey && ['KeyN', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) return
      // ⌘/⌥/⌃+↑/↓ walk the session list — kept ABOVE the nav-mode passthrough so they fire even while
      // raw-key mode forwards to a pane, and the modifier frees ↑/↓ from any caret/typing conflict.
      if (e.metaKey || e.altKey || e.ctrlKey) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation()
          let i = order.indexOf(active); if (i < 0) i = 0
          const ni = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
          setSel(order[ni]); return
        }
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
      // (`[[`-mention) OR a session's ❯ inbox (slash). The capture-phase listener claims Enter before the
      // inbox textarea's own onKeyDown, so picking a command never also dispatches the line.
      if (menu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navMenu(1); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); navMenu(-1); return }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return }
        if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
      }
      // (no bottom Esc rung: Esc never leaves a page — [[side-nav]]. Menus/nav-mode claimed theirs above;
      // leaving the console is navigation: the rail, ⌥1/⌥3/⌥4, or history.)
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
    e.stopPropagation()
    if (e.button !== 0) return
    const t = e.target
    if (isTextField(t)) return
    // the terminal owns its own text selection — preventing default on it would break the drag-select.
    if (t.closest && t.closest('.si-term-body')) return
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
    {/* a routed PAGE ([[side-nav]]), not a lifted modal: no backdrop, no outside-click close — it fills the
        app's main area and stays MOUNTED while other pages show (display:none) so terminals keep their
        sockets/scroll warm. */}
    <div className="si-page" style={open ? undefined : { display: 'none' }}>
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
        <aside className="si-list" style={{ flex: `0 0 ${listW}px` }}>
          <div className="si-toprow">
            <button className={active === 'new' ? 'si-pill new on' : 'si-pill new'} title={t('session.newSessionTitle')} onClick={() => setSel('new')}>
              <span className="si-pill-glyph">＋</span>
            </button>
            {/* the click twin of ⌘/Ctrl+/ ([[session-board-search]]) — same palette open, the tooltip
                teaches the chord. Momentary (no .on state): the palette floats above, no tab switches. */}
            <button className="si-pill search" title={t('session.searchTitle')} onClick={onOpenSearch}>
              <span className="si-pill-glyph">
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="7.6" cy="7.6" r="5.1" />
                  <path d="M11.4 11.4 L15.6 15.6" />
                </svg>
              </span>
            </button>
          </div>
          {forest.map((it) => {
            // group into two triage zones ([[session-console]], a dim header per zone) AND fold nested sessions
            // under their spawner ([[session-nesting]]): the forest emits zone headers and rows (children present
            // only while their parent is expanded); within a zone the newest session is on top (automatic ordering).
            if (it.type === 'zone') return <div className={`si-zone si-zone-${it.zone}`} key={`zone-${it.zone}`}>{t(`sessionZone.${it.zone}`)}</div>
            const s = it.s
            const lead = (it.expandable || it.depth)
              ? <RowLead depth={it.depth} expandable={it.expandable} expanded={it.expanded} rollup={it.rollup} kin={it.kin} onToggle={() => toggleFold(s.id)} />
              : null
            // single click switches tab; double-click locks the session (needs an overlay to focus, else a
            // no-op beyond the switch). The face is the shared SessionRow, compact + avatar-less here.
            return (
              <button
                key={s.id}
                data-sid={s.id}
                className={`si-item${active === s.id ? ' on' : ''}`}
                style={{ '--ov': labelColor(s.id) }}
                onClick={() => setSel(s.id)}
                onDoubleClick={() => { if (s.ops?.length && onPickSession) { onPickSession(s, false); onClose() } }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, session: s }) }}
                title={s.ops?.length ? t('session.opsTitle') : undefined}
              >
                <SessionRow s={s} locked={false} showAvatar={false} compact lead={lead} />
              </button>
            )
          })}
        </aside>

        {/* the list's drag handle ([[resizable-panes]]) — straddles the list/content border */}
        <div className="pane-resizer si-resizer" onMouseDown={listDrag} role="separator" aria-orientation="vertical" />

        <section className={active === 'new' ? 'si-content is-new' : 'si-content is-session'}>
          {active === 'new' && (
            <div className="si-new-center">
              <div className="si-avatar" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="52" height="52" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                  <path d="M15 35 Q32 44 49 35" strokeWidth="2.8" />
                  <path d="M32 17 L20 42" strokeWidth="3.2" />
                  <path d="M32 17 L44 42" strokeWidth="3.2" />
                  <g fill="currentColor" stroke="none">
                    <circle cx="32" cy="16.5" r="5" />
                    <circle cx="20" cy="42.6" r="5" />
                    <circle cx="44" cy="42.6" r="5" />
                  </g>
                </svg>
              </div>
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
                  data-focus-sink
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
                {menu && (menu.kind === 'mention' || menu.kind === 'actor') && mentionMenuEl(false)}
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
                {t('session.hint.before')}<code>[[</code>{t('session.hint.mid')}<code>/</code>{t('session.hint.after')}
              </div>
            </div>
          )}
          {/* the session pane stays MOUNTED even on the New tab (just display:none) so the terminals'
              WebSockets + scroll survive the tab switch. A horizontal TAB BAR (Terminal | Proof) sits above
              the pane content — it replaces the old floating title/action strip, is visibly set apart from the
              dark terminal below (panel background + separator, both themes), and carries the lifecycle actions
              on its right. */}
          <div
            className="si-session-wrap"
            style={{ display: active === 'new' ? 'none' : 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
          >
              <div className="si-tabbar">
                {/* two tabs on the left: the live terminal (default) and the always-available proof of work. */}
                <div className="si-tabs" role="tablist">
                  <button role="tab" aria-selected={rightTab === 'terminal'} className={rightTab === 'terminal' ? 'si-tab on' : 'si-tab'} onClick={() => setRightTab('terminal')}>{t('session.tabTerminal')}</button>
                  <button role="tab" aria-selected={rightTab === 'proof'} className={rightTab === 'proof' ? 'si-tab on' : 'si-tab'} onClick={() => setRightTab('proof')}>{t('session.tabProof')}</button>
                </div>
                {/* no headline here: the left sidebar already identifies the session; the tab bar is just the
                    Terminal|Proof tabs (left) + lifecycle actions (right). */}
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
              {/* Terminal tab — the live pane stays MOUNTED across tab switches (warm-terminals contract); the
                  Proof tab merely hides it with display:none, never unmounts it, so socket + scroll survive. */}
              <div className="si-term-body" ref={termRef} style={{ position: 'relative', display: rightTab === 'terminal' ? undefined : 'none' }}>
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
              {/* the docked ❯ input belongs to the Terminal tab only (the Proof tab has nothing to type at). */}
              {rightTab === 'terminal' && (navMode ? (
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
                    data-focus-sink
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
                  {/* slash-command + `[[`-mention menus — docked at the bottom, so they open UPWARD above the ❯ box. */}
                  {menu && menu.kind === 'slash' && slashMenu(true, menu.query ? `/${menu.query}` : t('session.menuCommands'))}
                  {menu && (menu.kind === 'mention' || menu.kind === 'actor') && mentionMenuEl(true)}
                </div>
              ))}
              {/* Proof tab — the review proof rendered INLINE (always available, not review-gated). Mounts on
                  each visit so it reflects the live derived diff/loss/gates ([[review-proof]]). */}
              {rightTab === 'proof' && <SessionEvalPane sessionId={active} />}
          </div>
        </section>
      </div>
    </div>
    <SessionContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} onChanged={reload} />
    </>
  )
}
