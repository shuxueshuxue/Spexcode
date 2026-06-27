import React from 'react'
import ReactDOM from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
import App from './App.jsx'
import { I18nProvider } from './i18n/index.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>
    </I18nProvider>
  </React.StrictMode>,
)
