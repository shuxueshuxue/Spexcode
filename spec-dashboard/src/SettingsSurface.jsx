import { Suspense } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import StatusBar from './StatusBar.jsx'
import { useT } from './i18n/index.jsx'
import { viewFor } from './views.jsx'

// Settings owns its page layout. Keeping it outside WorkspaceSurface prevents a settings view from
// accidentally acquiring Explorer, the tab strip, or a document-pool slot as the workspace evolves.
export default function SettingsSurface({ page = 'settings' }) {
  const t = useT()
  const { component: Settings } = viewFor(page)
  return (
    <div className="settings-surface app-shell">
      <div className="app">
        <TooltipLayer />
        <SideBar page={page} hideDockToggle />
        <div className="app-content-column">
          <div className="app-content-row">
            <div className="app-main">
              <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}><Settings /></Suspense>
            </div>
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
