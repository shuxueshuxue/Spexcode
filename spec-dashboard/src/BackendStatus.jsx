import { useSyncExternalStore } from 'react'
import { getBackendHealth, retryBackend, subscribeBackendHealth } from './data.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

export function useBackendHealth() {
  return useSyncExternalStore(subscribeBackendHealth, getBackendHealth, getBackendHealth)
}

export function BackendStatusFrame({ children }) {
  const t = useT()
  const health = useBackendHealth()
  return <div className="backend-frame">
    {health.offline && <div className="backend-offline-banner" role="alert">
      <Icon name="info" size={14} />
      <span>{t('backend.offline')}</span>
      <button type="button" onClick={retryBackend}>{t('backend.retry')}</button>
    </div>}
    {children}
  </div>
}
