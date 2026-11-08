import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base relativa: funciona em https://<user>.github.io/<qualquer-repo>/ sem ajuste
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
