import SourceView from './SourceView.jsx'
import { useT } from './i18n/index.jsx'
import { useStatusItem } from './StatusBar.jsx'

// [[file-view]]: a governed source file addressed on its own, for when the reader arrived at the file
// rather than at the node that claims it. It adds nothing to [[source-view]] but an address — which is the
// point: a file opened from the dock and a file opened under its spec must be the same reader.
//
// The path is a fact about the current document, so it goes where every other such fact goes: the status
// bar ([[status-bar]]'s registry). A title strip of its own would have been a band the shell's budget does
// not allow, saying what the tab and the address already say.
export default function FileView({ param }) {
  const t = useT()
  useStatusItem(param ? { id: 'file-path', side: 'left', priority: 500, text: param } : null)
  if (!param) return <div className="doc-empty">{t('fileView.none')}</div>
  return (
    <div className="fileview">
      <SourceView key={param} path={param} />
    </div>
  )
}
