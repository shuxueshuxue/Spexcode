import { Suspense, lazy } from 'react'
import SideBar, { rememberReviewAddress } from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import StatusBar from './StatusBar.jsx'
import { useIsMobile } from './useIsMobile.js'
import { useT } from './i18n/index.jsx'
import { useBoard, useBoardApi } from './workspace.jsx'
import { viewFor } from './views.jsx'

const MobileApp = lazy(() => import('./MobileApp.jsx'))

// Review is a complete surface, not a workspace document. Explorer, tab strip, dock, and the workspace
// document pool are structurally outside this tree. Issues is intentionally a focused reading surface:
// its activity rail is omitted so the issue list/detail owns the whole frame (DetailShell's metadata rail
// remains part of the issue itself).
export const reviewShowsActivityRail = (page) => page !== 'issues'

export default function ReviewSurface({ page, param, query }) {
  const isMobile = useIsMobile()
  const t = useT()
  const { specs = [], sessions = [], issuesStamp = null } = useBoard()
  const { reload } = useBoardApi()
  const loading = <div className="loading">{t('hud.loading')}</div>
  const { component: View } = viewFor(page)
  rememberReviewAddress({ page, param, query })

  if (isMobile) {
    return (
      <div className="review-surface review-surface-mobile">
        <Suspense fallback={loading}>
          <MobileApp specs={specs} sessions={sessions} issuesStamp={issuesStamp} reloadBoard={reload} route={{ page, param, query }} />
        </Suspense>
        <StatusBar />
      </div>
    )
  }

  const showActivityRail = reviewShowsActivityRail(page)
  return (
    <div className={`review-surface app-shell${showActivityRail ? '' : ' review-surface-no-activity-rail'}`}>
      <div className="app">
        <TooltipLayer />
        {showActivityRail && <SideBar page={page} hideDockToggle />}
        <div className="app-content-column">
          <div className="app-content-row">
            <div className="app-main">
              <div className={`page-pane page-${page}`}>
                <Suspense fallback={loading}>
                  <View param={param} query={query} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
