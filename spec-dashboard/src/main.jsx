import React from 'react'
import ReactDOM from 'react-dom/client'
import Root from './Root.jsx'
import { I18nProvider } from './i18n/index.jsx'
import { legacyProjectsRedirect } from './project.js'
import './styles.css'

// the ReactFlowProvider lives in Dashboard.jsx now — hoisting it here would drag xyflow into the entry
// chunk that the mobile face never uses (the desktop/mobile trees are code-split in App.jsx).
const redirect = legacyProjectsRedirect(location.pathname, location.hash)
if (redirect) {
  location.replace(redirect)
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <I18nProvider>
        <Root />
      </I18nProvider>
    </React.StrictMode>,
  )
}
