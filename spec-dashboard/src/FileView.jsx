import SourceView from './SourceView.jsx'
import { useT } from './i18n/index.jsx'

// [[file-view]]: a governed source file addressed on its own, for when the reader arrived at the file
// rather than at the node that claims it. It adds nothing to [[source-view]] but a title and an address —
// which is the point: a file opened from the dock and a file opened under its spec must be the same reader.
export default function FileView({ param }) {
  const t = useT()
  if (!param) return <div className="doc-empty">{t('fileView.none')}</div>
  return (
    <div className="fileview">
      <div className="fileview-head"><code>{param}</code></div>
      <SourceView key={param} path={param} />
    </div>
  )
}
