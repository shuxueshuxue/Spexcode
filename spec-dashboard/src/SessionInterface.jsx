import { useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'
import TimelineChat from './TimelineChat.jsx'
import { labelColor } from './color.js'
import { composeLaunch, createSession, useLaunchers, useCommandPresets, launcherModes } from './launch.js'
import { sessionForest } from './session.js'
import { MENTION_RE, nodeMentionAt, actorMentionAt, MentionMenu, matchSlash, SlashMenu } from './mentions.jsx'
import { SessionRow, RowLead, useFold } from './SessionWindow.jsx'
import { HARNESS_BY_ID } from './harness.jsx'
import { Icon } from './icons.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import SessionSelectBar from './SessionSelectBar.jsx'
import SessionEvalPane from './SessionEval.jsx'
import { useResizable } from './useResizable.js'
import { uiCommandsFor } from './sessionCommands.js'
import { fitTextarea } from './textarea.js'
import FoldToggle from './FoldToggle.jsx'
import ModeToggle from './ModeToggle.jsx'
import { useT } from './i18n/index.jsx'

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

// Window-level (capture) key handling, not panel onKeyDown: arrowing off the New Session tab unmounts its
// textarea, so a panel listener would lose focus and kill nav; a window listener is focus-independent.

// DOM KeyboardEvent.key → the base key name the keys-kind input feeds tmux send-keys (non-printables only; modifier
// combos are encoded by typeKeyToken). Escape is intentionally absent — handled separately.
const RAWKEY = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', ' ': 'Space' }

// @@@ composing — an Enter (or Tab) that COMMITS an IME composition (pinyin, かな, 한글…) belongs to the
// input: it picks a candidate and composes the word, and must NEVER be read as dispatch/accept. The browser
// flags such a key event with `isComposing` / legacy keyCode 229. Works for both a native window event
// (isComposing/keyCode direct) and a React synthetic (nativeEvent.isComposing).
const composingKey = (e) => e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229

// Encode a keydown into a tmux token (⌃→`C-`, ⌥/⌘→`M-`, Shift→`S-` on named keys). The base of a
// modified letter/digit comes from e.code, not e.key: a held modifier makes e.key unreliable (⌥B prints
// '∫' on a mac), but the physical KeyB/Digit3 code is stable. null = nothing sendable → key swallowed.
function typeKeyToken(e) {
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
// SHARED module ./mentions.jsx ([[mentions]]): one autocomplete for the console and the issue composers.

// the textarea auto-grow (reset + clamp at a per-surface max-height) is the SHARED ./textarea.js
// fitTextarea — one routine for the New-tab prompt, the ❯ inbox, and the thread composers.

// the `/` matcher + dropdown render (matchSlash, SlashMenu) are the SHARED module ./mentions.jsx too —
// one ranking and one row markup for every `/` palette (this console's two + the eval detail's review menu).

// @@@launcher pop-out picker ([[launcher-select]]) — the desktop launch choice: a clean pill button (the
// selected launcher's harness vendor mark + name, no caret, no label; a small ◇ joins it while headless
// is armed) that opens a CENTRED pop-out card — a viewport-centred dialog over a light backdrop,
// deliberately not an anchored dropdown. The card leads with the session-MODE segmented switch
// (⌨ interactive | ◇ headless — the shared ModeToggle), then one row per configured launcher: its harness
// glyph + name, and beneath them the command THE ARMED MODE would run — `cmd` in interactive, `headlessCmd`
// in headless (a headless-capable launcher with no own command runs server-side; its row says so as a
// placeholder) — in full as PLAIN READ-ONLY display text. A row the armed mode can't launch greys out
// (aria-disabled — the real `disabled` attr would mute the hover events the config-repair tooltip needs)
// and refuses the pick. Otherwise the WHOLE row is one pick target — the row itself is the button, so a
// click anywhere on it (the cmd line included) picks the launcher; the cmd never forms an independent
// selection/control surface that could swallow the pick. The
// trigger's tooltip points at spexcode.json / spexcode.local.json as the one place launchers change.
// Selecting closes the pop; backdrop click or Esc closes it too. `modeNotice` (a remembered/attempted
// headless pick bounced back to interactive) renders as an inline alert — in the card when open, beside
// the pill otherwise — so the fallback is visible wherever it happens.
function LauncherPicker({ launchers, launcher, pickLauncher, mode, pickMode, modeNotice }) {
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
  const notice = modeNotice
    ? <span className="si-mode-notice" role="alert">{t('session.modeFellBack', { name: modeNotice })}</span>
    : null
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
        {mode === 'headless' && <span className="si-launcher-mode-mark" title={t('session.modeHeadless')}>◇</span>}
      </button>
      {!pop && notice}
      {pop && (
        <>
          {/* full-viewport backdrop — the outside-click close surface; a mousedown here is inert chrome
              under the panel's keepFocus blanket, so the composer keeps focus while the pop closes. */}
          <div className="si-launcher-backdrop" onMouseDown={() => setPop(false)} />
          <div className="si-launcher-pop" role="dialog" aria-modal="true" aria-label={t('session.launcherLabel')}>
            <ModeToggle mode={mode} pickMode={pickMode} headlessOk={launcherModes(selected).includes('headless')} />
            {notice}
            {launchers.map((l) => {
              const h = HARNESS_BY_ID[l.harness] || HARNESS_BY_ID.claude
              const HGlyph = h.Glyph
              const avail = launcherModes(l).includes(mode)
              // headless-capable with no own headlessCmd = the executor is server-side (backend `modes`
              // said yes without a command) — the cmd line shows that as a placeholder, not a blank.
              const serverSide = mode === 'headless' && avail && !l.headlessCmd
              const cmdText = mode === 'headless' ? l.headlessCmd : l.cmd
              return (
                <button
                  key={l.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.name === launcher}
                  aria-disabled={!avail}
                  data-tip={avail ? undefined : t('session.modeUnavailableTip')}
                  className={`si-launcher-row${l.name === launcher ? ' on' : ''}${avail ? '' : ' off'}`}
                  onClick={() => { if (!avail) return; pickLauncher(l.name); setPop(false) }}
                >
                  <span className="si-launcher-row-main">
                    <span className="si-launcher-harness" data-tip={h.label} aria-hidden="true"><HGlyph /></span>
                    <span className="si-launcher-name">{l.name}</span>
                    {l.name === launcher && <Icon name="check" size={13} className="si-launcher-check" />}
                  </span>
                  {/* the cmd — read-only display text; part of the same pick target, never its own surface. */}
                  {serverSide
                    ? <span className="si-launcher-cmd si-launcher-cmd-ph">{t('session.headlessServerSide')}</span>
                    : cmdText ? <span className="si-launcher-cmd">{cmdText}</span> : null}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function SessionInterface({ sessions, specs = [], focusNode, open, searchOpen = false, sel, setSel, seed, onSeedConsumed, evalSeed, onEvalSeedConsumed, onClose, onPickSession, onOpenSession, onOpenSearch, reload }) {
  const t = useT()
  const [prompt, setPrompt] = useState('')    // the New Session tab's own draft (its boarding-switch cache)
  const [menu, setMenu] = useState(null)      // completion dropdown: { kind:'mention'|'config'|'slash', items, index, start, end, query }
  const [ctxMenu, setCtxMenu] = useState(null) // session-row right-click menu { x, y, session } — the RENAME gesture lives here, on the board's session list
  const [selecting, setSelecting] = useState(false)  // multi-select mode ([[session-multi-select]]): rows become checkboxes, not tabs
  const [picked, setPicked] = useState(() => new Set()) // the ids ticked for bulk close while `selecting`
  const [slashCmds, setSlashCmds] = useState([])   // the `/` command list (built-in + user/project/skill), fetched once
  // bottom-input drafts, keyed by session id — each session tab keeps its OWN typed-but-unsent line, never
  // a single shared box. Survives tab switches and close/reopen (the panel stays mounted, see `open`).
  const [drafts, setDrafts] = useState({})
  // named launcher profiles ([[launcher-select]]) — a launcher fuses (harness, cmd), so this is the sole
  // launch choice; the fetch + default resolution live in the shared launch path (./launch.js), as does
  // the session-mode axis (interactive | headless) and its illegal-combo fallback.
  const { launchers, launcher, pickLauncher, mode, pickMode, modeNotice } = useLaunchers()
  const [sendErr, setSendErr] = useState(false)   // last text dispatch failed — surfaced under the ❯ box
  const [actErr, setActErr] = useState(null)      // last lifecycle action refused/failed (e.g. the resume guard: relaunching a LIVE agent) — surfaced by the relaunch panel
  const [typeMode, setTypeMode] = useState(false)
  const [menuById, setMenuById] = useState({})   // per-pane menu-sniff flag from each SessionTerm; drives the type button's `.suggest` pulse
  // which of the right pane's two tabs is showing: the live terminal (default) or the always-available eval.
  const [rightTab, setRightTab] = useState('terminal')
  // the Eval tab's deep-link target ({node,scenario}|null) — set by the one-shot evalSeed below, handed to
  // the pane as its initial selection; cleared on tab switch so a later manual visit opens fresh.
  const [evalJump, setEvalJump] = useState(null)
  // the Eval tab auto-collapses the session list to a thin strip ([[session-console]] / [[evals-view]]'s
  // fold-to-strip): the eval tab is itself a master-detail whose scenario list needs the width, so the
  // console's session list folds out of the way while it's shown and unfolds on the way back to Terminal.
  const [listFolded, setListFolded] = useState(false)
  // The fold is only ever visible on the Eval tab. `listFolded` is driven by a LAGGING effect (below) that
  // fires one render AFTER `rightTab` flips, so gating the render on it alone would, on the way BACK to
  // Terminal, paint the terminal for one frame at the wide (list-folded) width and then snap it narrow — two
  // spurious resizes that reflow a NORMAL-screen (codex) pane into a scroll-through-history redraw (an
  // alternate-screen pane hides it by redrawing in place). Gate the DISPLAY on the tab too, so returning to
  // Terminal shows the list — and the terminal's real width — synchronously, with no transient reflow.
  const showFolded = listFolded && rightTab === 'eval'
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState(false)
  const [dragTarget, setDragTarget] = useState(null)
  const [attachAt, setAttachAt] = useState(null)  // surface the in-flight/last upload targets — drives the spinner + error placement
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
  const validIds = useMemo(() => new Set(['new', ...sessions.map((s) => s.id)]), [sessions])
  // content mode: 'new' or a session id (the issues list left for its own page — [[issues-view]] / [[side-nav]]).
  const active = validIds.has(sel) ? sel : 'new'
  // a removed session (closed here, ended on its own, or closed elsewhere) leaves the tab unresolved: land
  // on New only if you're still on the now-gone tab. Mirrors `active`'s validity test. Only while the page
  // is showing — a background board refresh must not clobber the remembered tab (or the URL echo) mid-boot.
  useEffect(() => {
    if (open && !validIds.has(sel)) setSel('new')
  }, [open, validIds, sel, setSel])
  // the session list is a user-resizable pane ([[resizable-panes]]): drag the divider, width persists.
  const [listW, listDrag] = useResizable('spex.siListWidth', 240, { min: 180, max: 480 })
  const focusId = focusNode?.id || null
  const selSession = sessions.find((s) => s.id === active)
  // liveness, not the lifecycle label, gates terminal vs relaunch ([[state]]). showRelaunch skips `queued`
  // (it self-starts as a slot frees, so it gets no relaunch button).
  const noLivePane = selSession?.liveness === 'offline'
  const showRelaunch = noLivePane && selSession?.status !== 'queued'
  // mode dispatch ([[session-console]] × the headless mode): an interactive session's right pane is the
  // live tmux terminal; a HEADLESS session has no TUI to watch — its pane is the shared TimelineChat
  // ([[mobile-ui]]'s terminal-free conversation), whose composer owns input (replyVia:'note' fixed), so
  // the ❯ strip and type mode don't apply. Old records carry no mode and read interactive — unchanged.
  const isHeadless = selSession?.mode === 'headless'
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

  // the command presets — the New Session box's `/` palette (tidy/health/…). Picking one composes its body
  // into the launch prompt (see submit); listing is display-only, like the slash menu. Shared fetch (./launch.js).
  const commandPresets = useCommandPresets()

  // type mode binds to ONE live session's menu — leaving the tab (or it going offline) exits it, so raw
  // keystrokes can never leak into the wrong pane.
  useEffect(() => { setTypeMode(false); setSendErr(false); setMenu(null); setRightTab('terminal'); setEvalJump(null) }, [active])
  // the eval deep link ([[session-eval]]): '#/sessions/<id>/eval[/<node>/<scenario>]' seeds this one-shot —
  // flip the right pane to the Eval tab and hand the pane its target reading. Declared AFTER the [active]
  // reset above so a deep load applies on top of it (effects run in declaration order within a commit).
  useEffect(() => {
    if (evalSeed == null) return
    setRightTab('eval')
    setEvalJump(evalSeed.node && evalSeed.scenario ? { node: evalSeed.node, scenario: evalSeed.scenario } : null)
    onEvalSeedConsumed?.()
  }, [evalSeed]) // eslint-disable-line react-hooks/exhaustive-deps
  // fold the session list on the Eval tab, unfold on Terminal. Keyed on the tab TRANSITION (not held
  // continuously), so a manual unfold on the Eval tab sticks — it only re-folds when you re-enter the tab.
  useEffect(() => { setListFolded(rightTab === 'eval') }, [rightTab])
  // returning to the Terminal tab re-focuses the ❯ input — switching to Proof and back must not strand the
  // caret. Only when live and not in type mode; rAF waits for the input to (re)mount under the Terminal tab.
  useEffect(() => {
    if (rightTab === 'terminal' && active !== 'new' && !typeMode && selSession && selSession.liveness !== 'offline') {
      requestAnimationFrame(() => msgRef.current?.focus())
    }
  }, [rightTab])
  useEffect(() => { if (selSession?.liveness === 'offline') setTypeMode(false) }, [selSession?.liveness])
  useEffect(() => { setActErr(null) }, [active])   // a stale action error must not bleed onto the next session's panel
  // leaving type mode hands focus back to the ❯ box. Guarded to the on→off edge for a live tab — a tab
  // switch or going offline exits type mode too, but the tab-focus effect owns focus there.
  const wasTypeRef = useRef(false)
  useEffect(() => {
    if (wasTypeRef.current && !typeMode && active !== 'new' && selSession?.liveness !== 'offline') msgRef.current?.focus()
    wasTypeRef.current = typeMode
  }, [typeMode])
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
    fetch(`/api/sessions/${id}/input`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'keys', keys }),
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
  // the Eval tab or type mode replaces it and remounts at rows=1, so those flips must re-fit it too — the
  // draft survives the round-trip and the grown height must survive with it.
  useEffect(() => {
    const ta = msgRef.current
    if (!ta || active === 'new' || !open) return
    const maxH = Math.round((termRef.current?.clientHeight || 360) * 0.5)
    ta.style.maxHeight = `${maxH}px`
    fitTextarea(ta, maxH)
  }, [msg, active, open, rightTab, typeMode])

  // the launch grammar composition (`/<preset> [[node]]… <free text>` → one prompt) is the SHARED
  // composeLaunch from ./launch.js — one implementation for this tab and the phone's composer.

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
    const text = composeLaunch(raw, commandPresets, specs)
    setPrompt('')
    createSession(text, launcher, mode).then(() => reload?.())
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
        const items = matchSlash(commandPresets, cm[1])
        if (!items.length) return null
        return { kind: 'config', items, index: 0, start: 0, end: value.length, query: cm[1] }
      }
      return null
    }
    const sm = value.match(/^\/(\S*)$/)
    if (sm) {
      // the board's own commands (coloured, run HERE) lead the menu; CC's commands follow. matchSlash is a
      // stable prefix rank, so the board set keeps its lead within each score band.
      const ui = uiCmds.map((c) => ({ name: c.name, description: t(c.descKey), ui: true, color: c.color }))
      // a board command OVERRIDES a same-named CC command — one identity, one row, never a duplicate.
      const owned = new Set(ui.map((c) => c.name))
      const items = matchSlash([...ui, ...slashCmds.filter((c) => !owned.has(c.name))], sm[1])
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
      if (item.ui) { const c = uiCmds.find((x) => x.name === item.name); setMsg(''); setMenu(null); c?.run(); return }
      const insert = `/${item.name} `
      const before = msg.slice(0, menu.start)
      setMsg(before + insert + msg.slice(menu.end))
      setMenu(null)
      const caret = before.length + insert.length
      requestAnimationFrame(() => { const el = msgRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
      return
    }
    // command preset → the New prompt (composed at launch); a `[[`-mention/`@`-actor → whichever box is
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

  // both `/` palettes — the inbox's CC-command menu (`up`, opens above the box) and the New box's
  // config-preset menu (downward) — render through the ONE shared SlashMenu; only the head label differs.
  const slashMenu = (up, head) => (
    <SlashMenu menu={menu} up={up} head={head} onPick={accept}
      onHover={(i) => setMenu((m) => (m ? { ...m, index: i } : m))} />
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
    const cmd = uiCmds.find((c) => raw.trim() === `/${c.name}`)
    if (cmd) { setMsg(''); setMenu(null); cmd.run(); return }
    // resolve any `[[<node>]]` to a live spec.md pointer before it reaches the agent (the running-session twin
    // of the New Session launch composition — see [[term-input]]).
    const text = expandMentions(raw)
    setMsg('')
    setSendErr(false)
    try {
      const res = await fetch(`/api/sessions/${active}/input`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', text }),
      })
      if (!res.ok) throw new Error(`input ${res.status}`)
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

  // lifecycle actions — thin POSTs to the session state machine, then reload the board. A non-2xx carrying an
  // `error` is surfaced LOUD via actErr (the resume guard refuses a relaunch on a live agent with 409 — the
  // human must SEE that, never a silent no-op that reads as "it didn't work").
  const act = async (verb) => {
    setActErr(null)
    try {
      const res = await fetch(`/api/sessions/${active}/${verb}`, { method: 'POST' })
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

  // `runners` binds each board-command name to the closure that DOES it — the SAME closure the header
  // button's onClick fires; `uiCmds` narrows the registry to the current session state. See [[term-input]].
  const runners = {
    type: () => setTypeMode((v) => !v),
    eval: () => setRightTab('eval'),
    merge: () => act('merge'),
    stop: () => act('stop'),     // soft stop: kill tmux + socket, KEEP the worktree → session goes offline + relaunch panel
    close: () => act('close'),   // removal: kill + remove the worktree + branch (the row right-click Close's twin)
  }
  const uiCmds = uiCommandsFor(selSession?.status, runners)
    // a headless session has no terminal to take over — the type channel doesn't exist there, so its
    // button/command drop off (the chord below is guarded the same way).
    .filter((c) => !(isHeadless && c.name === 'type'))
  // window-level key router: ↑/↓ walk the list regardless of focus; Enter on New launches.
  const stateRef = useRef({})
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, searchOpen, typeMode, setTypeMode, sendRawKey, isHeadless }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, searchOpen, typeMode, setTypeMode, sendRawKey, isHeadless } = stateRef.current
      if (!open || searchOpen) return   // panel hidden, OR the search palette modal is open above us and owns the keys: nothing here listens
      // reserved ⌥/⌘+I toggles type mode: handled before everything else, never forwarded to tmux. Matched by
      // e.code (the physical I key) because ⌥I on a mac prints a dead-key glyph, not 'i'. The chord is a
      // SINGLE modifier + I: ⌥+I XOR ⌘+I. Both held together (⌥⌘I) is the browser's own devtools accelerator —
      // let it through so the console opens rather than toggling type mode.
      const isI = e.code === 'KeyI' || e.key === 'i' || e.key === 'I'
      if ((e.altKey !== e.metaKey) && isI && active !== 'new' && !isHeadless) {
        e.preventDefault(); e.stopPropagation(); setTypeMode((v) => !v); return
      }
      // the app's GLOBAL ⌥ command family — ⌥N (New Session composer), ⌥F (evals), ⌥1..⌥4 (pages) — is
      // reserved over the console too, type mode included (the same standing as ⌥/⌘+I above): fall through
      // UNHANDLED so the App-level window listener (registered after this child's, so next in the capture
      // chain) routes it — never forwarded to tmux. Matched by e.code for the same mac ⌥-dead-key reason as
      // ⌥I. ⌘/⌃ variants stay with the browser (⌘N/⌃N are its hard-reserved new-window accelerator anyway).
      if (e.altKey && !e.metaKey && !e.ctrlKey && ['KeyN', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) return
      // ⌘/⌥/⌃+↑/↓ walk the session list — kept ABOVE the type-mode passthrough so they fire even while
      // raw-key mode forwards to a pane, and the modifier frees ↑/↓ from any caret/typing conflict.
      if (e.metaKey || e.altKey || e.ctrlKey) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation()
          let i = order.indexOf(active); if (i < 0) i = 0
          const ni = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
          setSel(order[ni]); return
        }
      }
      // type mode: forward EVERY key raw to the pane (⌃/⌥/⌘ combos encoded by typeKeyToken), nothing else fires.
      if (typeMode && active !== 'new') {
        e.preventDefault(); e.stopPropagation()
        // Escape always forwards — it belongs to the agent's own menus; exiting type mode is the
        // toggle chord / button / /type only, never a keystroke the pane also wants.
        if (e.key === 'Escape') { sendRawKey('Escape'); return }
        const token = typeKeyToken(e)
        if (token) sendRawKey(token)
        return
      }
      // a completion menu owns navigation/commit/dismiss while it's open — on the New Session prompt
      // (`[[`-mention) OR a session's ❯ inbox (slash). The capture-phase listener claims Enter before the
      // inbox textarea's own onKeyDown, so picking a command never also dispatches the line.
      if (menu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navMenu(1); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); navMenu(-1); return }
        if ((e.key === 'Enter' || e.key === 'Tab') && !composingKey(e)) { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return }
        if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
      }
      // (no bottom Esc rung: Esc never leaves a page — [[side-nav]]. Menus/type-mode claimed theirs above;
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
      if (e.key === 'Enter' && !e.shiftKey && !composingKey(e) && active === 'new') { e.preventDefault(); e.stopPropagation(); submit() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setSel])

  const isTextField = (t) => t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)

  // focus the docked input — whichever box is currently mounted (the New-tab prompt when it's up, else the
  // session ❯ box; both null in type mode / offline, where there's no input to land in).
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
    // a native <select> opens its dropdown ON the default mousedown action — preventDefault would suppress
    // it from ever opening, so leave native form controls alone. Focus retention only needs to blanket the
    // inert chrome, not any interactive control that owns its own mousedown. (No select currently renders
    // in the panel — the launcher picker is now a button pop-out, which fires onClick regardless — but the
    // carve-out stays: it is the rule any future native control relies on.)
    if (t.closest && t.closest('select')) return
    // the terminal owns its own text selection — preventing default on it would break the drag-select.
    if (t.closest && t.closest('.si-term-body')) return
    // The Eval tab is an inspection workspace, not inert console chrome; its text must select just like the
    // top-level Evals page that renders the same components.
    if (t.closest && t.closest('.se-pane')) return
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
        {/* folded (Eval tab): the whole strip is the unfold affordance, mirroring the Evals page's master-list
            fold ([[evals-view]]'s .fv-unfold). The list stays MOUNTED (display:none) behind it, so its zone
            grouping / nesting-fold / selection survive — the fold is pure geometry. */}
        {showFolded && (
          <FoldToggle className="si-list-unfold" folded onToggle={() => setListFolded(false)} />
        )}
        <aside className="si-list" style={showFolded ? { display: 'none' } : { flex: `0 0 ${listW}px` }}>
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
            if (it.type === 'zone') return <div className={`si-zone si-zone-${it.zone}`} key={`zone-${it.zone}`}>{t(`sessionZone.${it.zone}`)}</div>
            const s = it.s
            const lead = (it.expandable || it.depth)
              ? <RowLead guides={it.guides} expandable={it.expandable} expanded={it.expanded} rollup={it.rollup} kin={it.kin} onToggle={() => toggleFold(s.id)} />
              : null
            // single click switches tab; double-click locks the session and returns to the graph — no
            // pending-ops precondition: an ops-less session still locks (the banner explains the empty
            // grip), the console-side twin of the board window's single-click lock.
            // The face is the shared SessionRow, avatar-less here.
            // In multi-select mode ([[session-multi-select]]) the row is a checkbox instead: a click toggles
            // its pick (never switches the pane), and the rename/lock gestures are suppressed.
            const isPicked = selecting && picked.has(s.id)
            return (
              <button
                key={s.id}
                data-sid={s.id}
                className={`si-item${!selecting && active === s.id ? ' on' : ''}${isPicked ? ' picked' : ''}`}
                style={{ '--ov': labelColor(s.id) }}
                onClick={() => (selecting ? togglePick(s.id) : setSel(s.id))}
                onDoubleClick={() => { if (!selecting && onPickSession) { onPickSession(s, false); onClose() } }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!selecting) setCtxMenu({ x: e.clientX, y: e.clientY, session: s }) }}
                data-tip={s.ops?.length ? t('session.opsTitle') : t('session.lockTitle')}
              >
                {selecting && <span className={`si-check${isPicked ? ' on' : ''}`} aria-hidden="true" />}
                <SessionRow s={s} locked={false} showAvatar={false} lead={lead} />
              </button>
            )
          })}
        </aside>

        {/* the list's drag handle ([[resizable-panes]]) — straddles the list/content border. Hidden while the
            list is folded to a strip: there's no width to resize when the detail owns it all. */}
        {!showFolded && <div className="pane-resizer si-resizer" onMouseDown={listDrag} role="separator" aria-orientation="vertical" />}

        <section className={active === 'new' ? 'si-content is-new' : `si-content is-session${isHeadless ? ' is-headless' : ''}`}>
          {active === 'new' && (
            <div className="si-new-center">
              <LaunchHero />
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
                  (LauncherPicker above) with the mode toggle, per-launcher harness marks and read-only
                  per-mode cmd details. */}
              {launchers.length ? <LauncherPicker launchers={launchers} launcher={launcher} pickLauncher={pickLauncher} mode={mode} pickMode={pickMode} modeNotice={modeNotice} /> : null}
              <div className="si-hint">
                {t('session.hint.before')}<code>[[</code>{t('session.hint.mid')}<code>/</code>{t('session.hint.after')}
              </div>
            </div>
          )}
          {/* the session pane stays MOUNTED even on the New tab (just display:none) so the terminals'
              WebSockets + scroll survive the tab switch. A horizontal TAB BAR (Terminal | Eval) sits above
              the pane content — it replaces the old floating title/action strip, is visibly set apart from the
              dark terminal below (panel background + separator, both themes), and carries the lifecycle actions
              on its right. */}
          <div
            className="si-session-wrap"
            style={{ display: active === 'new' ? 'none' : 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
          >
              <div className="si-tabbar">
                {/* two tabs on the left: the live terminal (default) and the always-available eval. */}
                <div className="si-tabs" role="tablist">
                  {/* the first tab reads by the session's MODE: Terminal for an interactive pane, Chat for a
                      headless session's terminal-free conversation — same slot, same tab state. */}
                  <button role="tab" aria-selected={rightTab === 'terminal'} className={rightTab === 'terminal' ? 'si-tab on' : 'si-tab'} onClick={() => setRightTab('terminal')}>{t(isHeadless ? 'session.tabChat' : 'session.tabTerminal')}</button>
                  <button role="tab" aria-selected={rightTab === 'eval'} className={rightTab === 'eval' ? 'si-tab on' : 'si-tab'} onClick={() => setRightTab('eval')}>{t('session.tabEval')}</button>
                </div>
                {/* no headline here: the left sidebar already identifies the session; the tab bar is just the
                    Terminal|Eval tabs (left) + lifecycle actions (right). */}
                <div className="si-actions">
                  {showRelaunch
                    ? <button className="si-act go" onClick={() => act('resume')}>{t('session.relaunch')}</button>
                    : uiCmds.filter((c) => c.button).map((c) => {
                        // type alone carries extra state: `.on` while active, `.suggest` while the pane sniff
                        // thinks a select menu is up (the pulse that invites type mode).
                        const state = c.name === 'type' ? (typeMode ? ' on' : (menuById[active] ? ' suggest' : '')) : ''
                        return (
                          <button
                            key={c.name}
                            className={`si-act ui sc-${c.color} ${c.name}${state}`}
                            data-tip={t(c.titleKey)}
                            onClick={c.run}
                          >{t(c.labelKey)}</button>
                        )
                      })}
                </div>
              </div>
              {/* Terminal tab — the live pane stays MOUNTED across tab switches (warm-terminals contract); the
                  Eval tab merely hides it with display:none, never unmounts it, so socket + scroll survive. */}
              <div className="si-term-body" ref={termRef} style={{ position: 'relative', display: rightTab === 'terminal' ? undefined : 'none' }}>
                {/* every opened session's pane stays mounted; only the active one is shown. The pane is
                    dispatched by the session's MODE: interactive → the live tmux terminal; headless → the
                    shared TimelineChat (no TUI exists to watch — the timeline IS the conversation). The
                    chat polls only while it is the shown pane (`active`); its draft/scroll stay warm. */}
                {[...opened].map((id) => {
                  const sess = sessions.find((x) => x.id === id)
                  return (
                    <div key={id} className="si-term-layer" style={{ position: 'absolute', inset: 0, display: id === active ? 'block' : 'none' }}>
                      {sess?.mode === 'headless'
                        ? <TimelineChat s={sess} sessions={sessions} active={id === active && rightTab === 'terminal'} />
                        // active → this pane is the only one that holds a WebGL context (see SessionTerm).
                        : <SessionTerm sessionId={id} active={id === active} onMenu={reportMenu} />}
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
              </div>
              {/* the docked ❯ input belongs to the Terminal tab only (the Eval tab has nothing to type at) —
                  and to the INTERACTIVE mode only: a headless session's chat carries its own composer. */}
              {rightTab === 'terminal' && !isHeadless && (typeMode ? (
                // type mode replaces the prompt box: keys go straight to the pane (handled at the window level).
                <div className="si-bottom type" onClick={() => setTypeMode(false)} data-tip={t('session.typeExit')}>
                  <span className="si-type-ind">{t('session.typeInd')}</span>
                  <span className="si-type-help">{t('session.typeHelp')}</span>
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
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !composingKey(e)) { e.preventDefault(); e.stopPropagation(); sendMsg() } }}
                    placeholder={noLivePane ? t('session.msgOffline') : t('session.msgPlaceholder')}
                    spellCheck={false}
                    disabled={noLivePane}
                  />
                  <button
                    type="button"
                    className="si-attach"
                    data-tip={t('session.attachTitle')}
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
              {/* Eval tab — the session's derived evaluation rendered INLINE (always available, not
                  review-gated). Mounts on each visit so it reflects the live diff/loss/gates ([[session-eval]]).
                  "Open a session" from inside this tab means SHOW ITS CONSOLE: the eval detail's filer chip
                  routinely names the session already being viewed (its own filed readings), where the plain
                  openSession would no-op (selection unchanged, hash identical) and leave a dead button —
                  so flip the right pane to the terminal, and only navigate when the filer is another session. */}
              {rightTab === 'eval' && <SessionEvalPane sessionId={active} specs={specs} sessions={sessions} initialSel={evalJump}
                onOpenSession={(id) => { setRightTab('terminal'); if (id !== active) onOpenSession?.(id) }} />}
          </div>
        </section>
      </div>
    </div>
    <SessionContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} onChanged={reload} onMultiSelect={enterSelect} />
    </>
  )
}
