# react-router: v8_viteEnvironmentApi breaks hydration of streamed Suspense boundaries in dev

## Status

Fixed upstream in 7.18.6 and 8.5.2, both released on 2026-11-18.
https://github.com/remix-run/react-router/issues/15363 was closed on 2026-11-11 by
https://github.com/remix-run/react-router/pull/15747 on the v7 branch and
https://github.com/remix-run/react-router/pull/15382 on main. Both wrap the reset in
`React.startTransition`, the fix suggested below.

Checked on 7.18.6 with React 18.3.1, both verdicts are WORKS. The repo stays pinned to 7.18.2 so
CI keeps showing the bug.

Observed against react-router 7.18.2 on React 18.

It needs React 18. React 19 dropped the per boundary hydration error this depends on, so the same
app on react-router 7.18.2 with react 19.2.8 is clean. react-router 8.3.0 requires react >= 19.2.7,
so it cannot be hit there either.

The react-router side is unchanged in 8.3.0, and the gate is wider. The getter is no longer behind
the flag, it is emitted whenever the vite command is `serve`:

https://github.com/remix-run/react-router/blob/246c1247a2c34f992ef50fec9040d1cbe1f4a5bb/packages/react-router-dev/vite/plugin.ts#L821-L823

```
        viteCommand === "serve"
          ? `
              export const unstable_getCriticalCss = ({ pathname }) => {
```

And the effect is the same code it was in 7.18.2:

https://github.com/remix-run/react-router/blob/246c1247a2c34f992ef50fec9040d1cbe1f4a5bb/packages/react-router/lib/dom-export/hydrated-router.tsx#L351-L355

```
  React.useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      setCriticalCss(undefined);
    }
  }, []);
```

So 8.3.0 still fires an unconditional non transition update at the root of every dev page, for
every app. React 19 absorbs it.

## What happens

Turning on the `v8_viteEnvironmentApi` future flag makes every dev page load log:

```
Uncaught Error: This Suspense boundary received an update before it finished hydrating.
This caused the boundary to switch to client rendering. The usual way to fix this is to
wrap the original update in startTransition.
    at updateDehydratedSuspenseComponent
```

Any Suspense boundary that the server streamed as a fallback throws away its server HTML and
re-renders on the client. Nothing else in the app changes, only the flag.

The chain is three steps.

The dev plugin generates a critical CSS getter into the virtual server build, but only under the
flag, and it returns a value unconditionally. Source at
https://github.com/remix-run/react-router/blob/69a653ee6ab1ac95b13c917ec56c5f3dc17ca9c1/packages/react-router-dev/vite/plugin.ts#L884-L892
as shipped:

```
node_modules/@react-router/dev/dist/vite.js:3270

  ${ctx.reactRouterConfig.future.v8_viteEnvironmentApi && viteCommand === "serve" ? `
    export const unstable_getCriticalCss = ({ pathname }) => {
      return {
        rel: "stylesheet",
        href: "${ctx.publicPath}@react-router/critical.css?pathname=" + pathname,
      };
    }
  ` : ""}
```

The server picks it up ahead of the dev hook it replaces. Source at
https://github.com/remix-run/react-router/blob/69a653ee6ab1ac95b13c917ec56c5f3dc17ca9c1/packages/react-router/lib/server-runtime/server.ts#L279-L286
as shipped:

```
node_modules/react-router/dist/development/chunk-ZA36QIGN.mjs:1283

  if (build.unstable_getCriticalCss) {
    criticalCss = await build.unstable_getCriticalCss({ pathname });
  } else if (mode === "development" && getDevServerHooks()?.getCriticalCss) {
    criticalCss = await getDevServerHooks()?.getCriticalCss?.(pathname);
  }
```

`HydratedRouter` then clears it on mount with a plain state update. Source at
https://github.com/remix-run/react-router/blob/69a653ee6ab1ac95b13c917ec56c5f3dc17ca9c1/packages/react-router/lib/dom-export/hydrated-router.tsx#L356-L360
as shipped:

```
node_modules/react-router/dist/development/dom-export.mjs:198

  let [criticalCss, setCriticalCss] = React2.useState(
    process.env.NODE_ENV === "development" ? ssrInfo?.context.criticalCss : void 0
  );
  React2.useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      setCriticalCss(void 0);
    }
  }, []);
```

That update sits at the top of the tree and lands in the passive effects of the hydration commit,
while boundaries below are still dehydrated waiting on their `React.lazy` module. React sees
`didReceiveUpdate` on a dehydrated boundary and gives up on it.

The replaced dev hook is why nobody hits this without the flag. It ends with:

```
node_modules/@react-router/dev/dist/vite.js:1535

  return Object.entries(styles).map(...).flat().join("\n") || void 0;
```

So an app whose stylesheets come in through `links()` as `?url` imports gets `undefined`, and
`setCriticalCss(void 0)` is a no-op that React bails out of. Under the flag the value is always an
object, so the update always fires. In this repro the endpoint behind that object serves 0 bytes,
which the script prints.

## Run it

```
npm ci
npx playwright install chromium
npm run repro
```

The script boots `react-router dev` twice on the same app, once per arm, drives it with a real
browser and collects page errors:

```
flag-on  v8_viteEnvironmentApi : true
flag-on  ssr critical css link : <link data-react-router-critical-css="" rel="stylesheet" href="/@react-router/critical.css?pathname=/"/>
flag-on  critical css bytes    : 0
flag-on  lazy child rendered   : true
flag-on  browser errors        : 1
flag-on  error                 : This Suspense boundary received an update before it finished hydrating. ...

flag-off  v8_viteEnvironmentApi : false
flag-off  ssr critical css link : absent
flag-off  critical css bytes    : n/a
flag-off  lazy child rendered   : true
flag-off  browser errors        : 0

VERDICT flag-on: BROKEN
VERDICT flag-off: WORKS
```

Swap in React 19 to see the error go away with react-router untouched:

```
npm install --no-save react@19.2.8 react-dom@19.2.8
rm -rf node_modules/.vite
npm run repro
```

Both verdicts turn WORKS. The critical CSS link and the state update are still there, React just
stops treating the update as a reason to drop the boundary.

`app/routes/home.tsx` puts a 250ms delay in front of the lazy import. That is there to make the
boundary reliably stream as a fallback and still be dehydrated when the effect runs. It is not the
cause. Both arms run the same delay and the same code, and only the arm with the flag reports an
error. A real app gets the same window for free from the dev module waterfall, which is how this
was found: a Suspense boundary around `lazy(() => import('./App@desktop'))` in an app with a few
hundred modules under it.

## Why it's a bug

The upgrade guide describes the flag as enabling the Vite Environment API and says "Most users
won't need to make any changes", with the listed exceptions all being custom Vite config. Switching
it on should not change how the client hydrates.

The reset itself makes sense, and the repro confirms it does its job: it clears the dev-only
stylesheet after hydration so there is no flash of unstyled content and no duplicate styles. The
problem is when the update lands, not that it happens.

The update is unconditional. It fires whether or not there is any critical CSS to clear, and here
there is none, so the re-render clears nothing. The error message React prints names the fix and
the code it points at is react-router's own.

It only shows up in dev, so it does not break production, but it does mean every streamed boundary
in dev renders twice and discards its server HTML. A real hydration mismatch in that boundary would
be hidden behind this error.

On why the 7.x combination is worth fixing rather than waiting out: react-router 7 declares
`react: ">=18"`, and the upgrade guide has you adopt the flag while still on v7, since `vite@7+`
requires it, with `react@19.2.7+` only becoming a requirement at the v8 step. So the documented
path from v7 to v8 runs through exactly this state, flag on and React still 18.

## Suggested fix

Wrap the reset in `startTransition`, which is what the React error asks for.

On the 7.18.2 tag:
https://github.com/remix-run/react-router/blob/69a653ee6ab1ac95b13c917ec56c5f3dc17ca9c1/packages/react-router/lib/dom-export/hydrated-router.tsx#L356-L360

On main:
https://github.com/remix-run/react-router/blob/246c1247a2c34f992ef50fec9040d1cbe1f4a5bb/packages/react-router/lib/dom-export/hydrated-router.tsx#L351-L355

```
  React.useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      React.startTransition(() => setCriticalCss(undefined));
    }
  }, []);
```

The second effect below it, the one keyed on `[criticalCss]` that removes leftover critical CSS
elements, is unaffected. It still sees `criticalCss === undefined` and still runs.

This was verified against the shipped bundle, not a source build. Applying the same change to the
installed `dom-export.mjs` and `dom-export.js`, where the local name is `React2` and the value is
`void 0`, and clearing `node_modules/.vite` turns the first verdict from BROKEN to WORKS, with the
second unchanged. The critical CSS link is still removed from the DOM, so the flash of unstyled
content the reset exists to prevent stays prevented.

Skipping the getter when there is no critical CSS would also work, but the plugin decides that at
codegen time and the emptiness is per request, so the transition is the smaller change.

## CI

`.github/workflows/reproduce.yml` runs the script on ubuntu and asserts the verdict lines. The
`reproduce` job pins the bug on React 18 and is green while it still reproduces. The `react19` job
installs react 19.2.8 over the same tree and pins the claim that React 19 is clean.
