import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { I18nProvider } from './i18n/index.jsx'
import './styles.css'

// the ReactFlowProvider lives in Dashboard.jsx now — hoisting it here would drag xyflow into the entry
// chunk that the mobile face never uses (the desktop/mobile trees are code-split in App.jsx).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
