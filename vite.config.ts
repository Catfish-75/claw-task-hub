import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiBase = process.env.VITE_CLAW_TASK_HUB_API_BASE ?? env.VITE_CLAW_TASK_HUB_API_BASE ?? 'http://127.0.0.1:4781/api'
  return {
    define: { 'import.meta.env.VITE_CLAW_TASK_HUB_API_BASE': JSON.stringify(apiBase) },
    plugins: [react(), {
      name: 'cth-runtime-manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'cth-runtime.json', source: JSON.stringify({ apiBase }) })
      },
    }],
  }
})
