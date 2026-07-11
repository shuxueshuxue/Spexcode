import Modal from './Modal.jsx'
import { STATUS, GLYPH } from './SpecNode.jsx'
import { ACT, keyCap } from './keymap.js'
import { keysOf } from './bindings.js'
import { useT } from './i18n/index.jsx'

// @@@ Legend - the single home for the keymap + visual vocabulary, shown in the shared centered Modal
// opened by the HUD's discreet `?` (key or click). The BOARD keymap is rendered straight from the keymap
// registry (keymap.js, resolved through bindings.js), so the help can NEVER drift from what the handler
// dispatches. Status dots / op glyphs read STATUS & GLYPH from SpecNode.jsx so the swatches match the
// board. The node-info popup's own pane/scroll keys are a fixed structural set (POPUP_KEYS), listed but
// not in the rebindable registry. All COPY routes through t(); keys/glyphs are language-neutral.

// alt keys not worth showing in the legend are dropped (the shift-less zoom variants, the capital of a
// letter that's already shown). Glyphs come from keymap.js so the legend and the editor read the same.
const KEY_SKIP = new Set(['=', '_', 'I', 'H', 'J', 'K', 'L'])

// fold the registry into legend rows: consecutive actions sharing a description collapse into one row
// (so up+down read as a single "move" line) while keeping every key.
const BOARD_ROWS = (() => {
  const rows = []
  for (const a of ACT) {
    const keys = keysOf(a.id).filter((k) => !KEY_SKIP.has(k)).map(keyCap)
    const last = rows[rows.length - 1]
    if (last && last.desc === a.desc) last.keys.push(...keys)
    else rows.push({ desc: a.desc, keys })
  }
  return rows
})()

const POPUP_KEYS = [
  [['←', '→', 'h', 'l', '⇥', '1', '2'], 'legend.popup.switch'],
  [['j', 'k', '↑', '↓'], 'legend.popup.scroll'],
  // the lens keys: Shift makes nav pass THROUGH the popup — same walk as the board, popup follows focus
  [['⇧h', '⇧j', '⇧k', '⇧l', '⇧←↑↓→'], 'legend.popup.lens'],
  [['⏎'], 'legend.popup.enter'],
  [['esc'], 'legend.popup.esc'],
]

const STATUS_ROWS = ['merged', 'active', 'drift', 'pending']
const OP_ROWS = ['added', 'edited', 'deleted', 'moved']

// the board keymap, rendered from the registry so it can't drift from what the handler dispatches.
function BoardKeymap({ t }) {
  return (
    <section className="legend-sec">
      <div className="legend-h">{t('legend.secBoard')}</div>
      {BOARD_ROWS.map((r) => (
        <div className="legend-row" key={r.desc}>
          <span className="keymap-keys">{r.keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
          <span className="legend-desc">{t(r.desc)}</span>
        </div>
      ))}
    </section>
  )
}

function KeymapSection({ title, rows, t }) {
  return (
    <section className="legend-sec">
      <div className="legend-h">{title}</div>
      {rows.map(([keys, descKey]) => (
        <div className="legend-row" key={descKey}>
          <span className="keymap-keys">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
          <span className="legend-desc">{t(descKey)}</span>
        </div>
      ))}
    </section>
  )
}

export default function Legend({ onClose }) {
  const t = useT()
  return (
    <Modal title={t('legend.title')} closeLabel={t('legend.close')} onClose={onClose}>
          <BoardKeymap t={t} />
          <KeymapSection title={t('legend.secPopup')} rows={POPUP_KEYS} t={t} />

          <section className="legend-sec">
            <div className="legend-h">{t('legend.secStatus')}</div>
            {STATUS_ROWS.map((k) => (
              <div className="legend-row" key={k}>
                <span className="node-dot" style={{ background: STATUS[k].color }}>
                  {k === 'active' && <span className="pulse" style={{ background: STATUS[k].color }} />}
                </span>
                <span className="legend-name">{t(`status.${k}`)}</span>
                <span className="legend-desc">{t(`legend.statusRows.${k}`)}</span>
              </div>
            ))}
          </section>

          <section className="legend-sec">
            <div className="legend-h">{t('legend.secOp')} <span className="legend-sub">{t('legend.secOpSub')}</span></div>
            {OP_ROWS.map((k) => (
              <div className="legend-row" key={k}>
                <span className={`ov-mark ov-${k}`}>{GLYPH[k]}</span>
                <span className="legend-desc">{t(`legend.opRows.${k}`)}</span>
              </div>
            ))}
          </section>

          <section className="legend-sec">
            <div className="legend-h">{t('legend.secBadges')}</div>
            <div className="legend-row">
              <span className="drift-badge">⚠N</span>
              <span className="legend-desc">{t('legend.badgeDrift')}</span>
            </div>
            <div className="legend-row">
              <span className="legend-glyph legend-ver">vN</span>
              <span className="legend-desc">{t('legend.badgeVer')}</span>
            </div>
          </section>

          <section className="legend-sec">
            <div className="legend-h">{t('legend.secRing')}</div>
            <div className="legend-row">
              <span className="legend-ring ring-dashed" />
              <span className="legend-desc">{t('legend.ringDashed')}</span>
            </div>
            <div className="legend-row">
              <span className="legend-ring ring-solid" />
              <span className="legend-desc">{t('legend.ringSolid')}</span>
            </div>
            <div className="legend-row">
              <span className="legend-ring ring-ghost" />
              <span className="legend-desc">{t('legend.ringGhost')}</span>
            </div>
          </section>
    </Modal>
  )
}
