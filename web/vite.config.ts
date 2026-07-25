import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'ai',
      'zod',
      'ollama-ai-provider-v2',
      '@ai-sdk/openai',
      '@ai-sdk/anthropic',
    ],
  },
  server: {
    proxy: {
      // Same-origin proxy for Open Carrusel API (avoids CORS in the library sidebar)
      '/__open-carousel': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__open-carousel/, ''),
      },
      // Same-origin proxy for Liquid Copy API (avoids CORS / Failed to fetch)
      '/__liquid-api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__liquid-api/, ''),
      },
    },
  },
})
