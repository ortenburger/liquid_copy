import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin proxy for Open Carrusel API (avoids CORS in the library sidebar)
      '/__open-carousel': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__open-carousel/, ''),
      },
    },
  },
})
