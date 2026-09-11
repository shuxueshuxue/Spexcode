import { useContext, useMemo } from 'react'
import { TranscriptUi, defaultLabels } from '@spexcode/transcript-ui'
import RichText from './RichText.js'
import { BlobMedia } from './Evidence.jsx'
import { routeHash } from './route.js'
import { newTabAnchor } from './tabs.js'
import { useT } from './i18n/index.jsx'
import { readerIsSelecting } from './readerSelection.js'
import { CopyButton } from './CopyButton.jsx'
import { Icon } from './icons.jsx'
import { SessionFilesContext, fileRefAddress, filePreviewUrl, resolveFileRef } from './fileRefs.js'
import { addressHash } from './address.js'

// THE DASHBOARD'S BINDING of the transcript grammar. The components — the person quoted, the agent as the
// page, a tool call as a sentence, the work folded behind its answer, the live tail — are `@spexcode/transcript-ui`
// ([[transcript-ui]]); this module supplies only what is this product's: its prose renderer (spec links,
// evidence), its copy control, its words in the reader's language, and where a withheld tool body is fetched from.

// A posted file named in the conversation opens the tab the session's files menu opens. A name the session's
// list does not answer to exactly once stays visibly unresolved rather than guessing which file was meant.
function FileRef({ name, provenance }) {
  const t = useT()
  const scope = useContext(SessionFilesContext)
  const { path, matches } = resolveFileRef(name, scope?.files)
  if (!path) {
    return <span className="doc-file-ref is-unresolved" data-tip={matches > 1 ? t('fileRef.ambiguous', { count: matches }) : t('fileRef.missing')} {...provenance}>
      <Icon name="folder-open" size={12} />{name}
    </span>
  }
  if (!scope.tabs) {
    return <a className="doc-file-ref" href={filePreviewUrl(scope.sessionId, path)} target="_blank" rel="noreferrer" {...provenance}>
      <Icon name="folder-open" size={12} />{name}
    </a>
  }
  const href = addressHash(fileRefAddress(scope.sessionId, path))
  return <a className="doc-file-ref" href={href} data-tip={path} {...provenance} onClick={(event) => newTabAnchor(event, href)}>
    <Icon name="folder-open" size={12} />{name}
  </a>
}

// The transcript is the one message surface in the dashboard: a newline here was typed by a person or an
// agent mid-conversation, not wrapped by an editor, so it stays a line break instead of reflowing.
export function TimelineRichText({ children, className = '' }) {
  return <RichText className={className} softBreak="break"
    renderFileRef={(name, token, provenance) => <FileRef name={name} provenance={provenance} />}
    renderSpecRef={(id, token, provenance) => {
      const href = routeHash('spec', id)
      return <a className="doc-link" href={href} {...provenance} onClick={(event) => newTabAnchor(event, href)}>{id}</a>
    }}
    renderEvidence={(meta, token, provenance) => <span className="rich-evidence" {...provenance}><BlobMedia hash={meta.hash} alt={meta.alt || 'evidence'} /></span>}>
    {children}
  </RichText>
}

const renderTimelineText = (text) => <TimelineRichText>{text}</TimelineRichText>
const renderTimelineCopy = (text) => <CopyButton text={text} />

// `loadToolOutput` is per seam (its interval addresses the body); everything else is set once at the top of the
// conversation and inherited. A seam passes only the loader, so the outer binding is never restated.
export function DashboardTranscriptUi({ loadToolOutput, children }) {
  const t = useT()
  const labels = useMemo(() => ({ ...defaultLabels, loading: t('common.loading'), running: t('session.executionRunning'), more: t('mobile.more') }), [t])
  // Conversation prose stays browser-native. The shared selection controller publishes its Range separately;
  // transcript-ui only needs this predicate to avoid treating an active drag as a clamped-block click.
  return <TranscriptUi renderText={renderTimelineText} renderCopy={renderTimelineCopy} labels={labels} loadToolOutput={loadToolOutput} suppressExpand={readerIsSelecting}>{children}</TranscriptUi>
}
