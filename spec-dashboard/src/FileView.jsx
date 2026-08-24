import { useMemo, useRef, useState } from 'react'
import SourceView from './SourceView.jsx'
import ProseActions from './ProseActions.jsx'
import { useT } from './i18n/index.jsx'
import { fetchNodeFileSlice } from './data.js'

// [[file-view]]: a governed source file addressed on its own, for when the reader arrived at the file
// rather than at the node that claims it. It adds nothing to [[source-view]] but an address — which is the
// point: a file opened from the dock and a file opened under its spec must be the same reader.
//
export default function FileView({ param }) {
  const t = useT()
  const sourceHostRef = useRef(null)
  const [selection, setSelection] = useState(null)
  const parts = param?.startsWith('.spec/') ? param.slice('.spec/'.length).split('/') : []
  const attachment = parts.length >= 2 ? { nodeId: parts[0], name: parts.slice(1).join('/') } : null
  const read = useMemo(() => attachment ? (offset) => fetchNodeFileSlice(attachment.nodeId, attachment.name, offset) : undefined,
    [attachment?.nodeId, attachment?.name])
  if (!param) return <div className="doc-empty">{t('fileView.none')}</div>
  // Attachment chips use the same #/file address family with a logical `.spec/<node>/<name>` path.
  // `.spec/**` is outside /api/source's governed-file policy, so route those reads through the node-owned
  // endpoint while keeping one FileView and one tab identity for both kinds of file document.
  return (
    <div className="fileview" ref={sourceHostRef}>
      <SourceView key={param} path={param} read={read} onSelection={setSelection} />
      <ProseActions hostRef={sourceHostRef} codeSelection={selection} onCodeSelectionClear={() => setSelection(null)} />
    </div>
  )
}
