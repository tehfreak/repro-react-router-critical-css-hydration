import { lazy, Suspense } from 'react'

const MODULE_LOAD_MS = 250

const Child = lazy(async () => {
    await new Promise((resolve) => setTimeout(resolve, MODULE_LOAD_MS))
    return import('../child')
})

export default function Home() {
    return (
        <Suspense fallback={<p id="fallback">loading</p>}>
            <Child />
        </Suspense>
    )
}
