import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  base: process.env.VERCEL ? '/' : '/balat/',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
})
