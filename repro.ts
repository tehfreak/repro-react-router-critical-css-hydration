import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const HYDRATION_ERROR = 'This Suspense boundary received an update before it finished hydrating'
const CRITICAL_CSS_ATTRIBUTE = 'data-react-router-critical-css'

type Arm = {
    label: string
    viteEnvironmentApi: boolean
    port: number
}

type Result = {
    ssrLink: string | null
    cssBytes: number | null
    errors: string[]
    childRendered: boolean
}

const startServer = async (arm: Arm): Promise<ChildProcess> => {
    const child = spawn(
        process.execPath,
        ['node_modules/@react-router/dev/bin.js', 'dev'],
        {
            env: {
                ...process.env,
                REPRO_VITE_ENVIRONMENT_API: String(arm.viteEnvironmentApi),
                REPRO_PORT: String(arm.port),
                NODE_ENV: 'development',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    )

    child.stdout?.resume()
    child.stderr?.resume()

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`dev server exited early with code ${child.exitCode}`)
        }
        try {
            const response = await fetch(`http://localhost:${arm.port}/`)
            if (response.ok) {
                await response.text()
                return child
            }
        } catch {}
        await delay(250)
    }

    throw new Error('dev server did not become ready within 60s')
}

const stopServer = (child: ChildProcess) => {
    if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        return
    }
    child.kill('SIGTERM')
}

const run = async (arm: Arm): Promise<Result> => {
    const child = await startServer(arm)

    try {
        const html = await (await fetch(`http://localhost:${arm.port}/`)).text()
        const ssrLink = html.match(new RegExp(`<link[^>]*${CRITICAL_CSS_ATTRIBUTE}[^>]*>`))?.[0] ?? null

        let cssBytes: number | null = null
        if (ssrLink) {
            const href = ssrLink.match(/href="([^"]+)"/)?.[1]
            if (href) {
                const css = await (await fetch(`http://localhost:${arm.port}${href}`)).text()
                cssBytes = Buffer.byteLength(css)
            }
        }

        const browser = await chromium.launch()
        const page = await browser.newPage()
        const errors: string[] = []

        page.on('pageerror', (error) => errors.push(error.message.split('\n')[0]!))
        page.on('console', (message) => {
            if (message.type() === 'error') {
                errors.push(message.text().split('\n')[0]!)
            }
        })

        await page.goto(`http://localhost:${arm.port}/`, { waitUntil: 'load' })
        await page.waitForSelector('#child', { timeout: 15_000 })
        await delay(1_000)

        const childRendered = (await page.locator('#child').count()) === 1
        await browser.close()

        return { ssrLink, cssBytes, errors, childRendered }
    } finally {
        stopServer(child)
        await delay(1_000)
    }
}

const arms: Arm[] = [
    { label: 'flag-on', viteEnvironmentApi: true, port: 5299 },
    { label: 'flag-off', viteEnvironmentApi: false, port: 5300 },
]

const verdicts: string[] = []

for (const arm of arms) {
    const result = await run(arm)
    const hydrationErrors = result.errors.filter((error) => error.includes(HYDRATION_ERROR))

    console.log(`${arm.label}  v8_viteEnvironmentApi : ${arm.viteEnvironmentApi}`)
    console.log(`${arm.label}  ssr critical css link : ${result.ssrLink ?? 'absent'}`)
    console.log(`${arm.label}  critical css bytes    : ${result.cssBytes ?? 'n/a'}`)
    console.log(`${arm.label}  lazy child rendered   : ${result.childRendered}`)
    console.log(`${arm.label}  browser errors        : ${result.errors.length}`)
    for (const error of result.errors) {
        console.log(`${arm.label}  error                 : ${error}`)
    }
    console.log('')

    verdicts.push(`VERDICT ${arm.label}: ${hydrationErrors.length > 0 ? 'BROKEN' : 'WORKS'}`)
}

for (const verdict of verdicts) {
    console.log(verdict)
}
