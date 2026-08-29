import { useEffect, useState } from 'react'
import { useTranscriptUi, type ToolOutputResult } from './context.js'
import { Caret, Spinner } from './icons.js'
import { isRunning } from './segments.js'
import { prettyInput, runKinds, splitTarget, toolName, toolTarget, toolVerb, type AnyTool } from './vocabulary.js'

// A LIVE FRAME WITHHOLDS OUTPUT BODIES: a recorded result is `null` on the wire, its size told, and the body
// is fetched once when a person opens the call, through the host's loader.
function WithheldOutput({ tool }: { tool: AnyTool }) {
  const { loadToolOutput, labels } = useTranscriptUi()
  const [fetched, setFetched] = useState<ToolOutputResult | null>(null)
  useEffect(() => {
    if (!loadToolOutput) return undefined
    let live = true
    loadToolOutput(tool.id).then((result) => { if (live) setFetched(result) }, (error) => { if (live) setFetched({ ok: false, error: String((error as Error)?.message || error) }) })
    return () => { live = false }
  }, [loadToolOutput, tool.id])
  if (!loadToolOutput) return null
  if (!fetched) return <div className="tx-tool-out tx-tool-out-state">{labels.loading}</div>
  if (!fetched.ok) return <div className="tx-tool-out tx-tool-out-state is-error">{fetched.error}</div>
  return <pre className="tx-tool-out">{fetched.output ?? ''}</pre>
}

// One tool call as a SENTENCE, not a card: verb, target, and the size of what came back. It is
// `inline-flex` so a dozen of them read as a list of things that happened rather than a dozen boxes. There
// is no success mark — the past-tense verb is the whole claim. A running call wears a small spinner and the
// word; a call whose harness recorded a structured failure wears `failed`, and one the person refused wears
// `rejected` — the outcome is the transcript's own field ([[transcript-reader]]), never read off the output prose.
export function ToolLine({ tool, open, onToggle, live = false }: { tool: AnyTool; open: boolean; onToggle: () => void; live?: boolean }) {
  const { labels, vocabulary } = useTranscriptUi()
  const target = toolTarget(tool.input, vocabulary)
  const { lead, trail } = splitTarget(target)
  const lines = tool.outputLines || 0
  const withheld = tool.output === null
  const canOpen = !!tool.input || tool.output !== undefined || withheld
  const running = isRunning(tool, live)
  const outcome = tool.outcome
  const { server } = toolName(tool.name)
  const row = (
    <>
      <span className="tx-tool-verb">{toolVerb(tool.name, vocabulary)}</span>
      {server && <span className="tx-tool-server">{server}</span>}
      {lead && <span className="tx-tool-target">{lead}</span>}
      {trail && <span className="tx-tool-trail">{trail}</span>}
      {lines > 0 && <span className="tx-tool-size">{labels.lines(lines)}</span>}
      {running && <span className="tx-tool-running"><Spinner />{labels.running}</span>}
      {outcome && <span className={`tx-tool-outcome is-${outcome}`}>{outcome === 'failed' ? labels.failed : labels.rejected}</span>}
      {canOpen && <Caret open={open} className="tx-tool-caret" />}
    </>
  )
  return (
    <div className={`tx-tool${running ? ' is-running' : ''}${outcome ? ` is-${outcome}` : ''}`}>
      {canOpen
        ? <button type="button" onClick={onToggle} aria-expanded={open} className="tx-tool-row is-openable">{row}</button>
        : <div className="tx-tool-row">{row}</div>}
      {open && canOpen && <>
        {tool.input && <pre className="tx-tool-in">{prettyInput(tool.input)}</pre>}
        {withheld
          ? <WithheldOutput tool={tool} />
          : tool.output !== undefined && <pre className="tx-tool-out">{tool.output}</pre>}
      </>}
    </div>
  )
}

// A turn's tool calls are consecutive by construction, so "a run" is just "this turn's calls". `runMin` or
// more fold to one row; fewer stay sentences, where the verb and target are worth reading on sight. `fold`
// is off for the work in progress: calls still landing are sentences whatever their number.
export function ToolRun({ tools, openIds, onToggle, live = false, fold = true }: { tools?: readonly AnyTool[]; openIds: ReadonlySet<string>; onToggle: (id: string) => void; live?: boolean; fold?: boolean }) {
  const { labels, vocabulary, runMin, fold: policy } = useTranscriptUi()
  if (!tools?.length) return null
  const line = (tool: AnyTool) => <ToolLine key={tool.id} tool={tool} open={openIds.has(tool.id)} onToggle={() => onToggle(tool.id)} live={live} />
  if (!fold || policy === 'none' || tools.length < runMin) return <div className="tx-tools">{tools.map(line)}</div>
  const id = `run:${tools[0].id}`
  const open = openIds.has(id)
  const running = tools.some((tool) => isRunning(tool, live))
  // a fold must not hide a failure: the row counts the calls that did not succeed
  const failed = tools.filter((tool) => tool.outcome).length
  return <div className="tx-tools">
    <div className={`tx-tool${running ? ' is-running' : ''}${failed ? ' is-failed' : ''}`}>
      <button type="button" className="tx-tool-row is-openable is-run" aria-expanded={open} onClick={() => onToggle(id)}>
        <span className="tx-tool-verb">{labels.toolUses(tools.length)}</span>
        <span className="tx-tool-trail">{runKinds(tools, vocabulary)}</span>
        {failed > 0 && <span className="tx-tool-outcome is-failed">{labels.failedCount(failed)}</span>}
        <Caret open={open} className="tx-tool-caret" />
      </button>
      {open && <div className="tx-tool-kids">{tools.map(line)}</div>}
    </div>
  </div>
}
