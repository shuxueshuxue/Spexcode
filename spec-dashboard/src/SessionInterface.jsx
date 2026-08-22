import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'
import TimelineChat from './TimelineChat.jsx'
import { createSession, useLaunchers, useCommandPresets } from './launch.js'
import { sessionFooterState, sessionHeadline } from './session.js'
import { MENTION_RE, nodeMentionAt, sessionMentionAt, slashTokenAt, MentionMenu, matchSlash, SlashMenu } from './mentions.jsx'
import { HARNESS_BY_ID } from './harness.jsx'
import { Icon, IconButton } from './icons.jsx'
import { ReviewState } from './ReviewShell.jsx'
import { TabCount } from './score.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import { inboxCommands, uiCommandsFor } from './sessionCommands.js'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { addressHash, navigateAddress, sessionEvalAddress } from './address.js'
import { navigate } from './route.js'
import { useI18n, useT } from './i18n/index.jsx'
import { apiFetch } from './data.js'
import { apiUrl, PROJECT_BASE } from './project.js'
import {
  SESSION_SURFACE_CONVERSATION,
  getSessionBaseSurface,
  setSessionBaseSurface,
  subscribeSessionSurface,
} from './sessionSurface.js'
import { inertChromePress } from './focus.js'
import { useEscLayer } from './escStack.js'
import RichText from './RichText.js'
import { useTransientNotice } from './TransientNotice.jsx'
import { decodePrompt, encodePrompt, selectionLabel } from './codeSelection.js'

const isHeadlessSession = (session) => session?.capabilities?.headless === true

const closedTime = (session) => {
  if (typeof session?.closedAt !== 'string') return null
  const value = Date.parse(session.closedAt)
  return Number.isFinite(value) ? value : null
}
const archiveOrder = (sessions) => [...sessions].sort((left, right) => {
  const a = closedTime(left)
  const b = closedTime(right)
  if (a == null && b == null) return left.id.localeCompare(right.id)
  if (a == null) return 1
  if (b == null) return -1
  return b - a || left.id.localeCompare(right.id)
})
const localDay = (time) => {
  if (time == null) return 'unknown'
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function ArchivePage({ sessions, onOpenSession, onClose }) {
  const { lang, t } = useI18n()
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  const rowRefs = useRef([])
  useEscLayer(true, onClose)
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(lang)
    if (!needle) return sessions
    return sessions.filter((session) => [sessionHeadline(session), session.label, session.id, session.node]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase(lang).includes(needle)))
  }, [sessions, query, lang])
  const groups = useMemo(() => {
    const result = []
    for (const session of rows) {
      const key = localDay(closedTime(session))
      const previous = result[result.length - 1]
      if (previous?.key === key) previous.rows.push(session)
      else result.push({ key, rows: [session] })
    }
    return result
  }, [rows])
  const today = localDay(Date.now())
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = localDay(yesterdayDate)
  const dateLabel = (key) => {
    if (key === 'unknown') return t('session.archiveUnknownDate')
    if (key === today) return t('session.archiveToday')
    if (key === yesterday) return t('session.archiveYesterday')
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' })
      .format(new Date(`${key}T12:00:00`))
  }
  const timeLabel = (session) => {
    const time = closedTime(session)
    return time == null ? '' : new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(time)
  }
  const archiveRows = groups.flatMap((group) => group.rows)
  useEffect(() => { searchRef.current?.focus() }, [])
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const current = rowRefs.current.findIndex((element) => element === document.activeElement)
    const next = Math.max(0, Math.min(archiveRows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
    rowRefs.current[next]?.focus()
  }

  return (
    <div className="si-archive-backdrop" data-archive-backdrop onKeyDown={onKeyDown} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="si-archive-page" data-archive-page role="dialog" aria-modal="true" aria-label={t('session.archiveTitle')}>
      <header className="si-archive-head">
        <div>
          <h1>{t('session.archiveTitle')}</h1>
          <span>{t('session.archiveCount', { n: sessions.length })}</span>
        </div>
        <label className="si-archive-search">
          <Icon name="search" size={15} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={t('session.archiveSearch')} aria-label={t('session.archiveSearch')} />
        </label>
      </header>
      <div className="si-archive-index" data-archive-index>
        {!groups.length && <div className="si-archive-empty">{t('session.archiveEmpty')}</div>}
        {groups.map((group) => (
          <section key={group.key} className="si-archive-group" data-archive-day={group.key}>
            <h2 className="si-archive-date">{dateLabel(group.key)}</h2>
            {group.rows.map((session) => (
              <button key={session.id} ref={(element) => { rowRefs.current[archiveRows.indexOf(session)] = element }} type="button" className="si-archive-page-row" data-sid={session.id}
                onClick={() => onOpenSession(session.id)}>
                <span className="si-archive-row-title">{sessionHeadline(session)}</span>
                <span className="si-archive-row-node">{session.node || session.label}</span>
                <time dateTime={session.closedAt || undefined}>{timeLabel(session)}</time>
                <Icon name="chevron-right" size={14} />
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
    </div>
  )
}

// the attach affordance — the shared `paperclip` glyph ([[icon-system]], currentColor stroke, so it
// inherits the .si-attach muted→blue hover), NOT a color emoji. BusyGlyph is the in-flight (uploading)
// state, the spinning `loader` ring.
const AttachGlyph = () => <Icon name="paperclip" size={15} />
const BusyGlyph = () => <Icon name="loader" size={15} className="si-attach-busy" />
const SINGLE_UPLOAD_WORKER = 1
const BYTES_PER_KIBIBYTE = 1024
const KIBIBYTES_PER_MEBIBYTE = 1024
const MEBIBYTES_PER_GIBIBYTE = 1024
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * KIBIBYTES_PER_MEBIBYTE
const BYTES_PER_GIBIBYTE = BYTES_PER_MEBIBYTE * MEBIBYTES_PER_GIBIBYTE
let nextAttachmentKey = 0

const attachmentKey = () => globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${++nextAttachmentKey}`
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

function ActionOutcome({ outcome }) {
  if (!outcome) return null
  const role = outcome.phase === 'failed' ? 'alert' : 'status'
  return <div className={`si-action-outcome ${outcome.phase}`} role={role}>{outcome.message}</div>
}

const fileName = (path) => path.split('/').filter(Boolean).pop() || path
const isMarkdownFile = (path) => /\.(?:md|markdown)$/i.test(path)
function FileTextPreview({ path, text }) {
  return isMarkdownFile(path)
    ? <RichText className="si-file-markdown">{text}</RichText>
    : <pre className="si-file-text">{text}</pre>
}
function FileHtmlPreview({ path, html }) {
  return <iframe className="si-file-html" srcDoc={html} title={fileName(path)} />
}
const webName = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^\[|\]$/g, '')}:${parsed.port}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch { return url }
}
const resourceTabKey = (sessionId, kind, value) => `${sessionId}:${kind}:${value}`
const webProxyUrl = (sessionId, key) => `${PROJECT_BASE}/web/${encodeURIComponent(sessionId)}/${encodeURIComponent(key)}/`

function SessionFiles({ session, onPreview, onDownload, onCopy }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const filesRef = useRef(null)
  const files = Array.isArray(session?.files) ? session.files : []
  const ready = files.length > 0

  useEffect(() => { setOpen(false) }, [session?.id])
  useEffect(() => {
    if (!open) return
    const closeOutside = (event) => { if (!filesRef.current?.contains(event.target)) setOpen(false) }
    window.addEventListener('pointerdown', closeOutside)
    return () => window.removeEventListener('pointerdown', closeOutside)
  }, [open])

  if (!session) return null

  const label = ready ? t('session.filesTitle') : t('session.filesEmptyTitle')
  return (
    <div ref={filesRef} className="si-files">
      <IconButton icon="folder-open" size={14} label={label}
        className={`si-tool sc-${ready ? 'blue' : 'muted'} files`}
        aria-expanded={ready ? open : undefined}
        disabled={!ready}
        onClick={() => setOpen((value) => !value)} />
      {open && (
        <div className="si-files-menu" role="menu" aria-label={t('session.filesListLabel')}>
          {files.map((path) => <div key={path} className="si-files-row" role="none">
            <button type="button" className="si-files-name" role="menuitem" aria-label={t('session.previewFile')}
              onClick={() => { setOpen(false); onPreview(path) }}>{fileName(path)}</button>
            <IconButton icon="download" size={14} className="si-files-download" role="menuitem" label={t('session.downloadFile')}
              onClick={() => onDownload(session.id, path)} />
            <IconButton icon="copy" size={14} className="si-files-copy" role="menuitem" label={path}
              onClick={() => onCopy(path)} />
          </div>)}
        </div>
      )}
    </div>
  )
}

function SessionResourcePanel({ tab, active = false, focusRequest = 0, onEscape }) {
  const t = useT()
  const [preview, setPreview] = useState({ phase: 'loading' })
  const frameRef = useRef(null)
  const activeRef = useRef(active)
  const onEscapeRef = useRef(onEscape)
  activeRef.current = active
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (tab.kind !== 'file') return
    let cancelled = false
    let imageUrl = null
    const url = apiUrl(`/api/sessions/${encodeURIComponent(tab.sessionId)}/files/download?path=${encodeURIComponent(tab.value)}&preview=1`)
    setPreview({ phase: 'loading' })
    fetch(url).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || t('session.filePreviewFailed', { status: response.status }))
      }
      const previewKind = response.headers.get('X-Spexcode-Preview-Kind')
      if (previewKind === 'image') {
        imageUrl = URL.createObjectURL(await response.blob())
        if (!cancelled) setPreview({ phase: 'image', url: imageUrl })
      } else {
        const text = await response.text()
        if (!cancelled) setPreview({ phase: previewKind === 'html' ? 'html' : 'text', text })
      }
    }).catch((error) => {
      if (!cancelled) setPreview({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true; if (imageUrl) URL.revokeObjectURL(imageUrl) }
  }, [tab.kind, tab.sessionId, tab.value, tab.revision, t])

  useEffect(() => {
    if (tab.kind !== 'web') return undefined
    const frame = frameRef.current
    if (!frame) return undefined
    let childWindow = null
    const relayReservedKey = (event) => {
      const dashboardKey = event.key === 'Escape' || (event.altKey && !event.metaKey && !event.ctrlKey)
      if (!dashboardKey) return
      const forwarded = new KeyboardEvent('keydown', {
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true,
      })
      const consumed = !window.dispatchEvent(forwarded)
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!consumed) onEscapeRef.current?.()
      } else if (consumed) event.preventDefault()
    }
    const attach = () => {
      childWindow?.removeEventListener('keydown', relayReservedKey, true)
      childWindow = frame.contentWindow
      childWindow?.addEventListener('keydown', relayReservedKey, true)
    }
    const onLoad = () => {
      attach()
      if (activeRef.current && document.visibilityState !== 'hidden') requestAnimationFrame(() => frame.contentWindow?.focus())
    }
    frame.addEventListener('load', onLoad)
    attach()
    return () => {
      frame.removeEventListener('load', onLoad)
      childWindow?.removeEventListener('keydown', relayReservedKey, true)
    }
  }, [tab.kind, tab.revision])

  useEffect(() => {
    if (tab.kind !== 'web' || !active || document.visibilityState === 'hidden') return undefined
    const frame = requestAnimationFrame(() => frameRef.current?.contentWindow?.focus())
    return () => cancelAnimationFrame(frame)
  }, [tab.kind, tab.revision, active, focusRequest])

  if (tab.kind === 'web') {
    return <iframe ref={frameRef} key={tab.revision} className="si-resource-web" src={webProxyUrl(tab.sessionId, tab.key)} title={tab.label} />
  }
  return (
    <div className={`si-resource-file ${preview.phase}`} data-selectable>
      {preview.phase === 'loading' && <Icon name="loader" size={18} className="si-attach-busy" />}
      {preview.phase === 'error' && <p className="si-file-preview-error" role="alert">{preview.message}</p>}
      {preview.phase === 'text' && <FileTextPreview path={tab.value} text={preview.text} />}
      {preview.phase === 'html' && <FileHtmlPreview path={tab.value} html={preview.text} />}
      {preview.phase === 'image' && <img src={preview.url} alt={fileName(tab.value)} />}
    </div>
  )
}

// The toolbar consumes only the canonical graph session projection. Last-known survives input invalidation,
// tab switches, remounts and transport loss; only a ready projection on a live graph stream is called current.
// `rowPresent` separates the two ways a projection can be absent. A selected row that carries none is a
// retained record the board no longer projects at all — a closed session leaves the graph and is served from
// the archive index plus its id-addressed detail, neither of which carries eval summary — so it is dormant, exactly like the backend's own
// dormant phase. Only a selection with no row yet is still arriving.
export function sessionEvalDisplay(projection, connected = true, rowPresent = false) {
  if (!projection) return { phase: rowPresent ? 'dormant' : 'loading' }
  const stable = projection.phase === 'ready' && projection.value
    ? projection.value
    : projection.lastKnown?.value
  if (!connected) return stable ? { phase: 'disconnected', ...stable } : { phase: 'disconnected' }
  if (projection.phase === 'ready' && projection.value) return { phase: 'ready', ...projection.value }
  // Dormant carries its last-known counts when it has them, and never a spinner: nothing is recomputing them.
  if (projection.phase === 'dormant') return stable ? { phase: 'dormant', ...stable } : { phase: 'dormant' }
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
  if (!hasValue && summary.phase === 'dormant') {
    return <span className="si-eval-wait"><ReviewState kind="eval" state="missing" title={t('session.evalDormant')} size={12} /></span>
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
      {summary.phase === 'dormant' && <ReviewState kind="eval" state="missing" title={t('session.evalDormantLast')} className="si-eval-phase" size={11} />}
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

export default function SessionInterface({ sessions, specs = [], focusNode, open, searchOpen = false, sel, setSel, seed, onSeedConsumed, onClose, onPickSession, onOpenSearch, reload, boardLive = false, archiveRequested = false }) {
  const t = useT()
  const { notify } = useTransientNotice()
  const [prompt, setPrompt] = useState('')    // the New Session tab's own draft (its boarding-switch cache)
  const [codeSelections, setCodeSelections] = useState([])
  const [menu, setMenu] = useState(null)      // completion dropdown: { kind:'mention'|'config'|'slash', items, index, start, end, query }
  const [ctxMenu, setCtxMenu] = useState(null) // selected-session document tools menu
  const [slashCmds, setSlashCmds] = useState([])   // the `/` command list (built-in + user/project/skill), fetched once
  // Command Box drafts are keyed by session id and survive close/reopen, tab switches, and route changes.
  const [drafts, setDrafts] = useState({})
  // named launcher profiles ([[launcher-select]]) — a launcher fuses (harness, cmd), so this is the sole
  // launch choice; the fetch + default resolution live in the shared launch path (./launch.js).
  const { launchers, launcher, pickLauncher } = useLaunchers()
  // The right pane owns in-flight state; its settled result moves to the shared notice surface.
  const [actionOutcome, setActionOutcome] = useState(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0)
  const [resourceFocusRequest, setResourceFocusRequest] = useState(0)
  const [dragTarget, setDragTarget] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [resourceTabs, setResourceTabs] = useState([])
  const [resourceSurface, setResourceSurface] = useState({})
  const [openedConversations, setOpenedConversations] = useState(() => new Set())
  const [surfaceVersion, setSurfaceVersion] = useState(0)
  const [resourceMenu, setResourceMenu] = useState(false)
  const taRef = useRef(null)
  const msgRef = useRef(null)
  const panelRef = useRef(null)
  const fileRef = useRef(null)         // the one hidden <input type=file>; the attach buttons trigger it
  const fileTargetRef = useRef('new')  // which surface the pending pick inserts into ('new' | 'command')
  const resourcePickerRef = useRef(null)
  const knownWebsRef = useRef(null)
  const archiveRequestRef = useRef(null)
  useEffect(() => subscribeSessionSurface(() => setSurfaceVersion((version) => version + 1)), [])
  const outcomeTimerRef = useRef(null)
  const attachmentsRef = useRef([])
  const uploadControllersRef = useRef(new Map())
  const uploadQueueBusyRef = useRef(false)

  useEffect(() => {
    if (!actionOutcome || actionOutcome.phase === 'pending' || actionOutcome.phase === 'sending') return
    notify(actionOutcome.message, { kind: actionOutcome.phase === 'delivered' ? 'success' : 'error' })
    setActionOutcome(null)
  }, [actionOutcome, notify])

  const replaceAttachments = (next) => {
    attachmentsRef.current = next
    setAttachments(next)
  }
  const patchAttachment = (id, patch) => replaceAttachments(attachmentsRef.current.map((item) =>
    item.id === id ? { ...item, ...patch } : item,
  ))
  const uploadingAt = (target) => attachments.some((item) => item.target === target && (item.phase === 'queued' || item.phase === 'uploading'))

  const closeCommandBox = () => {
    if (outcomeTimerRef.current) window.clearTimeout(outcomeTimerRef.current)
    outcomeTimerRef.current = null
    setCommandOpen(false)
    setActionOutcome((outcome) => outcome?.owner === 'command' ? null : outcome)
  }

  const [archiveRows, setArchiveRows] = useState(null)
  const refreshArchive = useCallback(() => {
    if (archiveRequestRef.current) return archiveRequestRef.current
    const request = fetch(apiUrl('/api/sessions/archive-index'))
      .then(async (response) => {
        if (!response.ok) throw new Error(`archive index refused (HTTP ${response.status})`)
        const rows = await response.json()
        const archived = archiveOrder(Array.isArray(rows) ? rows.map((session) => ({ ...session, archived: true })) : [])
        setArchiveRows(archived)
        return archived
      })
      .catch((error) => {
        setActionOutcome({ owner: 'panel', phase: 'failed', message: error instanceof Error ? error.message : String(error) })
        return []
      })
      .finally(() => { archiveRequestRef.current = null })
    archiveRequestRef.current = request
    return request
  }, [])
  useEffect(() => {
    if (open && archiveRows === null) void refreshArchive()
  }, [open, archiveRows, refreshArchive])
  const workingIdsRef = useRef(null)
  useEffect(() => {
    const next = new Set(sessions.map((session) => session.id))
    const previous = workingIdsRef.current
    workingIdsRef.current = next
    if (open && archiveRows !== null && previous && [...previous].some((id) => !next.has(id))) void refreshArchive()
  }, [open, sessions, archiveRows, refreshArchive])
  const allSessions = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]))
    for (const s of archiveRows || []) if (!byId.has(s.id)) byId.set(s.id, s)
    return [...byId.values()]
  }, [sessions, archiveRows])
  const archivedSessions = useMemo(() => archiveOrder(allSessions.filter((session) => session.archived)), [allSessions])
  const validIds = useMemo(() => new Set(['new', ...allSessions.map((s) => s.id)]), [allSessions])
  // content mode: 'new' or a session id. The archive index is a transient overlay.
  const active = validIds.has(sel) ? sel : 'new'
  const sessionActive = active !== 'new'
  // a removed session (closed here, ended on its own, or closed elsewhere) leaves the tab unresolved: land
  // on New only if you're still on the now-gone tab. Mirrors `active`'s validity test. App gates Dashboard on
  // a loaded board, so `sessions` here is the REAL set — an id absent from it is genuinely gone (a dead deep
  // link, or a loaded-empty project), not still loading; resetting it to New is correct, and Dashboard drops
  // the matching dead seed so nothing waits forever.
  useEffect(() => {
    if (open && archiveRows !== null && !validIds.has(sel)) setSel('new')
  }, [open, archiveRows, validIds, sel, setSel])
  const focusId = focusNode?.id || null
  const selSession = allSessions.find((s) => s.id === active)
  const [archiveIndexOpen, setArchiveIndexOpen] = useState(false)
  useEffect(() => { if (archiveRequested) setArchiveIndexOpen(true) }, [archiveRequested])
  const terminalFree = isHeadlessSession(selSession)
  const noLivePane = selSession?.liveness === 'offline'
  const archivedSel = !!selSession?.archived
  const readOnlyPane = noLivePane || archivedSel
  const activeBaseSurface = terminalFree || readOnlyPane ? SESSION_SURFACE_CONVERSATION : getSessionBaseSurface(active)
  const conversationSurface = activeBaseSurface === SESSION_SURFACE_CONVERSATION
  const surfaceTabId = conversationSurface ? 'si-conversation-tab' : 'si-terminal-tab'
  const surfacePanelId = conversationSurface ? 'si-conversation-panel' : 'si-terminal-panel'
  const baseSurfaceForSession = (id) => {
    const session = allSessions.find((candidate) => candidate.id === id)
    return isHeadlessSession(session) ? SESSION_SURFACE_CONVERSATION : getSessionBaseSurface(id)
  }
  const commandAvailable = uiCommandsFor(selSession, {}).some((command) => command.name === 'command')
  const evalSummary = sessionEvalDisplay(sessionActive ? selSession?.evalSummary : null, boardLive, !!selSession)
  // `queued` has intentionally not launched and self-starts as a slot frees, so it has no restore action.
  const footerState = sessionFooterState(selSession)
  const activeResourceId = sessionActive ? resourceSurface[active] || null : null
  const activeResource = resourceTabs.find((tab) => tab.id === activeResourceId) || null
  const resourceOptions = selSession ? [
    ...(selSession.files || []).map((path) => ({
      id: resourceTabKey(active, 'file', path), sessionId: active, kind: 'file', value: path, label: fileName(path), revision: 0,
    })),
    ...(selSession.web || []).map((web) => ({
      id: resourceTabKey(active, 'web', web.key), sessionId: active, kind: 'web', key: web.key, value: web.url, label: webName(web.url), revision: 0,
    })),
  ].filter((option) => !resourceTabs.some((tab) => tab.id === option.id)) : []

  const activateResource = (tab) => {
    setResourceSurface((surfaces) => ({ ...surfaces, [tab.sessionId]: tab.id }))
    setResourceFocusRequest((request) => request + 1)
    closeCommandBox()
  }
  const openResource = (tab, select = true) => {
    setResourceTabs((tabs) => tabs.some((current) => current.id === tab.id) ? tabs : [...tabs, tab])
    if (select) activateResource(tab)
    setResourceMenu(false)
  }
  const closeResource = (tab) => {
    setResourceTabs((tabs) => tabs.filter((current) => current.id !== tab.id))
    setResourceSurface((surfaces) => surfaces[tab.sessionId] === tab.id ? { ...surfaces, [tab.sessionId]: null } : surfaces)
  }
  const refreshResource = (tab) => setResourceTabs((tabs) => tabs.map((current) =>
    current.id === tab.id ? { ...current, revision: current.revision + 1 } : current,
  ))
  const fileActionFailure = (error) => setActionOutcome({ owner: 'panel', phase: 'failed', message: error instanceof Error ? error.message : String(error) })
  const downloadFile = async (sessionId, path) => {
    const url = apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/files/download?path=${encodeURIComponent(path)}`)
    try {
      const response = await fetch(url, { method: 'HEAD' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || t('session.fileDownloadFailed', { status: response.status }))
      }
      const link = document.createElement('a')
      link.href = url
      link.download = fileName(path)
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (error) {
      fileActionFailure(error)
    }
  }
  const copyFilePath = async (path) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t('session.fileCopyUnavailable'))
      await navigator.clipboard.writeText(path)
    } catch (error) {
      fileActionFailure(error)
    }
  }

  useEffect(() => {
    const published = new Map()
    for (const session of sessions) for (const web of session.web || []) {
      const tab = { id: resourceTabKey(session.id, 'web', web.key), sessionId: session.id, kind: 'web', key: web.key, value: web.url, label: webName(web.url), revision: 0 }
      published.set(tab.id, tab)
    }
    const previous = knownWebsRef.current
    knownWebsRef.current = published
    if (!previous) return
    const added = [...published].filter(([id]) => !previous.has(id)).map(([, tab]) => tab)
    if (!added.length) return
    const admitted = added.filter((tab) => !resourceTabs.some((current) => current.id === tab.id))
    setResourceTabs((tabs) => [...tabs, ...admitted.filter((tab) => !tabs.some((current) => current.id === tab.id))])
    const selected = admitted.find((tab) => tab.sessionId === active)
    if (selected) activateResource(selected)
  }, [sessions, active, resourceTabs])

  useEffect(() => {
    const published = new Set()
    for (const session of sessions) {
      for (const path of session.files || []) published.add(resourceTabKey(session.id, 'file', path))
      for (const web of session.web || []) published.add(resourceTabKey(session.id, 'web', web.key))
    }
    setResourceTabs((tabs) => tabs.filter((tab) => published.has(tab.id)))
    setResourceSurface((surfaces) => Object.fromEntries(Object.entries(surfaces).filter(([, id]) => !id || published.has(id))))
  }, [sessions])

  useEscLayer(resourceMenu, () => setResourceMenu(false))
  useEffect(() => {
    if (!resourceMenu) return
    const closeOutside = (event) => { if (!resourcePickerRef.current?.contains(event.target)) setResourceMenu(false) }
    window.addEventListener('pointerdown', closeOutside)
    return () => window.removeEventListener('pointerdown', closeOutside)
  }, [resourceMenu])
  // the active session's Command Box draft (per-session, see `drafts`).
  const msg = drafts[active] || ''
  const setMsg = (value) => setDrafts((draft) => ({
    ...draft,
    [active]: typeof value === 'function' ? value(draft[active] || '') : value,
  }))
  const selectSession = (id) => {
    if (id === 'new') return
    closeCommandBox()
    setMenu(null)
    setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    setSel(id)
  }
  // A resource is temporary; this restores the resolved base surface. Only the explicit switch records a
  // per-session preference, while selecting the current base merely returns from the overlay.
  const showBaseSurface = (id, surface, remember = false) => {
    if (id === 'new') return
    selectSession(id)
    setResourceSurface((surfaces) => ({ ...surfaces, [id]: null }))
    if (surface === SESSION_SURFACE_CONVERSATION) {
      setOpenedConversations((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    } else {
      setTerminalFocusRequest((request) => request + 1)
    }
    if (remember) setSessionBaseSurface(id, surface)
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

  // Command Box is transient, but its draft is not. Selection changes own the whole selected outcome; an
  // unavailable command closes only the Command Box-owned one. The sidebar never participates.
  useEffect(() => {
    if (outcomeTimerRef.current) window.clearTimeout(outcomeTimerRef.current)
    outcomeTimerRef.current = null
    setCommandOpen(false)
    setActionOutcome(null)
    setMenu(null)
  }, [active])
  useEffect(() => { if (!commandAvailable) closeCommandBox() }, [commandAvailable])
  useEffect(() => () => { if (outcomeTimerRef.current) window.clearTimeout(outcomeTimerRef.current) }, [])

  // Keep every live pane-backed terminal mounted for its warm-pane contract. Headless conversations have no
  // pane to keep warm: mount the selected one on demand, then retain it (including after it goes offline) so
  // revisiting a session keeps its timeline cursor and rendered history. Unvisited headless rows stay inert;
  // mounting one TimelineChat per retained session would issue two reads plus an interval per row.
  const [opened, setOpened] = useState(() => new Set())
  useEffect(() => {
    setOpened((prev) => {
      const valid = new Set(allSessions.map((s) => s.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      for (const s of allSessions) if (!isHeadlessSession(s) && s.liveness !== 'offline') next.add(s.id)
      if (active !== 'new') {
        const selected = sessions.find((s) => s.id === active)
        if (selected && isHeadlessSession(selected)) next.add(active)
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })
  }, [allSessions, active])

  useEffect(() => {
    setOpenedConversations((prev) => {
      const valid = new Set(allSessions.map((s) => s.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      const selected = active === 'new' ? null : allSessions.find((s) => s.id === active)
      if (selected && (selected.archived || selected.liveness === 'offline' || isHeadlessSession(selected)
        || getSessionBaseSurface(selected.id) === SESSION_SURFACE_CONVERSATION)) next.add(selected.id)
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })
  }, [allSessions, active, surfaceVersion])

  // a board chord (nn/dd) seeds this surface with an @-directive. Apply ONCE to the New draft, then clear it
  // upstream so a later reopen restores the user's own draft. Clobbering the draft is intended here.
  useEffect(() => {
    if (seed == null) return
    setSel('new')
    const decoded = decodePrompt(seed)
    setPrompt(decoded.text)
    setCodeSelections(decoded.selections)
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
    const raw = encodePrompt(prompt, codeSelections)
    if (!raw) return
    setPrompt('')
    setCodeSelections([])
    createSession(raw, launcher).then(() => reload?.())
  }

  // build the completion dropdown for the active surface: `[[`-mention (spec nodes) and `@` session references
  // — the shared scanners from ./mentions.jsx — work on BOTH; the New prompt adds the config-preset (`/`)
  // palette, a session's Command Box adds the slash menu.
  const buildMenu = (value, caret) => {
    const mm = nodeMentionAt(value, caret, specs, focusId)
    if (mm) return mm
    const am = sessionMentionAt(value, caret, allSessions, launchers)
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
      if (item.ui) { const c = typedUiCmds.find((x) => x.name === item.name); setMsg(''); setMenu(null); c?.run('command'); return }
      const insert = `/${item.name} `
      const before = msg.slice(0, menu.start)
      setMsg(before + insert + msg.slice(menu.end))
      setMenu(null)
      const caret = before.length + insert.length
      requestAnimationFrame(() => { const el = msgRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
      return
    }
    // command preset → the New prompt (composed at launch); a `[[`/`@` reference → whichever box is active.
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
    const onMsg = (menu.kind === 'mention' || menu.kind === 'session' || menu.kind === 'launcher') && active !== 'new'
    const ref = onMsg ? msgRef : taRef
    const cur = onMsg ? msg : prompt
    const setCur = onMsg ? setMsg : setPrompt
    const before = cur.slice(0, menu.start)
    if (menu.kind === 'session' && item.id === 'new') {
      const next = before + '@new:' + cur.slice(menu.end)
      const caret = before.length + '@new:'.length
      setCur(next)
      setMenu(sessionMentionAt(next, caret, allSessions, launchers))
      requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
      return
    }
    const insert = menu.kind === 'session' ? `@${item.id} `
      : menu.kind === 'launcher' ? `@new:${item.id} `
        : `[[${item.id}]] `
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

  // the node-mention/`@`-session dropdown, on either surface — downward under the centered New box, or `up`
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
    if (cmd) { setMsg(''); setMenu(null); cmd.run('command'); return }
    // resolve any `[[<node>]]` to a live spec.md pointer before it reaches the backend (the running-session twin
    // of the New Session launch composition — see [[command-box]]).
    const text = expandMentions(raw)
    if (actionOutcome?.owner === 'command' && actionOutcome.phase === 'sending') return
    setActionOutcome({ owner: 'command', phase: 'sending', message: t('session.outcomeSending') })
    try {
      const res = await fetch(apiUrl(`/api/sessions/${active}/input`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'command', text }),
      })
      const outcome = await res.json().catch(() => null)
      if (!res.ok) {
        setActionOutcome({
          owner: 'command',
          phase: 'failed',
          message: outcome?.error || t('session.deliveryFailed', { status: res.status }),
        })
        return
      }
      setMsg((current) => current === raw ? '' : current)
      setActionOutcome({ owner: 'command', phase: 'delivered', message: outcome?.mentionSummary || t('session.outcomeDelivered') })
      outcomeTimerRef.current = window.setTimeout(() => closeCommandBox(), 650)
    } catch (error) {
      setActionOutcome({
        owner: 'command',
        phase: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const responseError = async (res) => {
    const body = await res.json().catch(() => null)
    return body?.error || `upload failed (HTTP ${res.status})`
  }
  const validUploadTransfer = (transfer, size) => transfer?.size === size &&
    Number.isSafeInteger(transfer.chunkBytes) && transfer.chunkBytes > 0 &&
    Number.isSafeInteger(transfer.concurrency) && transfer.concurrency > 0 &&
    Number.isSafeInteger(transfer.requestTimeoutMs) && transfer.requestTimeoutMs > 0 &&
    Number.isSafeInteger(transfer.retryLimit) && transfer.retryLimit >= 0 &&
    Number.isSafeInteger(transfer.retryDelayMs) && transfer.retryDelayMs >= 0 &&
    Number.isSafeInteger(transfer.offset) && transfer.offset >= 0 && transfer.offset <= size
  const waitForUploadRetry = (delayMs, controller) => new Promise((resolve, reject) => {
    if (controller.signal.aborted) { reject(new Error('upload cancelled')); return }
    const timer = window.setTimeout(() => {
      controller.signal.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    const abort = () => {
      window.clearTimeout(timer)
      reject(new Error('upload cancelled'))
    }
    controller.signal.addEventListener('abort', abort, { once: true })
  })
  const uploadFetch = async (url, init, controller, timeoutMs) => {
    const request = new AbortController()
    const abort = () => request.abort()
    controller.signal.addEventListener('abort', abort, { once: true })
    const timer = window.setTimeout(() => request.abort(), timeoutMs)
    try {
      return await fetch(url, { ...init, signal: request.signal })
    } catch (error) {
      if (!controller.signal.aborted && request.signal.aborted) throw new Error('upload request timed out')
      throw error
    } finally {
      window.clearTimeout(timer)
      controller.signal.removeEventListener('abort', abort)
    }
  }
  const retryTransientUpload = async (run, transfer, controller) => {
    let retries = 0
    for (;;) {
      try {
        return await run()
      } catch (error) {
        if (controller.signal.aborted || retries >= transfer.retryLimit) throw error
        retries += 1
        await waitForUploadRetry(transfer.retryDelayMs, controller)
      }
    }
  }
  // splice `text` at the caret of a textarea (ref+value+setter), padding with spaces so it never glues to
  // neighbouring words, then drop the caret after it. The auto-grow effects re-run on the new value.
  const insertAtCaret = (ref, value, setValue, text) => {
    const el = ref.current
    value = el?.value ?? value
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
  const transferAttachment = async (id, onPolicy = null) => {
    const item = attachmentsRef.current.find((candidate) => candidate.id === id)
    if (!item || item.phase === 'cancelled') return null
    patchAttachment(id, { phase: 'uploading', error: null })
    const controller = new AbortController()
    uploadControllersRef.current.set(id, controller)
    try {
      let transferId = item.transferId
      let transfer = null
      if (transferId) {
        const resumed = await fetch(apiUrl(`/api/uploads/${transferId}`), { signal: controller.signal })
        if (resumed.ok) transfer = await resumed.json()
        else if (resumed.status !== 404) throw new Error(await responseError(resumed))
      }
      if (!transfer) {
        const created = await fetch(apiUrl('/api/uploads'), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: item.file.name || 'pasted', size: item.file.size }), signal: controller.signal,
        })
        if (!created.ok) throw new Error(await responseError(created))
        transfer = await created.json()
        transferId = transfer?.id
        if (!transferId) throw new Error('upload did not return a transfer id')
        patchAttachment(id, { transferId })
      }
      if (!validUploadTransfer(transfer, item.file.size)) {
        throw new Error('upload transfer metadata is invalid')
      }
      onPolicy?.(transfer.concurrency)
      let offset = transfer.offset
      patchAttachment(id, { offset })
      while (offset < item.file.size) {
        const bytes = item.file.slice(offset, Math.min(item.file.size, offset + transfer.chunkBytes))
        const sent = await retryTransientUpload(async () => {
          const response = await uploadFetch(apiUrl(`/api/uploads/${transferId}`), {
            method: 'PATCH', headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset) }, body: bytes,
          }, controller, transfer.requestTimeoutMs)
          if (response.status >= 500) throw new Error(await responseError(response))
          return response
        }, transfer, controller)
        const next = await sent.json().catch(() => null)
        if (sent.status === 409 && Number.isSafeInteger(next?.offset) && next.offset >= 0 && next.offset <= item.file.size) {
          offset = next.offset
          patchAttachment(id, { offset })
          continue
        }
        if (!sent.ok) throw new Error(next?.error || `upload failed (HTTP ${sent.status})`)
        if (!Number.isSafeInteger(next?.offset) || next.offset <= offset || next.offset > item.file.size) {
          throw new Error('upload did not advance its committed offset')
        }
        offset = next.offset
        patchAttachment(id, { offset })
      }
      const completed = await uploadFetch(apiUrl(`/api/uploads/${transferId}/complete`), { method: 'POST' }, controller, transfer.requestTimeoutMs)
      if (!completed.ok) throw new Error(await responseError(completed))
      const result = await completed.json().catch(() => null)
      if (!result?.path) throw new Error('upload did not return a path')
      const latest = attachmentsRef.current.find((candidate) => candidate.id === id)
      if (latest?.phase === 'cancelled') return
      if (item.target === 'new') insertAtCaret(taRef, prompt, setPrompt, result.path)
      else insertAtCaret(msgRef, msg, setMsg, result.path)
      patchAttachment(id, { phase: 'complete', offset: item.file.size, path: result.path })
      return transfer.concurrency
    } catch (error) {
      onPolicy?.(null)
      if (controller.signal.aborted) patchAttachment(id, { phase: 'cancelled', offset: 0, transferId: null, error: null })
      else patchAttachment(id, { phase: 'failed', error: error instanceof Error ? error.message : String(error) })
    } finally {
      uploadControllersRef.current.delete(id)
    }
    return null
  }
  const runQueuedAttachments = async (ids) => {
    if (uploadQueueBusyRef.current) return
    uploadQueueBusyRef.current = true
    try {
      const [first, ...rest] = ids
      let resolvePolicy
      const firstPolicy = new Promise((resolve) => { resolvePolicy = resolve })
      const firstTransfer = first ? transferAttachment(first, resolvePolicy) : Promise.resolve(SINGLE_UPLOAD_WORKER)
      const concurrency = first ? await firstPolicy : SINGLE_UPLOAD_WORKER
      const workerCount = Math.min(Math.max(0, (concurrency || SINGLE_UPLOAD_WORKER) - SINGLE_UPLOAD_WORKER), rest.length)
      if (workerCount === 0) {
        await firstTransfer
        for (const id of rest) await transferAttachment(id)
        return
      }
      let next = 0
      const workers = Array.from({ length: workerCount }, async () => {
        while (next < rest.length) {
          const id = rest[next]
          next += 1
          await transferAttachment(id)
        }
      })
      await Promise.all([firstTransfer, ...workers])
    } finally {
      uploadQueueBusyRef.current = false
    }
  }
  const retryAttachment = (id) => {
    if (!uploadQueueBusyRef.current) void runQueuedAttachments([id])
  }
  const cancelAttachment = async (id) => {
    const item = attachmentsRef.current.find((candidate) => candidate.id === id)
    if (!item) return
    uploadControllersRef.current.get(id)?.abort()
    if (item.transferId) await fetch(apiUrl(`/api/uploads/${item.transferId}`), { method: 'DELETE' }).catch(() => {})
    patchAttachment(id, { phase: 'cancelled', offset: 0, transferId: null, error: null })
  }
  const dismissAttachment = (id) => {
    const item = attachmentsRef.current.find((candidate) => candidate.id === id)
    if (!item) return
    if (item.phase !== 'complete' && item.phase !== 'cancelled') void cancelAttachment(id)
    replaceAttachments(attachmentsRef.current.filter((candidate) => candidate.id !== id))
  }
  // The policy's default is one writer; a project may raise it, while every row retains independent resume,
  // retry, and cancellation state.
  const attachFiles = async (fileList, target) => {
    const files = [...(fileList || [])]
    if (!files.length || uploadQueueBusyRef.current) return
    const added = files.map((file) => ({ id: attachmentKey(), target, file, phase: 'queued', offset: 0, transferId: null, error: null }))
    replaceAttachments([...attachmentsRef.current, ...added])
    await runQueuedAttachments(added.map((item) => item.id))
  }
  const formatUploadBytes = (bytes) => {
    if (bytes < BYTES_PER_KIBIBYTE) return `${bytes} B`
    if (bytes < BYTES_PER_MEBIBYTE) return `${Math.round(bytes / BYTES_PER_KIBIBYTE)} KB`
    if (bytes < BYTES_PER_GIBIBYTE) return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`
    return `${(bytes / BYTES_PER_GIBIBYTE).toFixed(2)} GB`
  }
  const attachmentQueue = (target) => {
    const rows = attachments.filter((item) => item.target === target)
    if (!rows.length) return null
    return (
      <div className={`si-attach-queue ${target === 'command' ? 'command' : 'new'}`} aria-live="polite">
        {rows.map((item) => {
          const active = item.phase === 'queued' || item.phase === 'uploading'
          const status = item.phase === 'queued' ? t('session.attachQueued')
            : item.phase === 'uploading' ? `${formatUploadBytes(item.offset)} / ${formatUploadBytes(item.file.size)}`
              : item.phase === 'complete' ? t('session.attachDone') : item.phase === 'cancelled' ? t('session.attachCancelled') : item.error
          return (
            <div key={item.id} className={`si-attach-row ${item.phase}`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && event.animationName === 'si-attach-complete-out') dismissAttachment(item.id)
              }}>
              <span className="si-attach-name" title={item.file.name}><Icon name="paperclip" size={12} />{item.file.name}</span>
              <progress className="si-attach-progress" value={item.offset} max={item.file.size} aria-label={`${item.file.name}: ${status}`} />
              <span className="si-attach-status" role={item.phase === 'failed' ? 'alert' : 'status'}>{status}</span>
              {item.phase === 'failed' && <IconButton icon="rotate-ccw" size={13} className="si-attach-action" label={t('session.attachRetry')}
                disabled={uploadQueueBusyRef.current} onClick={() => retryAttachment(item.id)} />}
              {(active || item.phase === 'failed') && <IconButton icon="x" size={13} className="si-attach-action" label={t('session.attachCancel')}
                onClick={() => { void cancelAttachment(item.id) }} />}
              {(item.phase === 'complete' || item.phase === 'cancelled') && <IconButton icon="x" size={13} className="si-attach-action" label={t('session.attachDismiss')}
                onClick={() => dismissAttachment(item.id)} />}
            </div>
          )
        })}
      </div>
    )
  }
  const codeSelectionQueue = () => {
    if (!codeSelections.length) return null
    return (
      <div className="si-code-selection-queue" aria-label={t('session.codeSelectionAttachments')}>
        {codeSelections.map((selection, index) => (
          <div key={`${selection.path}:${selection.startLine}:${selection.endLine}:${index}`} className="si-code-selection-chip">
            <Icon name="terminal" size={12} />
            <span className="si-code-selection-label" title={selection.text}>{selectionLabel(selection)}</span>
            <IconButton icon="x" size={12} className="si-code-selection-remove" label={t('session.removeCodeSelection')}
              onClick={() => setCodeSelections((current) => current.filter((_item, itemIndex) => itemIndex !== index))} />
          </div>
        ))}
      </div>
    )
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

  // Lifecycle actions consume both status and structured bodies before reload. Their outcome belongs to the
  // selected action panel, never to the navigation list, so one refusal cannot masquerade as two operations.
  const act = async (verb, body, owner = 'panel', headers = {}) => {
    setActionOutcome({ owner, phase: 'pending', message: t('session.outcomeWorking') })
    let ok = true
    try {
      const res = await fetch(apiUrl(`/api/sessions/${active}/${verb}`), body
        ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }
        : { method: 'POST', headers })
      const j = await res.json().catch(() => null)
      if (!res.ok || j?.ok === false) {
        ok = false
        setActionOutcome({ owner, phase: 'failed', message: j?.error || `session ${verb} refused (HTTP ${res.status})` })
      }
    } catch (error) {
      ok = false
      setActionOutcome({ owner, phase: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
    if (ok) setActionOutcome(null)
    await reload?.()
    if (ok && owner === 'command') closeCommandBox()
    return ok
  }

  const mergeSession = (owner) => act('merge', undefined, owner)

  const resumeAndReturnToWorking = async () => {
    const ok = await act('resume')
    if (ok) {
      await refreshArchive()
    }
    return ok
  }

  // `runners` binds each board-command name to the closure that DOES it — the SAME closure the toolbar
  // tool and Command Box row call; `uiCmds` narrows the registry to current session state.
  const runners = {
    command: () => { if (commandOpen) closeCommandBox(); else setCommandOpen(true) },
    // the Eval DOOR ([[session-eval]]): the session's evaluation lives on the Evals route family now —
    // the typed /eval navigates to the session-scoped list through the ONE [[address-routing]] projection
    // (a real page switch, one push), never a console-local pane. The tab-bar door below is the same
    // address as a REAL anchor.
    eval: () => { if (sessionActive) navigateAddress(sessionEvalAddress(active)) },
    merge: mergeSession,
    relaunch: resumeAndReturnToWorking,
    stop: (owner) => act('stop', undefined, owner),     // soft stop: kill tmux + socket, KEEP the worktree → read-only Conversation
    close: (owner) => act('close', undefined, owner),
  }
  const uiCmds = uiCommandsFor(selSession, runners)
  const typedUiCmds = uiCmds.filter((command) => command.typed !== false && command.enabled)
  const evalKnownTitle = Number.isInteger(evalSummary.total) ? t('session.evalDoorSummary', evalSummary) : ''
  const evalDoorTitle = evalSummary.phase === 'ready'
    ? evalKnownTitle
    : evalSummary.phase === 'updating'
      ? t('session.evalUpdating', { summary: evalKnownTitle })
      : evalSummary.phase === 'disconnected'
        ? t('session.evalDisconnected', { summary: evalKnownTitle })
        : evalSummary.phase === 'dormant'
          ? (evalKnownTitle ? t('session.evalDormantKnown', { summary: evalKnownTitle }) : t('session.evalDormant'))
          : evalSummary.phase === 'loading'
            ? t('session.evalLoading')
            : evalKnownTitle
              ? t('session.evalFailedKnown', { summary: evalKnownTitle })
              : t('session.evalUnavailable')
  // Window-level router owns only app shortcuts, Command Box/menu keys, and list navigation. Ordinary
  // terminal keys fall through to xterm.
  const stateRef = useRef({})
  stateRef.current = {
    active, submit, menu, navMenu, accept, setMenu, open, searchOpen, commandOpen,
    commandAvailable, setCommandOpen, closeCommandBox,
  }
  useEffect(() => {
    const onKey = (e) => {
      const {
        active, submit, menu, navMenu, accept, setMenu, open, searchOpen, commandOpen,
        commandAvailable, setCommandOpen, closeCommandBox,
      } = stateRef.current
      if (!open || searchOpen) return   // panel hidden, OR the search palette modal is open above us and owns the keys: nothing here listens
      if (e.target?.closest?.('[data-focus-overlay]')) return // a transient modal owns its focused control's native keys
      // Native buttons own Enter/Space activation even while the New Session tab is selected. Keep the
      // console router from cancelling a fold header's default click; text inputs still reach the menu/send paths below.
      if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('button, a[href]')) return
      // Reserved Alt+I toggles Command Box before xterm. Matched by
      // e.code (the physical I key) because ⌥I on a mac prints a dead-key glyph, not 'i'. The chord is a
      // SINGLE Alt modifier + I. Command/Ctrl variants remain native/browser shortcuts.
      const isI = e.code === 'KeyI' || e.key === 'i' || e.key === 'I'
      if (e.altKey && !e.metaKey && !e.ctrlKey && isI && active !== 'new') {
        e.preventDefault(); e.stopPropagation()
        if (commandAvailable) { if (commandOpen) closeCommandBox(); else setCommandOpen(true) }
        return
      }
      // the app's GLOBAL ⌥ command family — ⌥N (New Session composer), ⌥F (evals), ⌥1..⌥5 (pages) — is
      // reserved over the console too: fall through
      // UNHANDLED so the App-level window listener (registered after this child's, so next in the capture
      // chain) routes it — never forwarded to tmux. Matched by e.code for the same mac ⌥-dead-key reason as
      // ⌥I. ⌘/⌃ variants stay with the browser (⌘N/⌃N are its hard-reserved new-window accelerator anyway).
      if (e.altKey && !e.metaKey && !e.ctrlKey && ['KeyN', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) return
      // a completion menu owns navigation/commit/dismiss while it's open — on the New Session prompt
      // OR Command Box. Capture claims Enter before the textarea, so accepting never also sends.
      if (menu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navMenu(1); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); navMenu(-1); return }
        if ((e.key === 'Enter' || e.key === 'Tab') && !composingKey(e)) { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return }
        if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
      }
      if (commandOpen && e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); closeCommandBox(); return
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
        <section className={`si-content${active === 'new' ? ' is-new' : ' is-session'}`}>
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
                  disabled={uploadingAt('new')}
                >{uploadingAt('new') ? <BusyGlyph /> : <AttachGlyph />}</button>
                {menu && (menu.kind === 'mention' || menu.kind === 'session' || menu.kind === 'launcher') && mentionMenuEl(false)}
                {/* config-preset palette — same `/` dropdown, opening downward under the centered box. */}
                {menu && menu.kind === 'config' && slashMenu(false, menu.query ? `/${menu.query}` : t('session.menuPresets'))}
              </div>
              {codeSelectionQueue()}
              {attachmentQueue('new')}
              {/* launcher picker — the only launch choice ([[launcher-select]]): the pop-out button picker
                  (LauncherPicker above) with per-launcher harness marks and read-only cmd details. */}
              {launchers.length ? <LauncherPicker launchers={launchers} launcher={launcher} pickLauncher={pickLauncher} /> : null}
              <div className="si-hint">
                {t('session.hint.before')}<code>[[</code>{t('session.hint.mid')}<code>/</code>{t('session.hint.after')}
              </div>
            </div>
          )}
          {/* the session pane stays LAID OUT under the New tab so warm terminals keep their final geometry;
              visibility hides it without a 0x0 renderer. The compact toolbar carries terminal/resource/Eval tabs
              and registry-filtered icon tools. Identity/state already lives in the
              selected sidebar row and is deliberately not repeated here. */}
          <div
            className="si-session-wrap"
            aria-hidden={!sessionActive}
            style={{
              display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0,
              position: sessionActive ? 'relative' : 'absolute',
              inset: sessionActive ? undefined : 0,
              visibility: sessionActive ? 'visible' : 'hidden',
              pointerEvents: sessionActive ? 'auto' : 'none',
            }}
          >
              <header className="si-tabbar" aria-label={t(conversationSurface ? 'session.conversationToolbarLabel' : 'session.toolbarLabel')}>
                <div className="si-surface">
                  <div className="si-tabs" role="tablist" aria-label={t('session.surfaceLabel')}>
                    <div className="si-base-tabs">
                      <button
                        type="button"
                        id={surfaceTabId}
                        role="tab"
                        aria-selected={!activeResource}
                        aria-controls={`${surfacePanelId}-${active}`}
                        className={`si-tab${activeResource ? '' : ' on'}`}
                        onClick={() => showBaseSurface(active, activeBaseSurface)}
                      >
                        <Icon name={conversationSurface ? 'message-square' : 'terminal'} size={13} />
                        <span className="si-tab-label">{t(conversationSurface ? 'session.tabConversation' : 'session.tabTerminal')}</span>
                      </button>
                    </div>
                    <a
                      className="si-eval-tab sc-cyan"
                      href={sessionActive ? addressHash(sessionEvalAddress(active)) : null}
                      data-tip={evalDoorTitle}
                      aria-label={evalDoorTitle}
                    >
                      <Icon name="evals" size={14} />
                      <span className="si-eval-label">{t('session.tabEval')}</span>
                      <SessionEvalStats summary={evalSummary} />
                    </a>
                    <div className="si-resource-tabs">
                      {resourceTabs.filter((tab) => tab.sessionId === active).map((tab) => (
                        <div key={tab.id} className={`si-resource-tab${activeResource?.id === tab.id ? ' on' : ''}`}>
                          <button type="button" id={`si-resource-tab-${tab.id}`} role="tab" aria-selected={activeResource?.id === tab.id}
                            aria-controls={`si-resource-panel-${tab.id}`} className="si-resource-tab-main"
                            onClick={() => activateResource(tab)}>
                            <Icon name={tab.kind === 'file' ? 'folder-open' : 'globe'} size={13} />
                            <span>{tab.label}</span>
                          </button>
                          <IconButton icon="x" size={12} className="si-resource-tab-action" label={t('session.closeResourceTab', { name: tab.label })}
                            onClick={() => closeResource(tab)} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div ref={resourcePickerRef} className="si-resource-picker">
                    <IconButton icon="plus" size={11} className="si-tab-add" label={t('session.addResourceTab')}
                      aria-expanded={resourceMenu} disabled={!sessionActive} onClick={() => setResourceMenu((open) => !open)} />
                    {resourceMenu && (
                      <div className="si-resource-menu" role="menu" aria-label={t('session.resourceMenuLabel')}>
                        {resourceOptions.length ? resourceOptions.map((tab) => (
                          <button key={tab.id} type="button" className="si-resource-menu-row" role="menuitem"
                            onClick={() => openResource(tab)}>
                            <Icon name={tab.kind === 'file' ? 'folder-open' : 'globe'} size={13} />
                            <span>{tab.label}</span>
                          </button>
                        )) : <span className="si-resource-menu-empty">{t('session.resourceMenuEmpty')}</span>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="si-actions" role="group" aria-label={t('session.toolbarToolsLabel')}>
                  {sessionActive && <IconButton icon="ellipsis" size={14} className="si-tool sc-muted" label={t('session.menuLabel')}
                    onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setCtxMenu({ x: box.left, y: box.bottom, session: selSession }) }} />}
                  {activeResource && (
                    <>
                      <IconButton icon="rotate-ccw" size={14} className="si-tool sc-blue refresh-resource" data-resource-action="refresh"
                        label={t('session.refreshResourceTab', { name: activeResource.label })}
                        onClick={() => refreshResource(activeResource)} />
                    </>
                  )}
                  {activeResource?.kind === 'file' && (
                    <>
                      <IconButton icon="download" size={14} className="si-tool sc-blue file-download" data-resource-action="download"
                        label={t('session.downloadFile')}
                        onClick={() => { void downloadFile(activeResource.sessionId, activeResource.value) }} />
                      <IconButton icon="copy" size={14} className="si-tool sc-blue file-copy" data-resource-action="copy"
                        label={activeResource.value}
                        onClick={() => { void copyFilePath(activeResource.value) }} />
                    </>
                  )}
                  {uiCmds.filter((c) => c.button && (!activeResource && (activeBaseSurface === 'terminal' || c.name !== 'merge')))
                    // Resident right-anchored tools (Command Box) sort to the row's right edge; transient action
                    // buttons keep their registry order to its left. Stable sort preserves that left order.
                    .sort((a, b) => (a.anchor === 'right' ? 1 : 0) - (b.anchor === 'right' ? 1 : 0))
                    .map((c) => {
                    const pressed = c.pressed ? commandOpen : undefined
                    const state = pressed ? ' on' : ''
                    const label = t(c.enabled ? c.titleKey : c.disabledTitleKey)
                    return (
                      <IconButton
                        key={c.name}
                        icon={c.icon}
                        size={14}
                        label={label}
                        className={`si-tool sc-${c.enabled ? c.color : 'muted'} ${c.name}${state}`}
                        data-command={c.name}
                        aria-pressed={pressed}
                        disabled={!c.enabled}
                        onClick={() => { if (c.enabled) c.run() }}
                      />
                    )
                  })}
                  <SessionFiles
                    session={selSession}
                    onDownload={downloadFile}
                    onCopy={copyFilePath}
                    onPreview={(path) => openResource({
                      id: resourceTabKey(active, 'file', path), sessionId: active, kind: 'file', value: path, label: fileName(path), revision: 0,
                    })}
                  />
                  {!terminalFree && (
                    <IconButton
                      icon={conversationSurface ? 'terminal' : 'message-square'}
                      size={14}
                      className="si-tool sc-blue surface-switch"
                      data-surface-switch={conversationSurface ? 'terminal' : 'conversation'}
                      label={t(conversationSurface ? 'session.switchToTerminal' : 'session.switchToConversation')}
                      aria-pressed={conversationSurface}
                      disabled={readOnlyPane}
                      onClick={() => showBaseSurface(active, conversationSurface ? 'terminal' : SESSION_SURFACE_CONVERSATION, true)}
                    />
                  )}
                </div>
              </header>
              {/* The live terminal stays mounted when the Eval tab routes the app away (warm-terminals
                  contract); the routed session page is display-hidden, so socket + scroll survive. */}
              <div
                className={`si-term-body${conversationSurface ? ' is-conversation' : ''}${activeResource ? ' is-resource' : ''}`}
                id={activeResource ? `si-resource-panel-${activeResource.id}` : `${surfacePanelId}-${active}`}
                role="tabpanel"
                aria-labelledby={activeResource ? `si-resource-tab-${activeResource.id}` : surfaceTabId}
                style={{ position: 'relative' }}
              >
                {/* Live terminals stay warm; every lifecycle state uses the same Conversation DOM. */}
                {[...new Set([...opened, ...openedConversations])].map((id) => {
                  const session = allSessions.find((candidate) => candidate.id === id)
                  if (!session) return null
                  const headless = isHeadlessSession(session)
                  const baseShown = id === active && !activeResource
                  const terminalShown = baseShown && activeBaseSurface === 'terminal'
                  const conversationShown = baseShown && (headless || activeBaseSurface === SESSION_SURFACE_CONVERSATION)
                  return (
                    <div key={id}>
                      {!headless && opened.has(id) && (
                        <div className="si-term-layer" style={{
                          position: 'absolute', inset: 0,
                          visibility: terminalShown ? 'visible' : 'hidden',
                          pointerEvents: terminalShown ? 'auto' : 'none',
                        }}>
                          <SessionTerm sessionId={id} active={open && terminalShown}
                            focused={open && terminalShown && !commandOpen}
                            focusRequest={id === active ? terminalFocusRequest : 0} />
                        </div>
                      )}
                      {(headless || openedConversations.has(id)) && (
                        <div className="si-term-layer" style={{
                          position: 'absolute', inset: 0,
                          visibility: conversationShown ? 'visible' : 'hidden',
                          pointerEvents: conversationShown ? 'auto' : 'none',
                        }}>
                          <TimelineChat s={session} sessions={allSessions} active={open && conversationShown}
                            footerState={sessionFooterState(session)}
                            onRestore={id === active ? resumeAndReturnToWorking : undefined}
                            actionOutcome={id === active && actionOutcome?.owner === 'panel' ? actionOutcome : null} />
                        </div>
                      )}
                    </div>
                  )
                })}
                {resourceTabs.map((tab) => {
                  const shown = activeResource?.id === tab.id
                  return (
                    <div key={tab.id} className="si-resource-layer" style={{
                      position: 'absolute', inset: 0,
                      visibility: shown ? 'visible' : 'hidden',
                      pointerEvents: shown ? 'auto' : 'none',
                    }}>
                      <SessionResourcePanel tab={tab} active={open && shown}
                        focusRequest={shown ? resourceFocusRequest : 0}
                        onEscape={() => showBaseSurface(tab.sessionId, baseSurfaceForSession(tab.sessionId))} />
                    </div>
                  )
                })}
                {actionOutcome?.owner === 'panel' && footerState === 'live' && (
                  <div className="si-action-outcome-float"><ActionOutcome outcome={actionOutcome} /></div>
                )}
                {commandOpen && !noLivePane && (
                  <div className="si-command-layer" role="dialog" aria-label={t('session.commandBox')}>
                    <button type="button" className="si-command-dismiss" tabIndex={-1}
                      aria-label={t('session.commandClose')} onMouseDown={closeCommandBox} />
                    <ComposerSurface
                      className={`si-command-box${dragTarget === 'command' ? ' dragover' : ''}`}
                      onDragOver={(e) => onDragOverFiles(e, 'command')}
                      onDragLeave={() => setDragTarget(null)}
                      onDrop={(e) => onDropFiles(e, 'command')}
                      editor={(
                        <>
                        <div className="fv-tawrap">
                          <ComposerTextarea ref={msgRef} className="si-command-input" rows={1} value={msg}
                            data-focus-sink
                            onChange={(e) => { setMsg(e.target.value); syncMenu(e.target) }}
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
                          {menu && (menu.kind === 'mention' || menu.kind === 'session' || menu.kind === 'launcher') && mentionMenuEl(true)}
                        </div>
                        {attachmentQueue('command')}
                        </>
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
                          <IconButton icon={uploadingAt('command') ? 'loader' : 'paperclip'} size={14}
                            iconClassName={uploadingAt('command') ? 'si-attach-busy' : undefined}
                            className="si-command-tool" label={t('session.attachTitle')}
                            disabled={uploadingAt('command')} onClick={() => pickFiles('command')} />
                          {actionOutcome?.owner === 'command' && <ActionOutcome outcome={actionOutcome} />}
                          <IconButton icon="send" size={14} className="si-command-send" label={t('session.commandSend')}
                            disabled={!msg.trim() || (actionOutcome?.owner === 'command' && actionOutcome.phase === 'sending')} onClick={sendMsg} />
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
    {archiveIndexOpen && <ArchivePage sessions={archivedSessions} onOpenSession={(id) => { setArchiveIndexOpen(false); onPickSession?.(id); selectSession(id) }} onClose={() => { setArchiveIndexOpen(false); if (archiveRequested) navigate('sessions', active === 'new' ? null : active) }} />}
    <SessionContextMenu
      menu={ctxMenu}
      onClose={() => setCtxMenu(null)}
      onChanged={reload}
      onError={(message) => {
        const id = ctxMenu?.session?.id
        if (id && id !== active) {
          setSel(id)
          requestAnimationFrame(() => setActionOutcome({ owner: 'panel', phase: 'failed', message }))
          return
        }
        setActionOutcome({ owner: 'panel', phase: 'failed', message })
      }}
      onLock={(s) => { onPickSession?.(s, false); onClose() }}
    />
    </>
  )
}
