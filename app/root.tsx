import { Links, Meta, Outlet, Scripts } from 'react-router'
import styles from './root.css?url'

export const links = () => [{ rel: 'stylesheet', href: styles }]

export default function Root() {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <Meta />
                <Links />
            </head>
            <body>
                <Outlet />
                <Scripts />
            </body>
        </html>
    )
}
