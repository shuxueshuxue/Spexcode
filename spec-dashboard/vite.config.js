import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // dev: proxy /api to the spec-cli server so the dashboard is same-origin (ws:true upgrades the live
  // terminal's WebSocket — /api/sessions/:id/socket — through to the backend too).
  // (API_URL lets a non-default backend port be targeted without editing this file)
  server: { proxy: { '/api': { target: process.env.API_URL || 'http://localhost:8787', ws: true } } },
})
