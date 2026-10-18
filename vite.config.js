import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  test: {
    // Vitest config lives here; it auto-discovers *.test.js / *.spec.js files.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
