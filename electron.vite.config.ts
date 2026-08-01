import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite 5 externalizes dependencies by default (build.externalizeDeps),
// so no plugin is needed for main or preload.
export default defineConfig({
  main: {},

  preload: {
    build: {
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS. Electron cannot load an
        // ESM preload when sandbox is true, and sandbox stays true. See CLAUDE.md.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },

  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
    },
  },
})
