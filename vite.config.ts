import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        port: Number(process.env.REPRO_PORT ?? 5299),
        strictPort: true,
    },
    plugins: [reactRouter()],
})
