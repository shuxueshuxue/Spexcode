import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'
import TimelineChat from './TimelineChat.jsx'
import DiffDocument from './DiffDocument.jsx'
import { createSession, useLaunchers, useCommandPresets, useHarnessCommands } from './launch.js'
import { sessionFooterState, sessionForest, sessionHeadline } from './session.js'
import { boardCommandFor, expandMentions, typeTrigger, useMentionAutocomplete } from './mentions.jsx'
import { useAttachQueue } from './useAttachQueue.jsx'
import { harnessForId } from './harness.jsx'
import { Icon, IconButton } from './icons.jsx'
import { ReviewState } from './ReviewShell.jsx'
import { TabCount } from './score.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import SessionForestPanel from './SessionForestPanel.jsx'
import { inboxCommands, uiCommandsFor } from './sessionCommands.js'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { addressHash, routeAddress, sessionEvalAddress } from './address.js'
import { routeHash } from './route.js'
import { markNewTab, useTabs } from './tabs.js'
import { useI18n, useT } from './i18n/index.jsx'
import { apiFetch, COMMAND_DELIVERY_TIMEOUT_MS, sendSessionCommand } from './data.js'
import { apiUrl } from './project.js'
import {
  SESSION_SURFACE_CONVERSATION,
  SESSION_SURFACE_TERMINAL,
  SESSION_SURFACE_DIFF,
  getSessionBaseSurface,
  isSessionSurface,
  isResourceSurface,
  resourceSurface,
  resourceSurfaceKey,
  resourceTabKey,
  setSessionBaseSurface,
  subscribeSessionSurface,
} from './sessionSurface.js'
import { firesEvent, withShortcut } from './bindings.js'
import { inertChromePress } from './focus.js'
import { useEscLayer } from './escStack.js'
import RichText from './RichText.js'
import { useTransientNotice } from './TransientNotice.jsx'
import { decodePrompt, encodePrompt } from './codeSelection.js'
import SelectionAttachment from './SelectionAttachment.jsx'
import { isTypingTarget, useKeyboardScope } from './KeyboardService.jsx'
import { useDocumentAction } from './documentActions.jsx'
import TabStrip from './TabStrip.jsx'
import { useStatusItem } from './StatusBar.jsx'
import { useFold } from './useFold.js'
import { usePaneActive, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { useViewScope } from './ViewScope.jsx'
import { useSessionListState } from './sessionListState.js'

const isHeadlessSession = (session) => session?.capabilities?.headless === true

// HOW MANY CONVERSATIONS STAY MOUNTED. A visited Conversation is kept warm so a revisit keeps its timeline
// cursor and rendered history ([[conversation]]), but "visited" is not a bound: a reader working through a
// day's board mounted one full timeline per session ever opened — closed and archived records included,
// since a retained row is still a valid id — and never gave one back. Measured on this project's board:
// thirteen visits took the document from 1,001 DOM nodes to 25,675 and the heap from 29MB to 97MB, and the
// browser never reclaimed either until a reload. This is the same bound the workspace already puts on mounted
// documents (`POOL_LIMIT`, [[workspace-shell]]) and it is set the same way — large enough that the sessions a
// reader is actually moving between are all warm, small enough that an idle console is idle. Eviction is by
// LEAST RECENTLY SHOWN, and the selection is never the victim.
const CONVERSATION_LIMIT = 6
// One frozen empty list, not a fresh `[]` per render: a hidden layer's props have to be referentially stable
// or its memo gate (TimelineChat) can never hold, and a literal here was the one prop that broke it.
const NO_BOARD_COMMANDS = []

// @@@ a warm terminal belongs to a LIVE pane — a row must SAY it has one.
// The archive index is a row summary, not a session record: it carries an id, a title and a closedAt and
// no liveness, harness or capabilities at all. Asking `liveness !== 'offline'` read that ABSENCE as alive,
// so every retired session mounted an xterm and opened a socket — measured on this project's board, 66 of
// the 76 warm terminals belonged to closed sessions. Ask for the live pane instead of for the absence of a
// dead one, and a row that reports nothing reports no pane.
const hasLivePane = (session) => !session?.archived && session?.liveness === 'online'

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

// `title` and `label` are two truncations of ONE source in the ordinary case — a session nobody renamed
// carries a 60-column prompt preview as its title and whatever the record stored as its search key — so
// string inequality is not difference, and a handle that is the title again, cut shorter, is the left
// column printed twice. The handle earns its place beside the title only when neither opens the other.
const archiveHandle = (session) => {
  const label = String(session?.label ?? '')
  if (!label) return null
  const [title, handle] = [String(sessionHeadline(session) ?? ''), label].map((value) => value.replace(/…$/, ''))
  return title.startsWith(handle) || handle.startsWith(title) ? null : label
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
    return sessions.filter((session) => [sessionHeadline(session), session.label, session.id]
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
                <span className="si-archive-row-name">
                  <span className="si-archive-row-title">{sessionHeadline(session)}</span>
                  {archiveHandle(session) && <span className="si-archive-row-label">{archiveHandle(session)}</span>}
                </span>
                <time dateTime={session.closedAt || undefined}>{timeLabel(session)}</time>
                <Icon name="chevron-right" size={14} className="si-archive-row-go" />
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
const HERO_WORDMARK = [
  '███████╗██████╗ ███████╗██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔════╝██╔══██╗██╔════╝╚██╗██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '███████╗██████╔╝█████╗   ╚███╔╝ ██║     ██║   ██║██║  ██║█████╗  ',
  '╚════██║██╔═══╝ ██╔══╝   ██╔██╗ ██║     ██║   ██║██║  ██║██╔══╝  ',
  '███████║██║     ███████╗██╔╝ ██╗╚██████╗╚██████╔╝██████╔╝███████╗',
  '╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
].join('\n')
// The launch state is the quietest surface in the product: an empty room waiting for one sentence. Its
// six-line wordmark is the product identity cue; the input remains the first interactive control below it.
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
const webProxyUrl = (sessionId, key) => `${PROJECT_BASE}/web/${encodeURIComponent(sessionId)}/${encodeURIComponent(key)}/`

function ResourceMenu({ options, onOpen }) {
  const t = useT()
  return (
    <div className="document-action-menu" role="menu" aria-label={t('session.resourceMenuLabel')}
      onMouseDown={(event) => event.stopPropagation()}>
      {options.length ? options.map((tab) => (
        <button key={tab.id} type="button" className="si-resource-menu-row" role="menuitem" onClick={() => onOpen(tab)}>
          <Icon name={tab.kind === 'file' ? 'folder-open' : 'globe'} size={13} />
          <span>{tab.label}</span>
        </button>
      )) : <span className="si-resource-menu-empty">{t('session.resourceMenuEmpty')}</span>}
    </div>
  )
}

function RegisteredDocumentAction({ document, action }) {
  useDocumentAction(document, action)
  return null
}

function SessionDocumentActions({ document, actions }) {
  return actions.map((action) => <RegisteredDocumentAction key={action.id} document={document} action={action} />)
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

// The session action projection consumes only the canonical graph session projection. Last-known survives input invalidation,
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

// the whole composer grammar — `[[`/`@` mentions, the `/` palettes, their ranking and dropdowns — is the ONE
// shared hook in ./mentions.jsx ([[mentions]]), armed here twice (the New prompt with the launch-preset
// palette, the Command Box with the board/preset/harness palette) and once more by the Conversation footer in
// TimelineChat.jsx. The attachment path is likewise the one shared ./useAttachQueue.jsx ([[file-attach]]).
// This console keeps no menu state or upload machinery of its own; it only names its surfaces.

// The Command Box, New prompt, and review/issue composers share ComposerTextarea's measurement and IME
// boundary. Their domain grammars remain local to the home that sends them.

function LauncherPicker({ launchers, launcher, pickLauncher, onSettings }) {
  const t = useT()
  const [pop, setPop] = useState(false)
  useEscLayer(pop, () => setPop(false))
  // the trigger's glyph shows the SELECTED launcher's harness (unknown/absent harness reads as claude,
  // the default — same fallback the backend applies).
  const selected = launchers.find((l) => l.name === launcher)
  const selHarness = harnessForId(selected?.harness)
  const SelGlyph = selHarness.Glyph
  return (
    <div className="si-launcher-picker">
      {launchers.length > 0 && (
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
      )}
      {pop && (
        <>
          {/* full-viewport backdrop — the outside-click close surface; a mousedown here is inert chrome
              under the panel's keepFocus blanket, so the composer keeps focus while the pop closes. */}
          <div className="si-launcher-backdrop" onMouseDown={() => setPop(false)} />
          <div className="si-launcher-pop" role="dialog" aria-modal="true" aria-label={t('session.launcherPickerTitle')}>
            <div className="si-launcher-pop-head">
              <div className="si-launcher-pop-copy">
                <strong className="si-launcher-pop-title">{t('session.launcherPickerTitle')}</strong>
                <span className="si-launcher-pop-subtitle">{t('session.launcherPickerHint')}</span>
              </div>
              <IconButton
                icon="settings"
                size={15}
                className="icon-btn si-launcher-settings"
                label={t('session.launcherSettings')}
                onClick={() => { setPop(false); onSettings?.() }}
              />
            </div>
            {launchers.map((l) => {
              const h = harnessForId(l.harness)
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

export default function SessionInterface({ sessions, specs = [], focusNode, open, searchOpen = false, sel, setSel, seed, onSeedConsumed, onClose, onPickSession, onOpenArchive, onOpenSearch, reload, boardLive = false, archiveRequested = false, surface = null, route = null }) {
  const t = useT()
  const scope = useViewScope()
  const { notify } = useTransientNotice()
  const { lockGraphTo } = useWorkspaceApi()
  // The forest is this document's sidebar and folds from the rail's one panel control like the explorer
  // does ([[side-nav]]): the same workspace open/closed boolean, read here rather than a second fold state
  // the console would have to keep in step.
  const { dock: forestOpen } = useWorkspace()
  // the Sessions document's own left sidebar. It folds on the SAME workspace flag the shell's dock does, so
  // it folds the same way ([[dock-modes]]) — it used to be the one panel in the frame that blinked out.
  const [forestMounted, forestClosing, forestFolding] = useFold(forestOpen)
  const [prompt, setPrompt] = useState('')    // the New Session tab's own draft (its boarding-switch cache)
  const [codeSelections, setCodeSelections] = useState([])
  const [ctxMenu, setCtxMenu] = useState(null) // selected-session document tools menu
  const [selectRequest, setSelectRequest] = useState(null)
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
  const [resourceTabs, setResourceTabs] = useState([])
  const { tabs: openTabs } = useTabs()
  const [unreadResources, setUnreadResources] = useState(() => new Set())
  const [openedConversations, setOpenedConversations] = useState(() => new Set())
  const [surfaceVersion, setSurfaceVersion] = useState(0)
  const [resourceMenu, setResourceMenu] = useState(false)
  const taRef = useRef(null)
  const msgRef = useRef(null)
  // One opaque key per session draft lets a queued transport retry the same durable message. It is cleared
  // only after accepted handover or when the human edits the draft, never when the box merely closes.
  const commandDeliveryKeysRef = useRef({})
  const knownWebsRef = useRef(null)
  const archiveRequestRef = useRef(null)
  useEffect(() => subscribeSessionSurface(() => setSurfaceVersion((version) => version + 1)), [])
  const outcomeTimerRef = useRef(null)

  useEffect(() => {
    if (!actionOutcome || actionOutcome.phase === 'pending' || actionOutcome.phase === 'sending') return
    notify(actionOutcome.message, { kind: actionOutcome.phase === 'delivered' ? 'success' : 'error' })
    setActionOutcome(null)
  }, [actionOutcome, notify])

  const closeCommandBox = () => {
    if (outcomeTimerRef.current) window.clearTimeout(outcomeTimerRef.current)
    outcomeTimerRef.current = null
    setCommandOpen(false)
    setActionOutcome((outcome) => outcome?.owner === 'command' ? null : outcome)
  }

  const [archiveRows, setArchiveRows] = useState(null)
  const [pendingSession, setPendingSession] = useState(null)
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
    if (pendingSession && !byId.has(pendingSession.id)) byId.set(pendingSession.id, pendingSession)
    return [...byId.values()]
  }, [sessions, archiveRows, pendingSession])
  // A close removes the session from the working projection before the archive index refresh reaches this
  // document. Keep ids that this mounted console has already rendered addressable during that short gap;
  // otherwise the validity effect below turns a successful close into an unrelated New Session navigation.
  // The id-addressed record is the authority for deciding whether the selection can remain.
  const knownSessionIdsRef = useRef(new Set())
  for (const session of allSessions) knownSessionIdsRef.current.add(session.id)
  const [retainedSession, setRetainedSession] = useState(null)
  useEffect(() => {
    if (retainedSession && sessions.some((session) => session.id === retainedSession.id)) setRetainedSession(null)
  }, [sessions, retainedSession])
  useEffect(() => {
    if (retainedSession && archiveRows?.some((session) => session.id === retainedSession.id)) setRetainedSession(null)
  }, [archiveRows, retainedSession])
  const sessionsWithRetention = useMemo(() => {
    if (!retainedSession || allSessions.some((session) => session.id === retainedSession.id)) return allSessions
    return [...allSessions, retainedSession]
  }, [allSessions, retainedSession])
  useEffect(() => {
    if (pendingSession && sessions.some((session) => session.id === pendingSession.id)) setPendingSession(null)
  }, [sessions, pendingSession])
  const archivedSessions = useMemo(() => archiveOrder(sessionsWithRetention.filter((session) => session.archived)), [sessionsWithRetention])
  const validIds = useMemo(() => new Set(['new', ...sessionsWithRetention.map((s) => s.id)]), [sessionsWithRetention])
  // content mode: 'new' or a session id. The archive index is a transient overlay.
  const active = validIds.has(sel) || (sel !== 'new' && knownSessionIdsRef.current.has(sel)) ? sel : 'new'
  const sessionActive = active !== 'new'
  // The console stays mounted when the dock is hidden, so its keyboard router needs the same visible
  // forest the dock renders. The disclosure store is shared with Dock; pointer and keyboard paths therefore
  // never drift into two competing fold states.
  const { expanded, offlineOpen } = useSessionListState()
  const sessionForestRows = useMemo(() => sessionForest(sessions || [], (id) => expanded.has(id), {
    zoneFolded: (zone) => zone === 'offline' && !offlineOpen,
    keepVisible: (session) => session.id === active,
  }), [sessions, expanded, offlineOpen, active])
  const sessionOrder = useMemo(() => ['new', ...sessionForestRows
    .filter((item) => item.type === 'row')
    .map((item) => item.s.id)], [sessionForestRows])
  // A removed session can be a successful close: the working board drops it while the retained archive record
  // is still arriving. Probe the id-addressed record before declaring the tab dead. Only a real 404 (or an
  // unreadable response) lands on New; a retained row is rendered by the same read-only Conversation path.
  const missingProbeRef = useRef(new Set())
  useEffect(() => {
    if (!open || sel === 'new' || validIds.has(sel) || !knownSessionIdsRef.current.has(sel)) return
    if (missingProbeRef.current.has(sel)) return
    missingProbeRef.current.add(sel)
    fetch(apiUrl(`/api/sessions/${encodeURIComponent(sel)}`)).then(async (response) => {
      if (!response.ok) {
        setSel('new')
        return
      }
      const row = await response.json()
      setRetainedSession({ ...row, archived: row.archived === true, liveness: row.archived === true ? 'offline' : row.liveness })
    }).catch((error) => {
      setActionOutcome({ owner: 'panel', phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      setSel('new')
    })
  }, [open, sel, validIds, setSel])
  const focusId = focusNode?.id || null
  const selSession = sessionsWithRetention.find((s) => s.id === active)
  const [archiveIndexOpen, setArchiveIndexOpen] = useState(false)
  useEffect(() => { if (archiveRequested) setArchiveIndexOpen(true) }, [archiveRequested])
  const terminalFree = isHeadlessSession(selSession)
  const noLivePane = selSession?.liveness === 'offline'
  const archivedSel = !!selSession?.archived
  const readOnlyPane = noLivePane || archivedSel
  const requestedSurface = isSessionSurface(surface) ? surface : null
  const requestedResourceId = isResourceSurface(requestedSurface) ? resourceSurfaceKey(requestedSurface) : null
  const activeBaseSurface = terminalFree || readOnlyPane ? SESSION_SURFACE_CONVERSATION : requestedSurface || getSessionBaseSurface(active)
  const conversationSurface = activeBaseSurface === SESSION_SURFACE_CONVERSATION
  const diffSurface = activeBaseSurface === SESSION_SURFACE_DIFF
  const baseSurfaceForSession = (id) => {
    const session = sessionsWithRetention.find((candidate) => candidate.id === id)
    return isHeadlessSession(session) ? SESSION_SURFACE_CONVERSATION : getSessionBaseSurface(id)
  }
  // Conversation owns the shared command-shaped footer, so the transient terminal Command Box opener is
  // intentionally present but disabled on that surface instead of creating a second input face.
  const commandAvailable = !conversationSurface && uiCommandsFor(selSession, {}).some((command) => command.name === 'command')
  const evalSummary = sessionEvalDisplay(sessionActive ? selSession?.evalSummary : null, boardLive, !!selSession)
  // `queued` has intentionally not launched and self-starts as a slot frees, so it has no restore action.
  const footerState = sessionFooterState(selSession)
  const resourceCatalog = selSession ? [
    ...(selSession.files || []).map((path) => ({
      id: resourceTabKey(active, 'file', path), sessionId: active, kind: 'file', value: path, label: fileName(path), revision: 0,
    })),
    ...(selSession.web || []).map((web) => ({
      id: resourceTabKey(active, 'web', web.key), sessionId: active, kind: 'web', key: web.key, value: web.url, label: webName(web.url), revision: 0,
    })),
  ] : []
  const activeResourceId = sessionActive ? requestedResourceId : null
  const activeResource = resourceTabs.find((tab) => tab.id === activeResourceId)
    || resourceCatalog.find((tab) => tab.id === activeResourceId)
    || null
  const resourceOptions = resourceCatalog.filter((option) => !openTabs.some((tab) =>
    tab.page === 'sessions' && tab.param === active && tab.query?.surface === resourceSurface(option.id)))

  const activateResource = () => {
    setResourceFocusRequest((request) => request + 1)
    closeCommandBox()
  }
  const openResource = (tab) => {
    setResourceTabs((tabs) => tabs.some((current) => current.id === tab.id) ? tabs : [...tabs, tab])
    setUnreadResources((unread) => {
      if (!unread.has(tab.id)) return unread
      const next = new Set(unread); next.delete(tab.id); return next
    })
    activateResource(tab)
    setResourceMenu(false)
    // A resource is a file-class workspace tab: navigation appends its address and leaves the session tab's
    // selected base face unchanged. The preview stays warm because the resource address is its own tab.
    scope.open({ page: 'sessions', param: tab.sessionId, query: { surface: resourceSurface(tab.id) } })
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
    setUnreadResources((unread) => new Set([...unread, ...added.map((tab) => tab.id)]))
  }, [sessions])

  useEffect(() => {
    const published = new Set()
    for (const session of sessions) {
      for (const path of session.files || []) published.add(resourceTabKey(session.id, 'file', path))
      for (const web of session.web || []) published.add(resourceTabKey(session.id, 'web', web.key))
    }
    setResourceTabs((tabs) => tabs.filter((tab) => published.has(tab.id)))
  }, [sessions])

  // Resource previews are warm only while their ordinary object tab remains open. The active route is kept
  // as a one-render grace period while useTabs records a newly opened address.
  useEffect(() => {
    const openResourceIds = new Set(openTabs
      .filter((tab) => tab.page === 'sessions' && isResourceSurface(tab.query?.surface))
      .map((tab) => resourceSurfaceKey(tab.query.surface)))
    if (activeResourceId) openResourceIds.add(activeResourceId)
    setResourceTabs((tabs) => tabs.filter((tab) => openResourceIds.has(tab.id)))
  }, [openTabs, activeResourceId])

  useEffect(() => {
    if (!activeResourceId || !activeResource) return
    setResourceTabs((tabs) => tabs.some((tab) => tab.id === activeResourceId) ? tabs : [...tabs, activeResource])
  }, [activeResourceId, activeResource])

  const unreadTabs = useMemo(() => {
    const tabs = []
    for (const session of sessions) for (const web of session.web || []) {
      const tab = { id: resourceTabKey(session.id, 'web', web.key), sessionId: session.id, kind: 'web', key: web.key, value: web.url, label: webName(web.url), revision: 0 }
      if (unreadResources.has(tab.id)) tabs.push(tab)
    }
    return tabs
  }, [sessions, unreadResources])
  useStatusItem(unreadTabs.length ? {
    id: 'session-resource-unread', side: 'right', priority: 20, kind: 'standard',
    text: t('session.unreadResources', { n: unreadTabs.length }),
    tooltip: t('session.unreadResources', { n: unreadTabs.length }),
    onClick: () => openResource(unreadTabs[0]),
  } : null)

  useEscLayer(resourceMenu, () => setResourceMenu(false))
  // Outside-press dismissal, the shape the project chip already uses. It listens for MOUSEDOWN rather than
  // click because the press that opens the menu has already happened by the time this effect binds, so the
  // opening gesture can never close what it just opened. The toggle keeps its own press: routing it here
  // too would close and reopen in one click.
  useEffect(() => {
    if (!resourceMenu) return undefined
    const onDown = (event) => {
      if (event.target?.closest?.('.document-action-menu, [data-action="resource-picker"]')) return
      setResourceMenu(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [resourceMenu])
  // Esc leaves the diff overlay for the session's own base address, the same exit a resource surface has.
  // Diff is never a base surface, so the address it returns to is the bare one.
  useEscLayer(diffSurface, () => scope.open({ page: 'sessions', param: active, query: null }, { replace: true }))
  // the active session's Command Box draft (per-session, see `drafts`).
  const msg = drafts[active] || ''
  const setMsg = (value) => setDrafts((draft) => ({
    ...draft,
    [active]: typeof value === 'function' ? value(draft[active] || '') : value,
  }))
  const selectSession = (id) => {
    if (id === 'new') return
    closeCommandBox()
    closeMenus()
    setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    setSel(id)
  }
  // Escape from a resource is a user navigation back to the session's resolved base address.
  const showBaseSurface = (id, surface, remember = false) => {
    if (id === 'new') return
    selectSession(id)
    if (surface === SESSION_SURFACE_CONVERSATION) {
      setOpenedConversations((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
    } else {
      setTerminalFocusRequest((request) => request + 1)
    }
    if (remember || id === active) scope.open({ page: 'sessions', param: id, query: { surface } }, { replace: true })
  }

  // the ACTIVE session's harness `/` commands (shared fetch, ./launch.js) — recomputed when you switch tabs, so
  // a codex session gets codex's menu and a claude session gets claude's. Display+insert only; never executed.
  const slashCmds = useHarnessCommands(selSession?.harness)

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
    closeMenus()
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
      // A terminal is a live-pane resource, not a historical session cache. When a pane goes offline or is
      // archived, remove its id here so SessionTerm cleanup closes the browser socket and native client. The
      // separate conversation set retains readable timeline history without retaining an xterm/WS pair.
      const next = new Set([...prev].filter((id) => {
        const session = sessionsWithRetention.find((candidate) => candidate.id === id)
        return session && !isHeadlessSession(session) && hasLivePane(session)
      }))
      for (const s of sessionsWithRetention) if (!isHeadlessSession(s) && hasLivePane(s)) next.add(s.id)
      if (active !== 'new') {
        const selected = sessions.find((s) => s.id === active)
        if (selected && isHeadlessSession(selected)) next.add(active)
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })
  }, [sessionsWithRetention, active])

  // What gets MOUNTED must follow what is SHOWN. This gate used to consult the stored base preference
  // (`getSessionBaseSurface`) while the visible face is `activeBaseSurface`, which already folds in the
  // address's `?surface=` and the headless/read-only resolutions. On a pane-backed session whose stored
  // base is Terminal, `#/sessions/<id>?surface=conversation` therefore hid the terminal layer and never
  // mounted the conversation one: an empty pane with no composer, which is the human's send channel gone.
  useEffect(() => {
    setOpenedConversations((prev) => {
      const valid = new Set(sessionsWithRetention.map((s) => s.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      const selected = active === 'new' ? null : sessionsWithRetention.find((s) => s.id === active)
      // the other half of the same rule: whatever has no live pane to show is shown as a Conversation, so
      // no selection can land on a session with neither layer mounted (a corrupt row's `unknown` liveness
      // used to fall through both when the terminal gate stopped naming dead states one by one).
      // THE SET'S ORDER IS THE RECENCY ORDER. Re-adding the selection at the end is what the bound below reads
      // to pick its victim, so eviction is least-recently-SHOWN rather than first-visited.
      if (selected && (!hasLivePane(selected) || isHeadlessSession(selected)
        || conversationSurface)) { next.delete(selected.id); next.add(selected.id) }
      while (next.size > CONVERSATION_LIMIT) {
        const victim = [...next].find((id) => id !== active)
        if (victim === undefined) break
        next.delete(victim)
      }
      // order-sensitive, because a pure membership check would silently drop the recency move above and
      // leave the bound evicting in visit order.
      const held = [...prev]
      if (next.size === held.length && [...next].every((id, i) => held[i] === id)) return prev
      return next
    })
  }, [sessionsWithRetention, active, conversationSurface, surfaceVersion])

  // a board chord (nn/dd) seeds this surface with an @-directive. Apply ONCE to the New draft, then clear it
  // upstream so a later reopen restores the user's own draft. Clobbering the draft is intended here.
  useEffect(() => {
    if (seed == null) return
    setSel('new')
    const decoded = decodePrompt(seed)
    setPrompt(decoded.text)
    setCodeSelections(decoded.selections)
    closeMenus()
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

  // launch a session, then follow the published id into its document. The box NEVER disables or blurs: clear the
  // draft optimistically (so a fresh draft can't be clobbered when the POST lands) and keep the launch request in
  // the background while the pending document shows its creation stages. The empty-draft check guards double-fire.
  const submit = () => {
    const raw = encodePrompt(prompt, codeSelections)
    if (!raw) return
    setPrompt('')
    setCodeSelections([])
    createSession(raw, launcher).then((result) => {
      if (result.ok && result.id) {
        setPendingSession({
          id: result.id,
          ...(result.session || {}),
          label: result.session?.label || raw.split(/\s+/).slice(0, 8).join(' ') || result.id,
          title: result.session?.title || result.session?.label || raw.split(/\s+/).slice(0, 8).join(' ') || result.id,
          status: result.session?.status || 'queued', liveness: result.session?.liveness || 'offline',
          archived: false, capabilities: result.session?.capabilities || { headless: true },
        })
        // Creation is an explicit new-document action, not ordinary session navigation. Mark the published
        // address before routing so the new session is appended and cannot evict the current session tab.
        // The create response is the publication fence: move the reader into the new document immediately,
        // while its queued/starting row and live execution trace catch up through the board stream.
        markNewTab('sessions', result.id, null)
        scope.open({ page: 'sessions', param: result.id, query: null })
        reload?.()
      } else if (!result.ok) {
        notify(result.error || t('session.launchFailed'), { kind: 'error' })
      }
    })
  }

  const sendMsg = async () => {
    const raw = msg
    if (!raw.trim() || active === 'new') return
    // a line that is EXACTLY `/<name>` of an available board command runs HERE instead of being sent to the
    // agent (this covers the no-menu submit; the menu pick runs through the grammar's onPick).
    const cmd = boardCommandFor(raw, commandBoardRows)
    if (cmd) { setMsg(''); commandGrammar.close(); cmd.run(); return }
    // resolve any `[[<node>]]` to a live spec.md pointer before it reaches the backend (the running-session twin
    // of the New Session launch composition — see [[command-box]]).
    const text = expandMentions(raw, specs)
    if (actionOutcome?.owner === 'command' && actionOutcome.phase === 'sending') return
    const deliveryId = commandDeliveryKeysRef.current[active] || crypto.randomUUID()
    commandDeliveryKeysRef.current[active] = deliveryId
    setActionOutcome({ owner: 'command', phase: 'sending', message: t('session.outcomeSending') })
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), COMMAND_DELIVERY_TIMEOUT_MS)
    try {
      const { ok, status, outcome } = await sendSessionCommand(active, text, { deliveryId, signal: controller.signal })
      if (!ok) {
        if (outcome?.deliveryPending) {
          // Durable append succeeded, but the native handoff did not. Keep the draft and box open so the
          // user can retry after the transport recovers; a queued record is not a delivered command.
          setActionOutcome({ owner: 'command', phase: 'queued', message: t('session.outcomeQueued') })
          return
        }
        setActionOutcome({
          owner: 'command',
          phase: 'failed',
          message: outcome?.error || t('session.deliveryFailed', { status }),
        })
        return
      }
      // `queued` is a MEASUREMENT — the adapter was asked and still owes the prompt — so it keeps the draft.
      // `deferred` is the ordinary Command Box path: the backend accepted the message durably and starts the
      // handover after answering, so it measured nothing about the transport and must not be read as one.
      // The queue is the delivery guarantee here, not this textarea; holding a second copy of an accepted
      // prompt bought nothing and cost a false transport warning on every single send.
      if (outcome?.delivery === 'queued') {
        setActionOutcome({ owner: 'command', phase: 'queued', message: t('session.outcomeQueued') })
        return
      }
      setMsg((current) => current === raw ? '' : current)
      delete commandDeliveryKeysRef.current[active]
      const settled = outcome?.mentionSummary
        || (outcome?.delivery === 'deferred' ? t('session.outcomeAccepted') : t('session.outcomeDelivered'))
      setActionOutcome({ owner: 'command', phase: 'delivered', message: settled })
      outcomeTimerRef.current = window.setTimeout(() => closeCommandBox(), 650)
    } catch (error) {
      if (controller.signal.aborted) {
        setActionOutcome({ owner: 'command', phase: 'failed', message: t('session.outcomeUnconfirmed') })
        return
      }
      setActionOutcome({
        owner: 'command',
        phase: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const codeSelectionQueue = () => {
    if (!codeSelections.length) return null
    return (
      <div className="si-code-selection-queue" aria-label={t('session.codeSelectionAttachments')}>
        {codeSelections.map((selection, index) => (
          <SelectionAttachment key={`${selection.path}:${selection.startLine}:${selection.endLine}:${index}`} selection={selection}
            onRemove={() => setCodeSelections((current) => current.filter((_item, itemIndex) => itemIndex !== index))} />
        ))}
      </div>
    )
  }

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

  const resumeAndReturnToWorking = async () => {
    const ok = await act('resume')
    if (ok) {
      await refreshArchive()
    }
    return ok
  }

  // `runners` binds each dashboard-owned command to the closure that does it. Agent workflows such as
  // `/merge` arrive through the plugin preset/skill path and never acquire a second dashboard runner.
  const runners = {
    command: () => { if (commandOpen) closeCommandBox(); else setCommandOpen(true) },
    // the Eval DOOR ([[session-eval]]): the session's evaluation lives on the Evals route family now —
    // the typed /eval navigates to the session-scoped list through the ONE [[address-routing]] projection
    // (a real page switch, one push), never a console-local pane. The tab-bar door below is the same
    // address as a REAL anchor.
    eval: () => { if (sessionActive) scope.open(routeAddress(sessionEvalAddress(active))) },
    relaunch: resumeAndReturnToWorking,
    stop: (owner) => act('stop', undefined, owner),     // soft stop: kill tmux + socket, KEEP the worktree → read-only Conversation
    close: (owner) => act('close', undefined, owner),
  }
  const uiCmds = uiCommandsFor(selSession, runners)
  const typedUiCmds = uiCmds.filter((command) => command.typed !== false && command.enabled)
  // THE CONSOLE'S GRAMMARS, one shared hook each ([[mentions]]) — no menu state of this file's own. Board
  // commands (coloured, run HERE) lead the Command Box palette; SpexCode prompt presets follow; harness
  // commands come last — inboxCommands' precedence, ranked by the one shared matcher. The Conversation
  // footer (TimelineChat) arms the same hook with the same board rows, owned by the panel outcome instead of
  // the box's, so `/stop` typed there reports where that surface reports.
  const boardRow = (command, owner) => ({ name: command.name, description: t(command.descKey), ui: true, color: command.color, run: () => command.run?.(owner) })
  const ui = typedUiCmds.map((command) => boardRow(command, 'command'))
  const conversationBoardRows = typedUiCmds.map((command) => boardRow(command, 'panel'))
  const newGrammar = useMentionAutocomplete({
    inputRef: taRef, value: prompt, setValue: setPrompt, specs, sessions: sessionsWithRetention, launchers, focusId,
    // the launch preset palette: a preset governs the whole launch, so a token picked anywhere in an existing
    // draft becomes its leading command. Still an authoring edit only — Enter sends the normalized raw grammar
    // through createSession, and the backend remains the sole plugin-body interpreter.
    slash: { commands: commandPresets, mode: 'token', head: t('session.menuPresets'), onPick: (item, menu) => {
      const rest = [prompt.slice(0, menu.start).trim(), prompt.slice(menu.end).trim()].filter(Boolean).join(' ')
      const next = `/${item.name}${rest ? ` ${rest}` : ''} `
      setPrompt(next)
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length) } })
      return true
    } },
  })
  const commandGrammar = useMentionAutocomplete({
    inputRef: msgRef, value: msg, setValue: setMsg, specs, sessions: sessionsWithRetention, launchers, focusId, up: true,
    // a board command RUNS on pick (the typed twin of its button); presets and harness commands insert text.
    slash: { commands: inboxCommands(ui, commandPresets, slashCmds), mode: 'line', head: t('session.menuCommands'), onPick: (item) => {
      if (!item.ui) return false
      setMsg('')
      item.run()
      return true
    } },
  })
  const commandBoardRows = ui
  const closeMenus = () => { newGrammar.close(); commandGrammar.close() }
  // the grammar's discoverability doors type the exact trigger so the SAME autocomplete opens naturally
  const insertCommandTrigger = (trigger) => typeTrigger(msgRef.current, trigger, setMsg, commandGrammar.sync)
  // each composer's attachment path ([[file-attach]]): its own queue, picker, and drop ring
  const newAttach = useAttachQueue({ inputRef: taRef, setValue: setPrompt, variant: 'new' })
  const commandAttach = useAttachQueue({ inputRef: msgRef, setValue: setMsg, variant: 'command' })
  // THE EVAL DOOR'S ONE SENTENCE. The summary is a projection with phases, not a number that is either
  // there or not, so the door says which phase it is reading and carries the last-known counts through
  // every phase that still has them — a door that silently printed stale counts would be the same control
  // in two different truths.
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
  // THE SESSION'S EVAL DOOR lives on the AMBIENT LINE ([[status-bar]]), not in the document-action band.
  // The band is a row of verbs that act on the document; this is one persistent readout of how the
  // document's measurement is doing, which is the fact a status line exists to hold. It rides the right
  // group beside the console's other document fact (unread resources) and outside the workspace ledger.
  //
  // IT MUST NOT LEAK ONTO A NEIGHBOUR. The workspace keeps documents MOUNTED while hidden ([[workspace-shell]]'s
  // pool), so "am I rendered" is not "am I the document being read" — registering on mount alone would leave
  // a session's eval glance sitting on the line while the reader is looking at a spec. The pane's own active
  // flag is that distinction, and passing null disposes the registration in the same effect that made it, so
  // the door leaves the line on the tab switch itself rather than one paint later.
  const paneShowing = usePaneActive()
  const evalDoorShowing = paneShowing && sessionActive && uiCmds.some((command) => command.name === 'eval')
  useStatusItem(evalDoorShowing ? {
    id: 'session-eval', side: 'right', priority: 25,
    tooltip: evalDoorTitle,
    node: (
      <a className="si-eval-door" data-action="eval" href={addressHash(sessionEvalAddress(active))}
        data-tip={evalDoorTitle} aria-label={evalDoorTitle}>
        <Icon name="evals" size={14} />
        <SessionEvalStats summary={evalSummary} />
      </a>
    ),
  } : null)

  const documentKey = sessionActive
    ? routeHash('sessions', active, requestedSurface ? { surface: requestedSurface } : null)
    : null
  const surfaceChoices = terminalFree || readOnlyPane
    ? [SESSION_SURFACE_CONVERSATION]
    : [SESSION_SURFACE_CONVERSATION, SESSION_SURFACE_TERMINAL, SESSION_SURFACE_DIFF]
  const baseSurface = activeBaseSurface === SESSION_SURFACE_DIFF
    ? getSessionBaseSurface(active)
    : activeBaseSurface
  const documentActions = sessionActive ? [
    {
      id: 'resource-picker', icon: 'folder-open', label: t('session.addResourceTab'), priority: 100,
      pressed: resourceMenu, haspopup: true,
      onClick: () => setResourceMenu((open) => { if (!open) setCtxMenu(null); return !open }),
      menuKey: resourceMenu ? resourceOptions.map((option) => option.id).join(',') : '',
      menu: resourceMenu ? <ResourceMenu options={resourceOptions} onOpen={openResource} /> : null,
    },
    ...(!activeResource && surfaceChoices.length > 1 ? [
      {
        id: 'surface-switcher', icon: baseSurface === SESSION_SURFACE_TERMINAL ? 'message-square' : 'terminal',
        label: t(baseSurface === SESSION_SURFACE_TERMINAL ? 'session.switchToConversation' : 'session.switchToTerminal'),
        priority: 80,
        menuKey: `${baseSurface}:${diffSurface ? 'diff' : 'base'}`,
        onClick: () => {
          setResourceMenu(false)
          const next = baseSurface === SESSION_SURFACE_TERMINAL ? SESSION_SURFACE_CONVERSATION : SESSION_SURFACE_TERMINAL
          setSessionBaseSurface(active, next)
          showBaseSurface(active, next, true)
        },
      },
      {
        id: 'diff-switcher', icon: 'git-compare', label: t(diffSurface ? 'session.diffClose' : 'session.diffScope'),
        priority: 79, pressed: diffSurface,
        menuKey: diffSurface ? 'diff' : 'base',
        onClick: () => {
          setResourceMenu(false)
          showBaseSurface(active, diffSurface ? getSessionBaseSurface(active) : SESSION_SURFACE_DIFF, true)
        },
      },
    ] : []),
    ...uiCmds.filter((command) => command.button && !activeResource && (activeBaseSurface === 'terminal' || command.name !== 'merge')).map((command) => {
      const enabled = command.enabled && !(command.name === 'command' && conversationSurface)
      return ({
      id: command.name,
      icon: command.icon,
      label: enabled
        ? withShortcut(t(command.titleKey), ...(command.shortcut ? [command.shortcut] : []))
        : t(command.disabledTitleKey || command.titleKey),
      disabled: !enabled,
      disabledReason: command.enabled ? undefined : t(command.disabledTitleKey),
      pressed: command.pressed ? commandOpen : undefined,
      onClick: () => command.run?.(),
      priority: command.anchor === 'right' ? -10 : 50,
    })
    }),
    ...(activeResource ? [
      {
        id: 'refresh-resource', icon: 'rotate-ccw', label: t('session.refreshResourceTab', { name: activeResource.label }), priority: 40,
        onClick: () => refreshResource(activeResource),
      },
      ...(activeResource.kind === 'file' ? [
        { id: 'download-resource', icon: 'download', label: t('session.downloadFile'), priority: 39, onClick: () => { void downloadFile(activeResource.sessionId, activeResource.value) } },
        { id: 'copy-resource', icon: 'copy', label: activeResource.value, priority: 38, onClick: () => { void copyFilePath(activeResource.value) } },
      ] : []),
    ] : []),
  ] : []
  // Window-level router owns only app shortcuts, Command Box/menu keys, and list navigation. Ordinary
  // terminal keys fall through to xterm.
  const stateRef = useRef({})
  // the router drives whichever surface is active: the New prompt's grammar or the Command Box's
  const grammar = active === 'new' ? newGrammar : commandGrammar
  stateRef.current = {
    active, submit, menu: grammar.menu, navMenu: grammar.nav, accept: grammar.accept, closeMenu: grammar.dismiss,
    open, searchOpen, commandOpen, commandAvailable, setCommandOpen, closeCommandBox, sessionOrder,
  }
  // The console's whole keyboard contract, registered as ONE service scope (priority 10 — above the
  // shell's globals, below any modal). Consumption is signalled the way the branches always did — via
  // stopPropagation, which the service reads as consumed. A botched conversion once left this in a
  // useEffect whose body called onKey(window.event): no listener, no scope, every console key dead.
  useKeyboardScope((event) => {
    const onKey = (e) => {
      const {
        active, menu, navMenu, accept, closeMenu, open, searchOpen, commandOpen,
        commandAvailable, setCommandOpen, closeCommandBox, sessionOrder,
      } = stateRef.current
      if (!open || searchOpen) return   // panel hidden, OR the search palette modal is open above us and owns the keys: nothing here listens
      if (e.target?.closest?.('[data-focus-overlay]')) return // a transient modal owns its focused control's native keys
      // Native buttons own Enter/Space activation even while the New Session tab is selected. Keep the
      // console router from cancelling a fold header's default click; text inputs still reach the menu/send paths below.
      if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('button, a[href]')) return
      // Reserved ⌥I toggles Command Box before xterm — resolved through the keymap registry
      // (`shell.commandBox`) rather than matched inline, so the legend, the settings editor and the tool's
      // own tooltip all read the SAME binding. `firesEvent` matches on e.code (the physical I key) because
      // ⌥I on a mac prints a dead-key glyph, not 'i'. Command/Ctrl variants remain browser shortcuts.
      if (firesEvent('shell.commandBox', e) && !e.metaKey && !e.ctrlKey && active !== 'new') {
        e.preventDefault(); e.stopPropagation()
        if (commandAvailable) { if (commandOpen) closeCommandBox(); else setCommandOpen(true) }
        return
      }
      // the app's GLOBAL ⌥ command family — ⌥N (New Session composer), ⌥F (evals) — is
      // reserved over the console too: fall through
      // UNHANDLED so the App-level window listener (registered after this child's, so next in the capture
      // chain) routes it — never forwarded to tmux. Matched by e.code for the same mac ⌥-dead-key reason as
      // ⌥I. ⌘/⌃ variants stay with the browser (⌘N/⌃N are its hard-reserved new-window accelerator anyway).
      // The ⌥-digit row left the reserve with the bindings it protected: the shell claims no digit now, so
      // holding one back would only make ⌥1 a key that does nothing anywhere.
      if (e.altKey && !e.metaKey && !e.ctrlKey && ['KeyN', 'KeyF'].includes(e.code)) return
      // a completion menu owns navigation/commit/dismiss while it's open — on the New Session prompt
      // OR Command Box. Capture claims Enter before the textarea, so accepting never also sends.
      if (menu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navMenu(1); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); navMenu(-1); return }
        if ((e.key === 'Enter' || e.key === 'Tab') && !composingKey(e)) { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return }
        if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); closeMenu(); return }
      }
      if (commandOpen && e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); closeCommandBox(); return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Plain arrows remain native in xterm and editable composers. Inert console chrome (including the
        // conversation reading surface) uses the same visible order as the modifier route.
        if (isTypingTarget(e.target)) return
        e.preventDefault(); e.stopPropagation()
        let index = sessionOrder.indexOf(active)
        if (index < 0) index = 0
        const next = Math.max(0, Math.min(sessionOrder.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
        if (sessionOrder[next] !== active) {
          if (onPickSession) onPickSession(sessionOrder[next])
          else setSel(sessionOrder[next])
        }
        return
      }
      // The New Session textarea owns the launch action's plain-Enter path below. This scope deliberately
      // stays out of that branch so a completion menu can consume Enter first and Shift+Enter remains native
      // multiline editing ([[new-session-tab]]).
    }
    onKey(event)
    return event.cancelBubble
  }, 10, { allowTyping: true })

  // A surface may cancel the native menu only where it offers one of its own. The console once cancelled it
  // for the WHOLE panel, which was survivable while a session list occupied most of that panel and did own a
  // right-click menu; with the list retired the panel is conversation text, diff text and a terminal, and
  // the blanket cancel bought nothing while taking copy/paste/search-selection away from all three. The
  // session's own right-click menu now lives where the session rows do — the finding dock.

  return (
    <>
    {/* a routed PAGE ([[side-nav]]), not a lifted modal: no backdrop, no outside-click close — it fills the
        app's main area and stays MOUNTED while other pages show so terminals keep their sockets/scroll
        warm. Visibility itself is the shell's pane boundary — the console never toggles its own display. */}
    <div className="si-page">
      {forestMounted && <SessionForestPanel
        closing={forestClosing}
        folding={forestFolding}
        sessions={sessions}
        activeId={active}
        // The Sessions document owns both its forest and its document chrome. Keeping these siblings
        // makes the forest push the tabstrip/content column right instead of starting underneath a
        // shell-level tabstrip.
        onSelect={(id, options) => onPickSession ? onPickSession(id, options) : (id === 'new' ? setSel('new') : selectSession(id))}
        archiveActive={archiveRequested}
        onArchive={onOpenArchive}
        onSearch={onOpenSearch}
        reload={reload}
        onContextMenu={setCtxMenu}
        selectRequest={selectRequest}
        onSelectRequestConsumed={() => setSelectRequest(null)}
        onError={(message) => setActionOutcome({ owner: 'panel', phase: 'failed', message })}
      />}
      <div className="si-document">
        {route && <TabStrip specs={specs} sessions={sessions} route={route}
          onSessionContextMenu={(next) => { setResourceMenu(false); setCtxMenu(next) }} />}
      {/* the panel-wide keepFocus blanket ([[terminal-input]] / [[focus-return]]): every pointer-down on
          console chrome is inert for focus — only the composers, the rename input, and the xterm screen
          take pointer focus, so the current sink (TUI, Command Box, or New) keeps typing focus through
          any chrome interaction. Capture phase so no child's stopPropagation can leak a press. */}
      <div className="si-panel" onMouseDownCapture={inertChromePress}>
        {/* each authored composer's own hidden picker ([[file-attach]]); its paperclip clicks it */}
        {newAttach.fileInput}
        {commandAttach.fileInput}
        <section className={`si-content${active === 'new' ? ' is-new' : ' is-session'}`}>
          {active === 'new' && (
            <div className="si-new-center">
              <LaunchHero />
              <div className={newAttach.dragging ? 'si-inputwrap dragover' : 'si-inputwrap'} {...newAttach.dropProps}>
                <ComposerTextarea
                  ref={taRef}
                  className="si-input"
                  data-focus-sink
                  rows={1}
                  value={prompt}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey || composingKey(event)) return
                    event.preventDefault()
                    event.stopPropagation()
                    submit()
                  }}
                  onChange={(e) => { setPrompt(e.target.value); newGrammar.sync(e.target) }}
                  onSelect={(e) => newGrammar.sync(e.target)}
                  onPaste={newAttach.onPaste}
                  onBlur={newGrammar.close}
                  placeholder={t('session.inputPlaceholder')}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="si-attach"
                  data-tip={t('session.attachTitle')}
                  onClick={newAttach.pick}
                  disabled={newAttach.busy}
                >{newAttach.busy ? <BusyGlyph /> : <AttachGlyph />}</button>
                {/* THE EXPLICIT LAUNCH CONTROL remains the pointer twin of plain Enter. The press is inert
                    chrome: the draft box must keep focus through the launch, because the whole point of
                    firing in the background is that the reader can keep typing. */}
                <IconButton icon="send" size={14} className="si-launch" label={t('session.launchSend')}
                  disabled={!prompt.trim()} onMouseDown={inertChromePress} onClick={submit} />
                {/* the `[[`/`@` dropdown and the config-preset `/` palette — one hook, opening downward here */}
                {newGrammar.menuEl}
              </div>
              {codeSelectionQueue()}
              {newAttach.queue}
              {/* launcher picker — the only launch choice ([[launcher-select]]): the pop-out button picker
                  (LauncherPicker above) with per-launcher harness marks and read-only cmd details. */}
              {launchers.length ? (
                <LauncherPicker
                  launchers={launchers}
                  launcher={launcher}
                  pickLauncher={pickLauncher}
                  onSettings={() => scope.open({ page: 'settings', param: null, query: null })}
                />
              ) : null}
              <div className="si-hint">
                {t('session.hint.before')}<code>[[</code>{t('session.hint.mid')}<code>/</code>{t('session.hint.after')}
              </div>
            </div>
          )}
          {/* the session pane stays LAID OUT under the New tab so warm terminals keep their final geometry;
              visibility hides it without a 0x0 renderer. Session chrome belongs to the shell's document-action
              slot; this content starts directly below the top tab row. */}
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
              <SessionDocumentActions document={documentKey} actions={documentActions} />
              {/* The live terminal stays mounted when the Eval tab routes the app away (warm-terminals
                  contract); the routed session page is display-hidden, so socket + scroll survive. */}
              <div
                className={`si-term-body${conversationSurface ? ' is-conversation' : ''}${diffSurface ? ' is-diff' : ''}${activeResource ? ' is-resource' : ''}`}
                id={activeResource ? `si-resource-panel-${activeResource.id}` : `si-${activeBaseSurface}-panel-${active}`}
                aria-label={activeResource?.label || t(conversationSurface ? 'session.tabConversation' : 'session.tabTerminal')}
                style={{ position: 'relative' }}
              >
                {/* Live terminals stay warm; every lifecycle state uses the same Conversation DOM. */}
                {[...new Set([...opened, ...openedConversations])].map((id) => {
                  const session = sessionsWithRetention.find((candidate) => candidate.id === id)
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
                            writable={open && terminalShown}
                            // `asking` is lifecycle intent (a human reply is needed), not proof that the live
                            // TUI is suspended. Keep the first-key resume gate opt-in for an explicit witness.
                            focusRequest={id === active ? terminalFocusRequest : 0} />
                        </div>
                      )}
                      {(headless || openedConversations.has(id)) && (
                        // A WARM CONVERSATION IS NOT A LAID-OUT ONE. `visibility: hidden` keeps a subtree in the
                        // layout tree, so every mounted timeline was measured again each time the console's own
                        // composer autosized itself — one forced reflow per character, over every retained
                        // session's rendered history. `content-visibility` skips the contents of what nobody is
                        // looking at while KEEPING its rendering state (unlike `display: none`, which would
                        // throw away the scroll position and the mount is here to preserve it), so the price of
                        // typing stops depending on how much history is warm behind the composer: measured on
                        // this project's board, 119ms per character down to 3.6ms, the same as an empty console.
                        // The terminal layer beside it deliberately keeps its layout — [[terminal-io]]'s warm
                        // pane owes xterm its final geometry, and terminals are not what the reflow was costing.
                        <div className="si-term-layer" style={{
                          position: 'absolute', inset: 0,
                          visibility: conversationShown ? 'visible' : 'hidden',
                          contentVisibility: conversationShown ? 'visible' : 'hidden',
                          pointerEvents: conversationShown ? 'auto' : 'none',
                        }}>
                          <TimelineChat s={session} sessions={sessionsWithRetention} active={open && conversationShown}
                            specs={specs} boardCommands={id === active ? conversationBoardRows : NO_BOARD_COMMANDS}
                            footerState={sessionFooterState(session)}
                            onRestore={id === active && session.status !== 'retired' ? resumeAndReturnToWorking : undefined}
                            actionOutcome={id === active && actionOutcome?.owner === 'panel' ? actionOutcome : null} />
                        </div>
                      )}
                    </div>
                  )
                })}
                {diffSurface && <DiffDocument sessionId={active} />}
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
                        onEscape={() => showBaseSurface(tab.sessionId, baseSurfaceForSession(tab.sessionId), true)} />
                    </div>
                  )
                })}
                {actionOutcome?.owner === 'panel' && footerState === 'live' && (
                  <div className="si-action-outcome-float"><ActionOutcome outcome={actionOutcome} /></div>
                )}
                {commandOpen && !noLivePane && !conversationSurface && (
                  <div className="si-command-layer" role="dialog" aria-label={t('session.commandBox')}>
                    <button type="button" className="si-command-dismiss" tabIndex={-1}
                      aria-label={t('session.commandClose')} onMouseDown={closeCommandBox} />
                    <ComposerSurface
                      className={`si-command-box${commandAttach.dragging ? ' dragover' : ''}`}
                      {...commandAttach.dropProps}
                      editor={(
                        <>
                        <div className="fv-tawrap">
                          <ComposerTextarea ref={msgRef} className="si-command-input" rows={1} value={msg}
                            data-focus-sink
                            onChange={(e) => { delete commandDeliveryKeysRef.current[active]; setMsg(e.target.value); commandGrammar.sync(e.target) }}
                            onSelect={(e) => commandGrammar.sync(e.target)}
                            onPaste={commandAttach.onPaste}
                            onBlur={commandGrammar.close}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey && !composingKey(e)) {
                                e.preventDefault(); e.stopPropagation(); sendMsg()
                              }
                            }}
                            placeholder={t('session.commandPlaceholder')} spellCheck={false} />
                          {/* the board/preset/harness `/` palette and the `[[`/`@` dropdown — one hook, opening upward */}
                          {commandGrammar.menuEl}
                        </div>
                        {commandAttach.queue}
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
                          <IconButton icon={commandAttach.busy ? 'loader' : 'paperclip'} size={14}
                            iconClassName={commandAttach.busy ? 'si-attach-busy' : undefined}
                            className="si-command-tool" label={t('session.attachTitle')}
                            disabled={commandAttach.busy} onClick={commandAttach.pick} />
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
    </div>
    {archiveIndexOpen && <ArchivePage sessions={archivedSessions} onOpenSession={(id) => { setArchiveIndexOpen(false); onPickSession?.(id); selectSession(id) }} onClose={() => { setArchiveIndexOpen(false); if (archiveRequested) scope.open({ page: 'sessions', param: active === 'new' ? null : active, query: null }) }} />}
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
      // claiming the graph is a WORKSPACE act ([[workspace-shell]]) — the same claim the finding dock's
      // session rows make. It used to be handed to a callback that expected a session id and got a session,
      // which is how a menu item can look wired and do nothing.
      onLock={(s) => { lockGraphTo(s.source, { toggle: false }); onClose() }}
      onMultiSelect={(session) => setSelectRequest(session)}
      onDetach={(session) => {
        void apiFetch('/api/sessions/reparent', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ children: [session.id], parent: null }),
        }).then(() => reload?.())
      }}
    />
    </>
  )
}
