import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the dashboard talks to the FastAPI backend through this proxy, so the
// browser sees a single origin and no CORS configuration is needed.
const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
})
