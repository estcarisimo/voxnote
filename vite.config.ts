/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the user taps Reload in the update bar.
      registerType: 'prompt',
      // Registration happens in src/main.tsx, in production builds only.
      injectRegister: false,
      // The manifest is the hand-written public/manifest.webmanifest.
      manifest: false,
      workbox: {
        // The app shell only: built assets (the pdf.js worker is an .mjs),
        // icons and the manifest. User PDFs never touch the network and
        // there is no runtimeCaching, so provider API calls are never cached.
        globPatterns: ['**/*.{html,js,mjs,css,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        // The main bundle and the pdf.js worker are each above 1 MiB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
})
