import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'
import TimelineChat from './TimelineChat.jsx'
import { isHeadlessSession } from './messageStream.js'
import { labelColor } from './color.js'
import { createSession, useLaunchers, useCommandPresets } from './launch.js'
import { sessionAncestorIds, sessionForest } from './session.js'
import { MENTION_RE, nodeMentionAt, actorMentionAt, slashTokenAt, MentionMenu, matchSlash, SlashMenu } from './mentions.jsx'
import { SessionRow, SessionZone, RowLead, useFold } from './SessionWindow.jsx'
import { HARNESS_BY_ID } from './harness.jsx'
import { Icon, IconButton } from './icons.jsx'
import { ReviewState } from './ReviewShell.jsx'
import { TabCount } from './score.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import SessionSelectBar from './SessionSelectBar.jsx'
import { useResizable } from './useResizable.js'
import { inboxCommands, uiCommandsFor } from './sessionCommands.js'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { addressHash, navigateAddress, sessionEvalAddress } from './address.js'
import { useT } from './i18n/index.jsx'
import { apiUrl } from './project.js'
import { inertChromePress } from './focus.js'

// the attach affordance — the shared `paperclip` glyph ([[icon-system]], currentColor stroke, so it
// inherits the .si-attach muted→blue hover), NOT a color emoji. BusyGlyph is the in-flight (uploading)
// state, the spinning `loader` ring.
const AttachGlyph = () => <Icon name="paperclip" size={15} />
const BusyGlyph = () => <Icon name="loader" size={15} className="si-attach-busy" />

// @@@ launch-hero — the New-Session splash speaks the terminal language of code-CLI openers: a
// block-letter ANSI-Shadow "SPEXCODE" wordmark instead of an app-icon glyph. Pure text in the app's
// mono font; the gradient reads the active theme's --blue→--magenta so re-theming re-inks it.
const HERO_WORDMARK = [
  '███████╗██████╗ ███████╗██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔════╝██╔══██╗██╔════╝╚██╗██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '███████╗██████╔╝█████╗   ╚███╔╝ ██║     ██║   ██║██║  ██║█████╗  ',
  '╚════██║██╔═══╝ ██╔══╝   ██╔██╗ ██║     ██║   ██║██║  ██║██╔══╝  ',
  '███████║██║     ███████╗██╔╝ ██╗╚██████╗╚██████╔╝██████╔╝███████╗',
  '╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
].join('\n')
export function LaunchHero() {
  return <pre className="si-hero" aria-label="SpexCode">{HERO_WORDMARK}</pre>
}

// The toolbar consumes only the canonical graph session projection. Last-known survives input invalidation,
// tab switches, remounts and transport loss; only a ready projection on a live graph stream is called current.
export function sessionEvalDisplay(projection, connected = true) {
  if (!projection) return { phase: 'loading' }
  const stable = projection.phase === 'ready' && projection.value
    ? projection.value
    : projection.lastKnown?.value
  if (!connected) return stable ? { phase: 'disconnected', ...stable } : { phase: 'disconnected' }
  if (projection.phase === 'ready' && projection.value) return { phase: 'ready', ...projection.value }
  if (projection.phase === 'updating') return stable ? { phase: 'updating', ...stable } : { phase: 'loading' }
  if (projection.phase === 'error') return stable ? { phase: 'error', ...stable } : { phase: 'error' }
  return { phase: 'loading' }
}

function SessionEvalStats({ summary }) {
  const t = useT()
  const hasValue = Number.isInteger(summary.total)
  if (!hasValue && summary.phase === 'loading') {
    return <span className="si-eval-wait" data-tip={t('session.evalLoading')}><Icon name="loader" size={12} className="si-eval-spinner" /></span>
  }
  if (!hasValue) {
    return <span className="si-eval-wait"><ReviewState kind="eval" state="missing" title={t('session.evalUnavailable')} size={12} /></span>
  }
  return (
    <span className={`si-eval-stats ${summary.phase}`} aria-hidden="true">
      {summary.pass > 0 && (
        <TabCount kind="eval" state="pass" cls="st-pass secondary" n={summary.pass} label={t('session.evalPass', { n: summary.pass })} />
      )}
      {summary.fail > 0 && (
        <TabCount kind="eval" state="fail" cls="st-fail secondary" n={summary.fail} label={t('session.evalFail', { n: summary.fail })} />
      )}
      {summary.review > 0 && (
        <TabCount kind="eval" state="review" cls="st-review secondary" n={summary.review} label={t('session.evalReview', { n: summary.review })} />
      )}
      {summary.blind > 0 && (
        <TabCount kind="eval" state="missing" cls="st-empty blind" n={summary.blind} label={t('session.evalBlind', { n: summary.blind })} />
      )}
      {summary.unknown > 0 && (
        <TabCount kind="eval" state="missing" cls="st-empty blind" n={summary.unknown} label={t('session.evalUnknown', { n: summary.unknown })} />
      )}
      {summary.phase === 'updating' && <Icon name="loader" size={11} className="si-eval-spinner si-eval-phase" />}
      {(summary.phase === 'disconnected' || summary.phase === 'error') && (
        <ReviewState kind="eval" state="missing" title={t('session.evalUnavailable')} className="si-eval-phase" size={11} />
      )}
    </span>
  )
}

// Window-level (capture) key handling, not panel onKeyDown: arrowing off the New Session tab unmounts its
// textarea, so a panel listener would lose focus and kill nav; a window listener is focus-independent.

// the `[[`/`@` mention machinery — trigger scanners, ranking, MENTION_RE, the MentionMenu dropdown — is the
// SHARED module ./mentions.jsx ([[mentions]]): one autocomplete for the console and the issue composers.

// The Command Box, New prompt, and review/issue composers share ComposerTextarea's measurement and IME
// boundary. Their domain grammars remain local to the home that sends them.

// the `/` matcher + dropdown render (matchSlash, SlashMenu) are the SHARED module ./mentions.jsx too —
// one ranking and one row markup for every `/` palette (this console's two + the eval detail's review menu).

// @@@launcher pop-out picker ([[launcher-select]]) — the desktop launch choice: a clean pill button (the
// selected launcher's harness vendor mark + name, no caret, no label) that opens a CENTRED pop-out card —
// a viewport-centred dialog over a light backdrop, deliberately not an anchored dropdown. The card has one
// row per configured launcher: its harness glyph + name, and beneath them its command in full as PLAIN
// READ-ONLY display text. The WHOLE row is one pick target — the row itself is the button, so a
// click anywhere on it (the cmd line included) picks the launcher; the cmd never forms an independent
// selection/control surface that could swallow the pick. The
// trigger's tooltip points at spexcode.json / spexcode.local.json as the one place launchers change.
// Selecting closes the pop; backdrop click or Esc closes it too.
function LauncherPicker({ launchers, launcher, pickLauncher }) {
  const t = useT()
  const [pop, setPop] = useState(false)
  useEffect(() => {
    if (!pop) return
    const onKey = (e) => { if (e.key === 'Escape') setPop(false) }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pop])
  // the trigger's glyph shows the SELECTED launcher's harness (unknown/absent harness reads as claude,
  // the default — same fallback the backend applies).
  const selected = launchers.find((l) => l.name === launcher)
  const selHarness = HARNESS_BY_ID[selected?.harness || 'claude'] || HARNESS_BY_ID.claude
  const SelGlyph = selHarness.Glyph
  return (
    <div className="si-launcher-picker">
      <button
        type="button"
        className={pop ? 'si-launcher-btn on' : 'si-launcher-btn'}
        onClick={() => setPop((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={pop}
        aria-label={t('session.launcherLabel')}
        data-tip={t('session.launcherTip')}
      >
        <span className="si-launcher-harness" aria-hidden="true"><SelGlyph /></span>
        <span className="si-launcher-name">{launcher}</span>
      </button>
      {pop && (
        <>
          {/* full-viewport backdrop — the outside-click close surface; a mousedown here is inert chrome
              under the panel's keepFocus blanket, so the composer keeps focus while the pop closes. */}
          <div className="si-launcher-backdrop" onMouseDown={() => setPop(false)} />
          <div className="si-launcher-pop" role="dialog" aria-modal="true" aria-label={t('session.launcherLabel')}>
            {launchers.map((l) => {
              const h = HARNESS_BY_ID[l.harness] || HARNESS_BY_ID.claude
              const HGlyph = h.Glyph
              return (
                <button
                  key={l.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.name === launcher}
                  className={`si-launcher-row${l.name === launcher ? ' on' : ''}`}
                  onClick={() => { pickLauncher(l.name); setPop(false) }}
                >
                  <span className="si-launcher-row-main">
                    <span className="si-launcher-harness" data-tip={h.label} aria-hidden="true"><HGlyph /></span>
                    <span className="si-launcher-name">{l.name}</span>
                    {l.name === launcher && <Icon name="check" size={13} className="si-launcher-check" />}
                  </span>
                  {/* the cmd — read-only display text; part of the same pick target, never its own surface. */}
                  {l.cmd ? <span className="si-launcher-cmd">{l.cmd}</span> : null}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function SessionInterface({ sessions, specs = [], focusNode, open, searchOpen = false, sel, setSel, seed, onSeedConsumed, onClose, onPickSession, onOpenSearch, reload, boardLive = false }) {
  const t = useT()
  const [prompt, setPrompt] = useState('')    // the New Session tab's own draft (its boarding-switch cache)
  const [menu, setMenu] = useState(null)      // completion dropdown: { kind:'mention'|'config'|'slash', items, index, start, end, query }
  const [ctxMenu, setCtxMenu] = useState(null) // session-row right-click menu { x, y, session } — row-level actions live here
  const [selecting, setSelecting] = useState(false)  // multi-select mode ([[session-multi-select]]): rows become checkboxes, not tabs
  const [picked, setPicked] = useState(() => new Set()) // the ids ticked for bulk close while `selecting`
  const [slashCmds, setSlashCmds] = useState([])   // the `/` command list (built-in + user/project/skill), fetched once
  // Command Box drafts are keyed by session id and survive close/reopen, tab switches, and route changes.
  const [drafts, setDrafts] = useState({})
  // named launcher profiles ([[launcher-select]]) — a launcher fuses (harness, cmd), so this is the sole
  // launch choice; the fetch + default resolution live in the shared launch path (./launch.js).
  const { launchers, launcher, pickLauncher } = useLaunchers()
  const [sendErr, setSendErr] = useState(false)
  const [actErr, setActErr] = useState(null)      // last lifecycle action refused/failed (e.g. the resume guard: relaunching a LIVE agent) — surfaced by the relaunch panel
  const [commandOpen, setCommandOpen] = useState(false)
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState(false)
  const [dragTarget, setDragTarget] = useState(null)
  const [attachAt, setAttachAt] = useState(null)  // surface the in-flight/last upload targets — drives the spinner + error placement
  const taRef = useRef(null)
  const msgRef = useRef(null)
  const panelRef = useRef(null)
  const fileRef = useRef(null)         // the one hidden <input type=file>; the attach buttons trigger it
  const fileTargetRef = useRef('new')  // which surface the pending pick inserts into ('new' | 'command')
  const listRef = useRef(null)

  // the session list is grouped into two triage zones (needs-you over self-running, [[session-console]]) AND
  // nested — a session folds under its spawner ([[session-nesting]]). `forest` is that display structure (zone
  // headers + rows, children present only while their parent is expanded); `visible` is its flat row order,
  // which ↑/↓ nav walks, so display and nav never disagree (a collapsed child is off-screen AND out of the nav
  // order, never a hidden target). Within a zone the newest session sits on top (automatic ordering).
  // The OFFLINE zone rests FOLDED behind its header — the one disclosure for retained session history
  // ([[session-console]]): collapsed on every fresh mount (presentation state, never persisted), toggled by
  // the header, and the selected session stays a visible row even while the zone is folded.
  const { expanded, toggle: toggleFold, expand: expandFolds } = useFold()
  const [offlineOpen, setOfflineOpen] = useState(false)
  const forest = useMemo(() => sessionForest(sessions, (id) => expanded.has(id), {
    zoneFolded: (z) => z === 'offline' && !offlineOpen,
    keepVisible: (s) => s.id === sel,
  }), [sessions, expanded, offlineOpen, sel])
  const visible = useMemo(() => forest.filter((it) => it.type === 'row').map((it) => it.s), [forest])
  const order = useMemo(() => ['new', ...visible.map((s) => s.id)], [visible])
  const validIds = useMemo(() => new Set(['new', ...sessions.map((s) => s.id)]), [sessions])
  // content mode: 'new' or a session id (the issues list left for its own page — [[issues-view]] / [[side-nav]]).
  const active = validIds.has(sel) ? sel : 'new'
  // An external jump may select a descendant omitted from the collapsed forest. Reveal its full path before
  // paint when the page opens or the selected id changes. Board refreshes deliberately do not retrigger this:
  // once visible, a human may collapse the selected branch again and that local fold choice should stick.
  useLayoutEffect(() => {
    if (open && active !== 'new') expandFolds(sessionAncestorIds(sessions, active))
  }, [open, active, expandFolds]) // eslint-disable-line react-hooks/exhaustive-deps
  // a removed session (closed here, ended on its own, or closed elsewhere) leaves the tab unresolved: land
  // on New only if you're still on the now-gone tab. Mirrors `active`'s validity test. App gates Dashboard on
  // a loaded board, so `sessions` here is the REAL set — an id absent from it is genuinely gone (a dead deep
  // link, or a loaded-empty project), not still loading; resetting it to New is correct, and Dashboard drops
  // the matching dead seed so nothing waits forever.
  useEffect(() => {
    if (open && !validIds.has(sel)) setSel('new')
  }, [open, validIds, sel, setSel])
  // the session list is a user-resizable pane ([[resizable-panes]]): drag persists; double-click resets.
  const [listW, listDrag, resetListW] = useResizable('spex.siListWidth', 204, { min: 180, max: 480 })
  const focusId = focusNode?.id || null
  const selSession = sessions.find((s) => s.id === active)
  const terminalFree = isHeadlessSession(selSession)
  const surfaceTabId = terminalFree ? 'si-conversation-tab' : 'si-terminal-tab'
  const surfacePanelId = terminalFree ? 'si-conversation-panel' : 'si-terminal-panel'
  const commandAvailable = uiCommandsFor(selSession?.status, {}, selSession?.liveness).some((command) => command.name === 'command')
  const evalSummary = sessionEvalDisplay(active !== 'new' ? selSession?.evalSummary : null, boardLive)
  // liveness, not the lifecycle label, gates terminal vs relaunch ([[state]]). showRelaunch skips `queued`
  // (it self-starts as a slot frees, so it gets no relaunch button).
  const noLivePane = selSession?.liveness === 'offline'
  const showRelaunch = !terminalFree && noLivePane && selSession?.status !== 'queued'
  // the active session's Command Box draft (per-session, see `drafts`).
  const msg = drafts[active] || ''
  const setMsg = (v) => setDrafts((d) => ({ ...d, [active]: v }))
  // Selecting a terminal is an action even when its id does not change. The request counter lets an already-
  // selected row/tab restore native focus without coupling this shell to xterm's hidden textarea.
  const activateTerminal = (id) => {
    if (id === 'new') return
    setCommandOpen(false)
    setMenu(null)
    setSel(id)
    setTerminalFocusRequest((request) => request + 1)
  }

  // fetch the `/` command list for the ACTIVE session's harness — recomputed when you switch tabs, so a codex
  // session gets codex's menu and a claude session gets claude's. The same data each harness's `/` menu uses.
  // Display+insert only; never executed.
  useEffect(() => {
    const harness = selSession?.harness || 'claude'
    fetch(apiUrl(`/api/slash-commands?harness=${harness}`)).then((r) => r.json()).then((d) => { if (Array.isArray(d)) setSlashCmds(d) }).catch(() => {})
  }, [selSession?.harness])

  // command presets feed both prompt boxes' `/` palettes. Picking one inserts its raw invocation; the backend
  // expands the body at the launch/send boundary. Shared fetch (./launch.js), no client interpreter.
  const commandPresets = useCommandPresets()

  // Command Box is transient, but its draft is not. Switching tabs or losing liveness closes the surface.
  useEffect(() => { setCommandOpen(false); setSendErr(false); setMenu(null) }, [active])
  useEffect(() => { if (!commandAvailable) setCommandOpen(false) }, [commandAvailable])
  useEffect(() => { setActErr(null) }, [active])   // a stale action error must not bleed onto the next session's panel

  // Keep every live terminal mounted for its warm-pane contract. Headless conversations have no pane and
  // remain readable offline, so their shared TimelineChat stays available regardless of liveness.
  const [opened, setOpened] = useState(() => new Set())
  useEffect(() => {
    setOpened((prev) => {
      const next = new Set()
      for (const s of sessions) if (isHeadlessSession(s) || s.liveness !== 'offline') next.add(s.id)
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

  // Focus follows the active product surface. SessionTerm owns native TUI focus; this effect owns only
  // authored textareas. Drafts remain untouched.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      if (active === 'new') taRef.current?.focus()
      else if (commandOpen) msgRef.current?.focus()
    }, 0)
    return () => clearTimeout(id)
  }, [open, active, commandOpen])

  // Keyboard-driven selection in a long list must remain visible.
  useEffect(() => {
    if (!open || active === 'new') return
    const frame = requestAnimationFrame(() => {
      const row = [...(listRef.current?.querySelectorAll('[data-sid]') || [])].find((el) => el.dataset.sid === active)
      row?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, active])

  // New-session command invocation is backend-owned: this surface and the phone send the raw
  // `/<preset> [[node]]… <free text>` through the ordinary create request, and newSession expands it for
  // every caller (dashboard, phone, CLI, direct API) on the one launch path.

  // the running-session twin of the launch owner's mention resolution: expand each `[[<id>]]` in a keyed message
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
    setPrompt('')
    createSession(raw, launcher).then(() => reload?.())
  }

  // build the completion dropdown for the active surface: `[[`-mention (spec nodes) and `@`-actor (sessions)
  // — the shared scanners from ./mentions.jsx — work on BOTH; the New prompt adds the config-preset (`/`)
  // palette, a session's Command Box adds the slash menu.
  const buildMenu = (value, caret) => {
    const mm = nodeMentionAt(value, caret, specs, focusId)
    if (mm) return mm
    const am = actorMentionAt(value, caret, sessions)
    if (am) return am
    if (active === 'new') {
      const cm = slashTokenAt(value, caret, commandPresets)
      if (cm) return { kind: 'config', ...cm }
      return null
    }
    const sm = value.match(/^\/(\S*)$/)
    if (sm) {
      // Board commands (coloured, run HERE) lead; SpexCode prompt presets follow; harness commands come last.
      // matchSlash is a stable prefix rank, so source precedence survives inside each score band.
      const ui = typedUiCmds.map((c) => ({ name: c.name, description: t(c.descKey), ui: true, color: c.color }))
      const items = matchSlash(inboxCommands(ui, commandPresets, slashCmds), sm[1])
      if (!items.length) return null
      return { kind: 'slash', items, index: 0, start: 0, end: value.length, query: sm[1] }
    }
    return null
  }
  // recompute from the textarea's live value + caret (covers typing, deletes, and bare caret moves).
  const syncMenu = (el) => setMenu(el ? buildMenu(el.value, el.selectionStart) : null)
  const navMenu = (dir) => setMenu((m) => (m ? { ...m, index: (m.index + dir + m.items.length) % m.items.length } : m))
  // replace the menu's span under the caret with the picked item's token, then drop the caret after it.
  // Each kind writes its OWN surface: slash → the active session's Command Box draft (msgRef), insert-only and never
  // executed; mention → the New Session prompt (taRef). `[[<id>]] ` / `/<name> ` both leave a trailing space.
  const accept = (item) => {
    if (!item || !menu) return
    if (menu.kind === 'slash') {
      // A board command RUNS on pick (the typed twin of its button); presets and harness commands insert text.
      if (item.ui) { const c = typedUiCmds.find((x) => x.name === item.name); setMsg(''); setMenu(null); setCommandOpen(false); c?.run(); return }
      const insert = `/${item.name} `
      const before = msg.slice(0, menu.start)
      setMsg(before + insert + msg.slice(menu.end))
      setMenu(null)
      const caret = before.length + insert.length
      requestAnimationFrame(() => { const el = msgRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
      return
    }
    // command preset → the New prompt (composed at launch); a `[[`-mention/`@`-actor → whichever box is
    // active: the New prompt (resolved at launch) or a running session's Command Box (resolved at send). An
    // actor inserts `@<id> ` (the id, so the server/CLI resolver matches) — text expansion only, no dispatch.
    if (menu.kind === 'config') {
      // A preset governs the whole launch, so a token picked anywhere in an existing draft becomes its
      // leading command. This is still an authoring edit only: Enter sends the normalized raw grammar through
      // createSession, and the backend remains the sole plugin-body interpreter.
      const rest = [prompt.slice(0, menu.start).trim(), prompt.slice(menu.end).trim()].filter(Boolean).join(' ')
      const next = `/${item.name}${rest ? ` ${rest}` : ''} `
      setPrompt(next)
      setMenu(null)
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length) } })
      return
    }
    const insert = menu.kind === 'actor' ? `@${item.id} `
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

  // both `/` palettes — Command Box's board/preset/harness menu (`up`) and the New box's
  // config-preset menu (downward) — render through the ONE shared SlashMenu; only the head label differs.
  const slashMenu = (up, head) => (
    <SlashMenu menu={menu} up={up} head={head} onPick={accept}
      onHover={(i) => setMenu((m) => (m ? { ...m, index: i } : m))} />
  )

  // the node-mention/`@`-actor dropdown, on either surface — downward under the centered New box, or `up`
  // above Command Box. The rows are the shared MentionMenu ([[mentions]]); only the open direction
  // and the pick/hover wiring into THIS surface's menu state are ours.
  const mentionMenuEl = (up) => (
    <MentionMenu menu={menu} up={up} onPick={accept} onHover={(i) => setMenu((m) => (m ? { ...m, index: i } : m))} />
  )

  const insertCommandTrigger = (trigger) => {
    const el = msgRef.current
    if (!el) return
    const start = el.selectionStart ?? msg.length
    const end = el.selectionEnd ?? start
    const next = msg.slice(0, start) + trigger + msg.slice(end)
    const caret = start + trigger.length
    setMsg(next)
    requestAnimationFrame(() => {
      const textarea = msgRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
      syncMenu(textarea)
    })
  }

  const sendMsg = async () => {
    const raw = msg
    if (!raw.trim() || active === 'new') return
    // a line that is EXACTLY `/<name>` of an available board command runs HERE instead of being sent to the
    // agent (this covers the no-menu submit; accept() handles the menu pick). trim() covers the `/`
    // completion's trailing space and a stray newline.
    const cmd = typedUiCmds.find((c) => raw.trim() === `/${c.name}`)
    if (cmd) { setMsg(''); setMenu(null); setCommandOpen(false); cmd.run(); return }
    // resolve any `[[<node>]]` to a live spec.md pointer before it reaches the backend (the running-session twin
    // of the New Session launch composition — see [[command-box]]).
    const text = expandMentions(raw)
    setMsg('')
    setSendErr(false)
    try {
      const res = await fetch(apiUrl(`/api/sessions/${active}/input`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', text }),
      })
      if (!res.ok) throw new Error(`input ${res.status}`)
      setCommandOpen(false)
    } catch {
      setMsg(raw)       // don't lose the message — put the ORIGINAL line back so the human can retry
      setSendErr(true)
    }
  }

  const uploadFile = async (file) => {
    const fd = new FormData()
    fd.append('file', file, file.name || 'pasted')
    const res = await fetch(apiUrl('/api/uploads'), { method: 'POST', body: fd })
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

  // lifecycle actions — thin POSTs to the session state machine, then reload the board. A non-2xx carrying an
  // `error` is surfaced LOUD via actErr (the resume guard refuses a relaunch on a live agent with 409 — the
  // human must SEE that, never a silent no-op that reads as "it didn't work").
  const act = async (verb) => {
    setActErr(null)
    try {
      const res = await fetch(apiUrl(`/api/sessions/${active}/${verb}`), { method: 'POST' })
      if (!res.ok) { const j = await res.json().catch(() => null); if (j?.error) setActErr(j.error) }
    } catch { /* network hiccup — the reload below re-reads truth */ }
    await reload?.()
  }

  // multi-select mode ([[session-multi-select]]): the right-click "select" enters it, pre-ticking the row that
  // was clicked; leaving clears both the mode and the picks.
  const enterSelect = (session) => { setSelecting(true); setPicked(new Set([session.id])) }
  const exitSelect = () => { setSelecting(false); setPicked(new Set()) }
  const togglePick = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // after a bulk delete: leave the mode and re-read the board so the removed rows drop off every surface.
  const onBulkClosed = () => { exitSelect(); reload?.() }

  // `runners` binds each board-command name to the closure that DOES it — the SAME closure the toolbar
  // tool and Command Box row call; `uiCmds` narrows the registry to current session state.
  const runners = {
    command: () => setCommandOpen((value) => !value),
    // the Eval DOOR ([[session-eval]]): the session's evaluation lives on the Evals route family now —
    // the typed /eval navigates to the session-scoped list through the ONE [[address-routing]] projection
    // (a real page switch, one push), never a console-local pane. The tab-bar door below is the same
    // address as a REAL anchor.
    eval: () => { if (active !== 'new') navigateAddress(sessionEvalAddress(active)) },
    merge: () => act('merge'),
    relaunch: () => act('resume'),
    stop: () => act('stop'),     // soft stop: kill tmux + socket, KEEP the worktree → session goes offline + relaunch panel
    close: () => act('close'),   // removal: kill + remove the worktree + branch (the row right-click Close's twin)
  }
  const uiCmds = uiCommandsFor(selSession?.status, runners, selSession?.liveness)
  const typedUiCmds = uiCmds.filter((command) => command.typed !== false)
  const evalKnownTitle = Number.isInteger(evalSummary.total) ? t('session.evalDoorSummary', evalSummary) : ''
  const evalDoorTitle = evalSummary.phase === 'ready'
    ? evalKnownTitle
    : evalSummary.phase === 'updating'
      ? t('session.evalUpdating', { summary: evalKnownTitle })
      : evalSummary.phase === 'disconnected'
        ? t('session.evalDisconnected', { summary: evalKnownTitle })
        : evalSummary.phase === 'loading'
          ? t('session.evalLoading')
          : evalKnownTitle
            ? t('session.evalFailedKnown', { summary: evalKnownTitle })
            : t('session.evalUnavailable')
  // Window-level router owns only app shortcuts, Command Box/menu keys, and list navigation. Ordinary
  // terminal keys fall through to xterm.
  const stateRef = useRef({})
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, open, searchOpen, commandOpen, commandAvailable, setCommandOpen }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, open, searchOpen, commandOpen, commandAvailable, setCommandOpen } = stateRef.current
      if (!open || searchOpen) return   // panel hidden, OR the search palette modal is open above us and owns the keys: nothing here listens
      // Reserved Alt/Cmd+I toggles Command Box before xterm. Matched by
      // e.code (the physical I key) because ⌥I on a mac prints a dead-key glyph, not 'i'. The chord is a
      // SINGLE modifier + I: ⌥+I XOR ⌘+I. Both held together (⌥⌘I) is the browser's own devtools accelerator —
      // leave it alone.
      const isI = e.code === 'KeyI' || e.key === 'i' || e.key === 'I'
      if ((e.altKey !== e.metaKey) && isI && active !== 'new') {
        e.preventDefault(); e.stopPropagation()
        if (commandAvailable) setCommandOpen((value) => !value)
        return
      }
      // the app's GLOBAL ⌥ command family — ⌥N (New Session composer), ⌥F (evals), ⌥1..⌥5 (pages) — is
      // reserved over the console too: fall through
      // UNHANDLED so the App-level window listener (registered after this child's, so next in the capture
      // chain) routes it — never forwarded to tmux. Matched by e.code for the same mac ⌥-dead-key reason as
      // ⌥I. ⌘/⌃ variants stay with the browser (⌘N/⌃N are its hard-reserved new-window accelerator anyway).
      if (e.altKey && !e.metaKey && !e.ctrlKey && ['KeyN', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) return
      // ⌘/⌥/⌃+↑/↓ always walk the session list; the modifier frees ↑/↓ from caret/TUI navigation.
      if (e.metaKey || e.altKey || e.ctrlKey) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation()
          let i = order.indexOf(active); if (i < 0) i = 0
          const ni = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
          setSel(order[ni]); return
        }
      }
      // a completion menu owns navigation/commit/dismiss while it's open — on the New Session prompt
      // OR Command Box. Capture claims Enter before the textarea, so accepting never also sends.
      if (menu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navMenu(1); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); navMenu(-1); return }
        if ((e.key === 'Enter' || e.key === 'Tab') && !composingKey(e)) { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return }
        if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
      }
      if (commandOpen && e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); setCommandOpen(false); return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // a text input keeps plain ↑/↓ ENTIRELY — they're its own caret keys and never switch tabs, even at
        // the first/last line, so typing in the box never jerks you onto another session. Tab switching while
        // typing is the modifier combos' job (handled above). Plain ↑/↓ walk the list only outside any input.
        if (e.target?.tagName === 'TEXTAREA' || e.target?.tagName === 'INPUT' || e.target?.isContentEditable) return
        e.preventDefault(); e.stopPropagation()
        const i = order.indexOf(active)
        const ni = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
        setSel(order[ni]); return
      }
      if (e.key === 'Enter' && !e.shiftKey && !composingKey(e) && active === 'new') { e.preventDefault(); e.stopPropagation(); submit() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setSel])

  useEffect(() => {
    if (!open) return
    const suppressNativeMenu = (event) => {
      if (panelRef.current?.contains(event.target)) event.preventDefault()
    }
    window.addEventListener('contextmenu', suppressNativeMenu, true)
    return () => window.removeEventListener('contextmenu', suppressNativeMenu, true)
  }, [open])

  return (
    <>
    {/* a routed PAGE ([[side-nav]]), not a lifted modal: no backdrop, no outside-click close — it fills the
        app's main area and stays MOUNTED while other pages show so terminals keep their sockets/scroll
        warm. Visibility itself is the shell's pane boundary — the console never toggles its own display. */}
    <div className="si-page">
      {/* the panel-wide keepFocus blanket ([[terminal-input]] / [[focus-return]]): every pointer-down on
          console chrome is inert for focus — only the composers, the rename input, and the xterm screen
          take pointer focus, so the current sink (TUI, Command Box, or New) keeps typing focus through
          any chrome interaction. Capture phase so no child's stopPropagation can leak a press. */}
      <div className="si-panel" ref={panelRef} onMouseDownCapture={inertChromePress}>
        {/* one hidden picker for both surfaces; pickFiles sets fileTargetRef so the result lands in the
            surface whose attach button was clicked. Reset value so re-picking the same file still fires. */}
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { attachFiles(e.target.files, fileTargetRef.current); e.target.value = '' }}
        />
        <aside className="si-list" ref={listRef} style={{ flex: `0 0 ${listW}px` }}>
          {/* while multi-selecting ([[session-multi-select]]) the New/Search pills give way to the select bar —
              a pick count + bulk delete + cancel; the rows below toggle picks instead of switching tabs. */}
          {selecting ? (
            <SessionSelectBar ids={[...picked]} onCancel={exitSelect} onClosed={onBulkClosed} />
          ) : (
          <div className="si-toprow">
            <button className={active === 'new' ? 'si-pill new on' : 'si-pill new'} data-tip={t('session.newSessionTitle')} aria-label={t('session.newSessionTitle')} onClick={() => setSel('new')}>
              <span className="si-pill-glyph"><Icon name="plus" size={15} strokeWidth={2} /></span>
            </button>
            {/* the click twin of ⌘/Ctrl+/ ([[session-search]]) — same palette open, the tooltip
                teaches the chord. Momentary (no .on state): the palette floats above, no tab switches. */}
            <button className="si-pill search" data-tip={t('session.searchTitle')} aria-label={t('session.searchTitle')} onClick={onOpenSearch}>
              <span className="si-pill-glyph"><Icon name="search" size={15} /></span>
            </button>
          </div>
          )}
          {forest.map((it) => {
            // group into two triage zones ([[session-console]], a dim header per zone) AND fold nested sessions
            // under their spawner ([[session-nesting]]): the forest emits zone headers and rows (children present
            // only while their parent is expanded); within a zone the newest session is on top (automatic ordering).
            // A FOLDABLE zone header (offline — session history) is the one disclosure: count before label,
            // aria-expanded speaking the state; toggling is pointer-inert for focus like all console chrome.
            if (it.type === 'zone') {
              return <SessionZone key={`zone-${it.zone}`} item={it} baseClass="si-zone" onToggle={() => setOfflineOpen((v) => !v)} />
            }
            const s = it.s
            const lead = (it.expandable || it.depth)
              ? <RowLead guides={it.guides} expandable={it.expandable} expanded={it.expanded} rollup={it.rollup} kin={it.kin} />
              : null
            // A click switches tabs. Locking is an explicit item in the right-click menu below; double-click
            // deliberately has no extra meaning, so it only leaves the clicked tab selected.
            // The face is the shared SessionRow, avatar-less here.
            // In multi-select mode ([[session-multi-select]]) the row is a checkbox instead: a click toggles
            // its pick (never switches the pane), and the row action menu is suppressed.
            const isPicked = selecting && picked.has(s.id)
            return (
              <button
                key={s.id}
                data-sid={s.id}
                className={`si-item${!selecting && active === s.id ? ' on' : ''}${isPicked ? ' picked' : ''}`}
                aria-expanded={it.expandable ? it.expanded : undefined}
                style={{ '--ov': labelColor(s.id) }}
                onClick={() => {
                  if (selecting) return togglePick(s.id)
                  activateTerminal(s.id)
                  if (it.expandable) toggleFold(s.id)
                }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!selecting) setCtxMenu({ x: e.clientX, y: e.clientY, session: s }) }}
                data-tip={s.ops?.length ? t('session.opsTitle') : t('session.lockTitle')}
              >
                {selecting && <span className={`si-check${isPicked ? ' on' : ''}`} aria-hidden="true" />}
                <SessionRow s={s} locked={false} showAvatar={false} lead={lead} />
              </button>
            )
          })}
        </aside>

        {/* the list's drag handle ([[resizable-panes]]) — straddles the list/content border. */}
        <div className="pane-resizer si-resizer" onMouseDown={listDrag} onDoubleClick={resetListW}
          role="separator" aria-orientation="vertical" aria-valuenow={Math.round(listW)} />

        <section className={active === 'new' ? 'si-content is-new' : 'si-content is-session'}>
          {active === 'new' && (
            <div className="si-new-center">
              <LaunchHero />
              {/* the ask line was removed by human direction, but its slot stays — the wordmark keeps its
                  breathing room above the input (an equal-height spacer, not a collapsed gap) */}
              <div className="si-ask-gap" aria-hidden="true" />
              <div
                className={dragTarget === 'new' ? 'si-inputwrap dragover' : 'si-inputwrap'}
                onDragOver={(e) => onDragOverFiles(e, 'new')}
                onDragLeave={() => setDragTarget(null)}
                onDrop={(e) => onDropFiles(e, 'new')}
              >
                <ComposerTextarea
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
                  data-tip={t('session.attachTitle')}
                  onClick={() => pickFiles('new')}
                  disabled={uploading}
                >{uploading && attachAt === 'new' ? <BusyGlyph /> : <AttachGlyph />}</button>
                {uploadErr && attachAt === 'new' && <span className="si-attach-err" role="alert">{t('session.attachError')}</span>}
                {menu && (menu.kind === 'mention' || menu.kind === 'actor') && mentionMenuEl(false)}
                {/* config-preset palette — same `/` dropdown, opening downward under the centered box. */}
                {menu && menu.kind === 'config' && slashMenu(false, menu.query ? `/${menu.query}` : t('session.menuPresets'))}
              </div>
              {/* launcher picker — the only launch choice ([[launcher-select]]): the pop-out button picker
                  (LauncherPicker above) with per-launcher harness marks and read-only cmd details. */}
              {launchers.length ? <LauncherPicker launchers={launchers} launcher={launcher} pickLauncher={pickLauncher} /> : null}
              <div className="si-hint">
                {t('session.hint.before')}<code>[[</code>{t('session.hint.mid')}<code>/</code>{t('session.hint.after')}
              </div>
            </div>
          )}
          {/* the session pane stays LAID OUT under the New tab so warm terminals keep their final geometry;
              visibility hides it without a 0x0 renderer. The compact toolbar carries one real Terminal tab,
              one native Eval door, and registry-filtered icon tools. Identity/state already lives in the
              selected sidebar row and is deliberately not repeated here. */}
          <div
            className="si-session-wrap"
            aria-hidden={active === 'new'}
            style={{
              display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0,
              position: active === 'new' ? 'absolute' : 'relative',
              inset: active === 'new' ? 0 : undefined,
              visibility: active === 'new' ? 'hidden' : 'visible',
              pointerEvents: active === 'new' ? 'none' : 'auto',
            }}
          >
              <header className="si-tabbar" aria-label={t(terminalFree ? 'session.conversationToolbarLabel' : 'session.toolbarLabel')}>
                <div className="si-surface">
                  <div className="si-tabs" role="tablist" aria-label={t('session.surfaceLabel')}>
                    <button
                      type="button"
                      id={surfaceTabId}
                      role="tab"
                      aria-selected="true"
                      aria-controls={`${surfacePanelId}-${active}`}
                      className="si-tab on"
                      onClick={() => activateTerminal(active)}
                    >
                      <Icon name={terminalFree ? 'message-square' : 'terminal'} size={13} />
                      <span className="si-tab-label">{t(terminalFree ? 'session.tabConversation' : 'session.tabTerminal')}</span>
                    </button>
                  </div>
                </div>

                <a
                  className="si-eval-door si-tab-door sc-cyan"
                  href={active !== 'new' ? addressHash(sessionEvalAddress(active)) : null}
                  data-tip={evalDoorTitle}
                  aria-label={evalDoorTitle}
                >
                  <Icon name="evals" size={14} />
                  <span className="si-eval-label">{t('session.tabEval')}</span>
                  <SessionEvalStats summary={evalSummary} />
                  <Icon name="chevron-right" size={12} className="si-eval-arrow" />
                </a>

                <div className="si-actions" role="group" aria-label={t('session.commandsLabel')}>
                  {uiCmds.filter((c) => c.button)
                    // Resident right-anchored tools (Command Box) sort to the row's right edge; transient action
                    // buttons keep their registry order to its left. Stable sort preserves that left order.
                    .sort((a, b) => (a.anchor === 'right' ? 1 : 0) - (b.anchor === 'right' ? 1 : 0))
                    .map((c) => {
                    const pressed = c.pressed ? commandOpen : undefined
                    const state = pressed ? ' on' : ''
                    return (
                      <IconButton
                        key={c.name}
                        icon={c.icon}
                        size={14}
                        label={t(c.titleKey)}
                        className={`si-tool sc-${c.color} ${c.name}${state}`}
                        data-command={c.name}
                        aria-pressed={pressed}
                        onClick={c.run}
                      />
                    )
                  })}
                </div>
              </header>
              {/* The live terminal stays mounted when the Eval door routes the app away (warm-terminals
                  contract); the routed session page is display-hidden, so socket + scroll survive. */}
              <div
                className={`si-term-body${terminalFree ? ' is-conversation' : ''}`}
                id={`${surfacePanelId}-${active}`}
                role="tabpanel"
                aria-labelledby={surfaceTabId}
                style={{ position: 'relative' }}
              >
                {/* every opened session's pane stays mounted; only the active one is shown. */}
                {[...opened].map((id) => {
                  const session = sessions.find((candidate) => candidate.id === id)
                  const headless = isHeadlessSession(session)
                  return (
                    <div key={id} className="si-term-layer" style={{
                      position: 'absolute', inset: 0,
                      visibility: id === active ? 'visible' : 'hidden',
                      pointerEvents: id === active ? 'auto' : 'none',
                    }}>
                      {headless
                        ? <TimelineChat s={session} sessions={sessions} active={open && id === active} />
                        : <SessionTerm sessionId={id} active={open && id === active}
                            focused={open && id === active && !commandOpen && !showRelaunch}
                            focusRequest={id === active ? terminalFocusRequest : 0} />}
                    </div>
                  )
                })}
                {showRelaunch && (
                  <div className="si-offline">
                    <div className="si-offline-msg">{t('session.offlineMsg')}</div>
                    <div className="si-offline-sub">{t('session.offlineSubBefore')}<code>{active.slice(0, 8)}…</code>{t('session.offlineSubAfter')}</div>
                    <button className="si-act go big" onClick={() => act('resume')}>{t('session.relaunchResume')}</button>
                    {actErr && <div className="si-offline-err" role="alert">{actErr}</div>}
                  </div>
                )}
                {commandOpen && !noLivePane && (
                  <div className="si-command-layer" role="dialog" aria-label={t('session.commandBox')}>
                    <button type="button" className="si-command-dismiss" tabIndex={-1}
                      aria-label={t('session.commandClose')} onMouseDown={() => setCommandOpen(false)} />
                    <ComposerSurface
                      className={`si-command-box${sendErr ? ' err' : ''}${dragTarget === 'command' ? ' dragover' : ''}`}
                      onDragOver={(e) => onDragOverFiles(e, 'command')}
                      onDragLeave={() => setDragTarget(null)}
                      onDrop={(e) => onDropFiles(e, 'command')}
                      editor={(
                        <div className="fv-tawrap">
                          <ComposerTextarea ref={msgRef} className="si-command-input" rows={1} value={msg}
                            data-focus-sink
                            onChange={(e) => { setMsg(e.target.value); if (sendErr) setSendErr(false); syncMenu(e.target) }}
                            onSelect={(e) => syncMenu(e.target)}
                            onPaste={(e) => onPasteFiles(e, 'command')}
                            onBlur={() => setMenu(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey && !composingKey(e)) {
                                e.preventDefault(); e.stopPropagation(); sendMsg()
                              }
                            }}
                            placeholder={t('session.commandPlaceholder')} spellCheck={false} />
                          {menu && menu.kind === 'slash' && slashMenu(true, menu.query ? `/${menu.query}` : t('session.menuCommands'))}
                          {menu && (menu.kind === 'mention' || menu.kind === 'actor') && mentionMenuEl(true)}
                        </div>
                      )}
                      footer={(
                        <div className="si-command-tools">
                          <span className="si-command-title"><Icon name="command" size={12} />{t('session.commandBox')}</span>
                          <button type="button" className="fv-trigger-btn" data-tip={t('thread.mentionActor')}
                            aria-label={t('thread.mentionActor')}
                            onClick={() => insertCommandTrigger('@')}>@</button>
                          <button type="button" className="fv-trigger-btn" data-tip={t('thread.mentionNode')}
                            aria-label={t('thread.mentionNode')}
                            onClick={() => insertCommandTrigger('[[')}>[[</button>
                          <button type="button" className="fv-trigger-btn" data-tip={t('session.menuCommands')}
                            aria-label={t('session.menuCommands')}
                            onClick={() => insertCommandTrigger('/')}>/</button>
                          <IconButton icon={uploading && attachAt === 'command' ? 'loader' : 'paperclip'} size={14}
                            iconClassName={uploading && attachAt === 'command' ? 'si-attach-busy' : undefined}
                            className="si-command-tool" label={t('session.attachTitle')}
                            disabled={uploading} onClick={() => pickFiles('command')} />
                          {uploadErr && attachAt === 'command' && <span className="si-attach-err" role="alert">{t('session.attachError')}</span>}
                          {sendErr && <span className="si-send-err" role="alert">{t('session.msgError')}</span>}
                          <IconButton icon="send" size={14} className="si-command-send" label={t('session.commandSend')}
                            disabled={!msg.trim()} onClick={sendMsg} />
                        </div>
                      )}
                    />
                  </div>
                )}
                </div>
          </div>
        </section>
      </div>
    </div>
    <SessionContextMenu
      menu={ctxMenu}
      onClose={() => setCtxMenu(null)}
      onChanged={reload}
      onLock={(s) => { onPickSession?.(s, false); onClose() }}
      onMultiSelect={enterSelect}
    />
    </>
  )
}
