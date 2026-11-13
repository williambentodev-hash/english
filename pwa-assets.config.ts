import { defineConfig } from '@vite-pwa/assets-generator/config'

// Gera os PNGs do app a partir de public/icon.svg: `npm run icons`.
// O SVG já tem fundo de ponta a ponta, então nenhum tamanho recebe margem.
export default defineConfig({
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']], padding: 0 },
    maskable: { sizes: [512], padding: 0 },
    apple: { sizes: [180], padding: 0 },
  },
  images: ['public/icon.svg'],
})
