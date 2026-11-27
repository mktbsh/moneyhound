import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'
import { viteSingleFile } from 'vite-plugin-singlefile'

// One self-contained index.html: Apps Script HtmlService serves a single file.
export default defineConfig({
  plugins: [solid(), viteSingleFile()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
})
