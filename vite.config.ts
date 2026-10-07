import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MediaPipe is only imported lazily; pre-bundle it so the first photo import in dev does not
  // trigger a dependency re-optimization and full page reload.
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
})
