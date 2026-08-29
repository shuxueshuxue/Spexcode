import { createContext, useContext, type ReactNode } from 'react'
import { defaultVocabulary, type Vocabulary } from './vocabulary.js'
import type { FoldPolicy, UserTurnPolicy } from './segments.js'
import { defaultEnvelopes, type EnvelopeParser } from './envelope.js'

// EVERY TUNABLE IN ONE PLACE. The components below read this instead of threading a dozen props: how prose
// is rendered (an adopter's markdown, spec links, evidence), where a withheld tool body comes from, what the
// few words the surface says are (its own language), which vocabulary names the calls, and how the fold
// behaves. A host wraps its surface in `TranscriptUi` once; a host that wraps nothing gets the defaults.
export type ToolOutputResult = { ok: true; output: string | null } | { ok: false; error: string }
export type Labels = Readonly<{
  loading: string
  running: string
  failed: string            // the word a failed call wears; `rejected` for one the person refused
  rejected: string
  failedCount: (n: number) => string   // on a folded run: how many of its calls did not succeed
  more: string
  toolUses: (n: number) => string
  lines: (n: number) => string
  empty: string
  outputCut: (omittedBytes: number) => string   // on ONE opened call: how much of its result the cap left out
  truncated: (info: { omittedTurns: number; omittedBytes: number; outOfOrderEvents: number }) => string
}>
export const defaultLabels: Labels = {
  loading: 'loading…',
  running: 'running',
  failed: 'failed',
  rejected: 'rejected',
  failedCount: (n) => `${n} failed`,
  more: 'more',
  toolUses: (n) => `${n} tool use${n === 1 ? '' : 's'}`,
  lines: (n) => `${n} line${n === 1 ? '' : 's'}`,
  empty: 'nothing in this interval',
  outputCut: (n) => `${n.toLocaleString()} more bytes not shown`,
  truncated: ({ omittedTurns, omittedBytes, outOfOrderEvents }) => `truncated: ${omittedTurns} turns and ${omittedBytes} bytes omitted${outOfOrderEvents ? `, ${outOfOrderEvents} records out of order` : ''}`,
}

export type TranscriptUiOptions = Readonly<{
  // prose → elements. The default keeps the writer's line breaks and paragraphs and renders nothing else; a
  // host with a markdown pipeline passes it here and the same renderer serves every turn, quote and note.
  renderText: (text: string) => ReactNode
  // a live frame withholds output bodies; the host that knows the transport fetches one when a person opens
  // the call. Absent = every body is inline (a closed read) and a withheld one shows nothing to fetch with.
  loadToolOutput: ((toolId: string) => Promise<ToolOutputResult>) | null
  labels: Labels
  vocabulary: Vocabulary
  // how a quoted turn's sender is read off its delivery envelope — parser rows tried in order
  // ([[transcript-view]]); the SpexCode footer ships as the default row, a host adds its own beside it
  envelopes: readonly EnvelopeParser[]
  fold: FoldPolicy
  runMin: number
  userTurns: UserTurnPolicy
}>

// the default prose renderer: paragraphs on blank lines, line breaks kept — a message was typed, not laid out
export function PlainText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/)
  return <div className="tx-prose">{paragraphs.map((paragraph, index) => (
    <p key={index}>{paragraph.split('\n').flatMap((line, at) => at ? [<br key={`b${at}`} />, line] : [line])}</p>
  ))}</div>
}

export const defaultOptions: TranscriptUiOptions = {
  renderText: (text) => <PlainText text={text} />,
  loadToolOutput: null,
  labels: defaultLabels,
  vocabulary: defaultVocabulary,
  envelopes: defaultEnvelopes,
  fold: 'segments',
  runMin: 3,
  userTurns: 'boundary',
}

const Context = createContext<TranscriptUiOptions>(defaultOptions)
export const useTranscriptUi = (): TranscriptUiOptions => useContext(Context)

export function TranscriptUi({ children, ...overrides }: Partial<TranscriptUiOptions> & { children: ReactNode }) {
  const parent = useContext(Context)
  const value: TranscriptUiOptions = { ...parent, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<TranscriptUiOptions> }
  return <Context.Provider value={value}>{children}</Context.Provider>
}
