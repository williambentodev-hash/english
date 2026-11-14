import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base relativa: funciona na raiz (Firebase Hosting) ou em https://<user>.github.io/<qualquer-repo>/ sem ajuste
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    // PWA: app instalável no celular; o service worker guarda os arquivos do app para abrir offline
    // e se atualiza sozinho quando há uma versão nova publicada.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'English Tutor',
        short_name: 'Tutor',
        description: 'Pratique inglês conversando com um tutor de IA.',
        lang: 'pt-BR',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#fafafa',
        background_color: '#fafafa',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
