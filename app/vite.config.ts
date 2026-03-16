import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 3500,
  },
  envDir: '.',
  plugins: [react()],
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
