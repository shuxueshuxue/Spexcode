import Modal from './Modal.jsx'
import { STATUS, GLYPH } from './SpecNode.jsx'
import { useT } from './i18n/index.jsx'

// @@@ Legend - the single home for the keymap + visual vocabulary, shown in the shared centered Modal
// opened by the HUD's discreet `?` (key or click). It reads STATUS and GLYPH straight from SpecNode.jsx
// (the node renderer), so the swatches can NEVER drift from what the board actually draws — change a
// colour or glyph there and the legend follows. All COPY routes through t() (the keys/glyphs themselves
// are language-neutral and stay literal). Modal owns the backdrop/header/close chrome; Esc / `?` / ×
// close it (see App + Modal).

// keymap key-glyphs are language-neutral; the description for each row is pulled from t() by key.
const BOARD_KEYS = [
  [['↑', 'k', '↓', 'j'], 'legend.board.move'],
  [['←', 'h'], 'legend.board.parent'],
  [['→', 'l'], 'legend.board.child'],
  [['+', '−', '0'], 'legend.board.zoom'],
  [['i'], 'legend.board.info'],
  [['/'], 'legend.board.search'],
  [['o', 'O'], 'legend.board.overlayCycle'],
  [['⏎'], 'legend.board.enter'],
  [['n', 'n'], 'legend.board.newChild'],
  [['d', 'd'], 'legend.board.del'],
  [[','], 'legend.board.settings'],
  [['?'], 'legend.board.help'],
]
const POPUP_KEYS = [
  [['←', '→', 'h', 'l', '⇥', '1', '2'], 'legend.popup.switch'],
  [['j', 'k', '↑', '↓'], 'legend.popup.scroll'],
  [['⏎'], 'legend.popup.enter'],
  [['esc'], 'legend.popup.esc'],
]

// status dot meanings — keyed off STATUS so the colour is always the live one; copy via t().
const STATUS_ROWS = ['merged', 'active', 'drift', 'pending']

// overlay op glyphs — keyed off GLYPH; each is a worktree's pending change to a node.
const OP_ROWS = ['added', 'edited', 'deleted', 'moved']

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
          <KeymapSection title={t('legend.secBoard')} rows={BOARD_KEYS} t={t} />
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
