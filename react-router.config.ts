import type { Config } from '@react-router/dev/config'

export default {
    future: {
        v8_viteEnvironmentApi: process.env.REPRO_VITE_ENVIRONMENT_API !== 'false',
    },
} satisfies Config
