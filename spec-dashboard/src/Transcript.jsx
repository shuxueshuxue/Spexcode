import { useMemo } from 'react'
import { TranscriptUi, defaultLabels } from '@spexcode/transcript-ui'
import RichText from './RichText.js'
import { BlobMedia } from './Evidence.jsx'
import { routeHash } from './route.js'
import { newTabAnchor } from './tabs.js'
import { useT } from './i18n/index.jsx'

// THE DASHBOARD'S BINDING of the transcript grammar. The components — the person quoted, the agent as the
// page, a tool call as a sentence, the work folded behind its answer, the live tail — are `@spexcode/transcript-ui`
// ([[transcript-ui]]); this module supplies only what is this product's: its prose renderer (spec links,
// evidence), its words in the reader's language, and where a withheld tool body is fetched from.

// The transcript is the one message surface in the dashboard: a newline here was typed by a person or an
// agent mid-conversation, not wrapped by an editor, so it stays a line break instead of reflowing.
export function TimelineRichText({ children, className = '' }) {
  return <RichText className={className} softBreak="break"
    renderSpecRef={(id, token, provenance) => {
      const href = routeHash('spec', id)
      return <a className="doc-link" href={href} {...provenance} onClick={(event) => newTabAnchor(event, href)}>{id}</a>
    }}
    renderEvidence={(meta, token, provenance) => <span className="rich-evidence" {...provenance}><BlobMedia hash={meta.hash} alt={meta.alt || 'evidence'} /></span>}>
    {children}
  </RichText>
}

const renderTimelineText = (text) => <TimelineRichText>{text}</TimelineRichText>

// `loadToolOutput` is per seam (its interval addresses the body); everything else is set once at the top of the
// conversation and inherited. A seam passes only the loader, so the outer binding is never restated.
export function DashboardTranscriptUi({ loadToolOutput, children }) {
  const t = useT()
  const labels = useMemo(() => ({ ...defaultLabels, loading: t('common.loading'), running: t('session.executionRunning'), more: t('mobile.more') }), [t])
  return <TranscriptUi renderText={renderTimelineText} labels={labels} loadToolOutput={loadToolOutput}>{children}</TranscriptUi>
}
