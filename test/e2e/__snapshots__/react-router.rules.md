<!-- breakcheck:comment -->
## ⚠️ 5 breaking changes may affect this repo

_breakcheck reads the release notes for each dependency bump in this PR and searches this repo for code the breaking changes touch._

| Package | Version range | Breaking changes found | Affect you |
| --- | --- | --- | --- |
| [`react-router`](https://www.npmjs.com/package/react-router) | 6.28.0 → 7.1.0 (major) | 36 | 5 possibly |

### What to look at

<details>
<summary>🟡 <b>react-router</b>: Remove the original <code>defer</code> implementation in favor of using raw promises via single fetch and <code>turbo-stream</code>. This removes these exports from React Router (2 locations)</summary>

- 🟡 [app/routes/account.tsx:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/account.tsx#L1) _(possibly)_: Uses `defer`
- 🟡 [app/routes/account.tsx:9](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/account.tsx#L9) _(possibly)_: Uses `defer`

Source: https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0

</details>

<details>
<summary>🟡 <b>react-router</b>: Collapse <code>@remix-run/router</code> into <code>react-router</code> (1 location)</summary>

- 🟡 [app/root.tsx:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/root.tsx#L1) _(possibly)_: Uses `react-router-dom`

Source: https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0

</details>

<details>
<summary>🟡 <b>react-router</b>: Remove <code>future.v7_startTransition</code> flag (2 locations)</summary>

- 🟡 [app/root.tsx:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/root.tsx#L7) _(possibly)_: Uses `v7_startTransition`
- 🟡 [app/routes/home.tsx:3](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/home.tsx#L3) _(possibly)_: Uses `v7_startTransition`

Source: https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0

</details>

<details>
<summary>🟡 <b>react-router</b>: Upgrade to v7 (2 locations)</summary>

- 🟡 [app/root.tsx:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/root.tsx#L1) _(possibly)_: Uses `react-router-dom`
- 🟡 [package.json:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/package.json#L7) _(possibly)_: Uses `react-router-dom`

**How to migrate**

1. 👉 **Replace react-router-dom with react-router**
2. Now you should update your imports to use `react-router`
3. Instead of manually updating imports, you can use this command. Make sure your git working tree is clean though so you can revert if it doesn't work as expected.

Source: https://github.com/remix-run/react-router/blob/react-router@7.1.0/docs/upgrading/v6.md

</details>

<details>
<summary>🟡 <b>react-router</b>: Remove the deprecated <code>json</code> utility (2 locations)</summary>

- 🟡 [app/routes/account.tsx:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/account.tsx#L1) _(possibly)_: Uses `json`
- 🟡 [app/routes/account.tsx:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/account.tsx#L7) _(possibly)_: Uses `json`

**How to migrate**

1. You can use `Response.json` if you still need to construct JSON responses in your app

Source: https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0

</details>

<details>
<summary>All 36 breaking changes checked</summary>

**react-router** (rule-based, low confidence)

- Remove the original `defer` implementation in favor of using raw promises via single fetch and `turbo-stream`. This removes these exports from React Router — _possibly affects this repo_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Collapse `@remix-run/router` into `react-router` — _possibly affects this repo_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove single_fetch future flag. — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Drop support for Node 16, React Router SSR now requires Node 18 or higher — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `future.v7_startTransition` flag — _possibly affects this repo_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Expose the underlying router promises from the following APIs for compsition in React 19 APIs — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `future.v7_normalizeFormMethod` future flag — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- For Remix consumers migrating to React Router, the `crypto` global from the Web Crypto API is now required when using cookie and session APIs. This means that the following APIs are provided from `react-router` rather than platform-specific — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Imports/Exports cleanup — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- update minimum node version to 18 — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `future.v7_prependBasename` from the ionternalized `@remix-run/router` package — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Migrate Remix type generics to React Router — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `future.v7_throwAbortReason` from internalized `@remix-run/router` package — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Add `exports` field to all packages — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- node package no longer re-exports from react-router — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- renamed RemixContext to FrameworkContext — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- updates the minimum React version to 18 — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- PrefetchPageDescriptor replaced by PageLinkDescriptor — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Consolidate types previously duplicated across `@remix-run/router`, `@remix-run/server-runtime`, and `@remix-run/react` now that they all live in `react-router` — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove the `future.v7_partialHydration` flag — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `v7_relativeSplatPath` future flag — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Drop support for Node 18, update minimum Node vestion to 20 — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove remaining future flags — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- rename createRemixStub to createRoutesStub — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `@remix-run/router` deprecated `detectErrorBoundary` option in favor of `mapRouteProperties` — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Add `react-router/dom` subpath export to properly enable `react-dom` as an optional `peerDependency` — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `future.v7_fetcherPersist` flag — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Update `cookie` dependency to `^1.0.1` - please see the release notes for any breaking changes — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Deprecations — _no usages found_ ([source](https://github.com/remix-run/react-router/blob/react-router@7.1.0/docs/upgrading/v6.md))
- Upgrade to v7 — _possibly affects this repo_ ([source](https://github.com/remix-run/react-router/blob/react-router@7.1.0/docs/upgrading/v6.md))
- Remove duplicate `RouterProvider` impliementations — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove unstable upload handler. — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove unneeded dependency on `@web3-storage/multipart-parser` — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove the deprecated `json` utility — _possibly affects this repo_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove unneeded dependency on source-map — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- Remove `<Link prefetch>` warning which suffers from false positives in a lazy route discovery world — _no usages found_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.1.0))

</details>

**Mode:** Rule-based (no AI available), lower confidence: provider is set to "none"

---
<sub>**Checked:** direct dependency bumps (react-router) using GitHub Releases, migration guides; searched source files that import each package, config files and package.json scripts. **Not checked:** transitive dependencies, runtime behaviour without a code-level signal, and usages that can't be followed statically. This is advisory and does not mean the upgrade is safe. Generated by [breakcheck](https://github.com/unknowndevice077/breakcheck).</sub>