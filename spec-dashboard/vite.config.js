import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // dev: proxy /api to the spec-cli server so the dashboard is same-origin
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
