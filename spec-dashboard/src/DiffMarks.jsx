import { useT } from './i18n/index.jsx'
import { splitPath } from './diffTree.js'

// [[diff-marks]]: the three marks every surface that shows a change draws with, so a change reads the same
// in the session diff, a spec's pending redline, and a version's history row. The colours they wear are the
// sheet's `--diff-*` pair; nothing here picks a hue of its own.

/** `+N −N` — additions then deletions, always both, in the diff pair. */
export function DiffStat({ additions = 0, deletions = 0 }) {
  return (
    <span className="diffstat">
      <span className="diffstat-add">+{additions}</span>
      <span className="diffstat-del">−{deletions}</span>
    </span>
  )
}

// git's own one-letter status vocabulary, the column every source-control view already reads; the word
// rides on the tooltip in the reader's language. A status git adds later still shows its first letter.
const LETTERS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', 'type-changed': 'T', untracked: 'U' }

export function StatusMark({ status }) {
  const t = useT()
  const known = Object.hasOwn(LETTERS, status)
  const word = known ? t(`diffMarks.${status}`) : String(status)
  return (
    <span className={`diff-status is-${known ? status : 'other'}`} role="img" aria-label={word} data-tip={word}>
      {known ? LETTERS[status] : String(status).charAt(0).toUpperCase()}
    </span>
  )
}

// A path identifies itself by its tail, so when room runs out the directories in front of the leaf give, at
// their FRONT, and the leaf never does. The directory run sits in an RTL box so the browser's own ellipsis
// lands on the left, and the text inside is an isolated LTR run so its characters keep their order: the DOM
// reads front to back, and a copy or a screen reader gets the real path.
export function PathLabel({ path, ...rest }) {
  const { dir, name } = splitPath(path)
  return (
    <span className="path-label" {...rest}>
      {dir && <span className="path-dir"><bdi dir="ltr">{dir}/</bdi></span>}
      <span className="path-leaf">{name}</span>
    </span>
  )
}
