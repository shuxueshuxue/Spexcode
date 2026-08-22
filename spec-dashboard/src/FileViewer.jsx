import { useCallback } from 'react'
import Modal from './Modal.jsx'
import SourceView from './SourceView.jsx'
import { fetchNodeFileSlice } from './data.js'
import { useT } from './i18n/index.jsx'
import { useEscLayer } from './escStack.js'

// Where a file opened from [[file-tree]] lands. It is a LAYER rather than a second pane because two
// documents side by side is not yet reachable: the page components read the global route, so rendering two
// at once would mean changing every one of them to take a route instead. Naming that honestly is better
// than a half-split that only works for this one document type.
//
// It carries no reading machinery of its own — the same [[source-view]] renders a governed file and a
// node's attachment, because they differ only in which gate admitted the bytes.
export default function FileViewer({ file, onClose }) {
  const t = useT()
  useEscLayer(true, onClose)
  const read = useCallback(
    (offset) => fetchNodeFileSlice(file.nodeId, file.name, offset),
    [file.nodeId, file.name],
  )
  return (
    <Modal title={file.label} closeLabel={t('common.close')} onClose={onClose} className="fileviewer">
      {file.kind === 'attachment'
        ? <SourceView key={`a:${file.nodeId}/${file.name}`} path={file.name} read={read} />
        : <SourceView key={`s:${file.path}`} path={file.path} />}
    </Modal>
  )
}
