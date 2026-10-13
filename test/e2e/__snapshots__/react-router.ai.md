<!-- breakcheck:comment -->
## ⚠️ 3 breaking changes affect this repo

_breakcheck reads the release notes for each dependency bump in this PR and searches this repo for code the breaking changes touch._

| Package | Version range | Breaking changes found | Affect you |
| --- | --- | --- | --- |
| [`react-router`](https://www.npmjs.com/package/react-router) | 6.28.0 → 7.1.0 (major) | 4 | **3** |

### What to look at

<details>
<summary>⚠️ <b>react-router</b>: The <code>json</code> and <code>defer</code> utilities were removed; return plain objects, or <code>data()</code> when you need a status or headers. (3 locations)</summary>

- 🔴 [app/routes/account.tsx:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/account.tsx#L1): Imports `defer` and `json`, which no longer exist in v7.

  Suggested fix for `app/routes/account.tsx:1`:

  ```diff
  -import { defer, json, useLoaderData } from 'react-router';
  +import { data, useLoaderData } from 'react-router';
  ```
- 🔴 [app/routes/account.tsx:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/account.tsx#L7): `json(...)` with a status must become `data(...)`.

  Suggested fix for `app/routes/account.tsx:7`:

  ```diff
  -    return json({ error: 'not signed in' }, { status: 401 });
  +    return data({ error: 'not signed in' }, { status: 401 });
  ```
- 🔴 [app/routes/account.tsx:9](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/routes/account.tsx#L9): `defer(...)` was removed; return the object directly and the promise is streamed.

  Suggested fix for `app/routes/account.tsx:9`:

  ```diff
  -  return defer({ user, orders: getOrders(user.id) });
  +  return { user, orders: getOrders(user.id) };
  ```

**How to migrate**

1. Replace `json(value)` with `value` (or `data(value, init)` when you set status/headers).
2. Replace `defer({...})` with a plain object; promises are streamed automatically.

Source: https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0

</details>

<details>
<summary>⚠️ <b>react-router</b>: <code>react-router-dom</code> was collapsed into <code>react-router</code>; import from <code>react-router</code> (and <code>react-router/dom</code> for <code>RouterProvider</code>). (1 location)</summary>

- 🔴 [app/root.tsx:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/root.tsx#L1): Imports from `react-router-dom`, which is no longer the v7 entry point.

  Suggested fix for `app/root.tsx:1`:

  ```diff
  -import { createBrowserRouter, RouterProvider } from 'react-router-dom';
  +import { createBrowserRouter } from 'react-router';
  +import { RouterProvider } from 'react-router/dom';
  ```

**How to migrate**

1. Uninstall `react-router-dom` and install `react-router@7`.
2. Change imports from `react-router-dom` to `react-router`; import `RouterProvider` from `react-router/dom` in DOM apps.

Source: https://github.com/remix-run/react-router/blob/react-router@7.1.0/docs/upgrading/v6.md

</details>

<details>
<summary>⚠️ <b>react-router</b>: All v6 <code>future.v7_*</code> flags were removed; their behaviour is now the default. (1 location)</summary>

- 🔴 [app/root.tsx:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/app/root.tsx#L7): Passes `future={{ v7_startTransition: true }}`; the flag no longer exists and the prop no longer type-checks.

  Suggested fix for `app/root.tsx:7`:

  ```diff
  -  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
  +  return <RouterProvider router={router} />;
  ```
- 1 other match checked and ruled out by the model

**How to migrate**

1. Adopt each flag on v6 first, then remove the `future` prop/option when upgrading.

Source: https://github.com/remix-run/react-router/blob/react-router@7.1.0/docs/upgrading/v6.md

</details>

<details>
<summary>All 4 breaking changes checked</summary>

**react-router** (AI-extracted)

- The `json` and `defer` utilities were removed; return plain objects, or `data()` when you need a status or headers. — _affects this repo_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))
- `react-router-dom` was collapsed into `react-router`; import from `react-router` (and `react-router/dom` for `RouterProvider`). — _affects this repo_ ([source](https://github.com/remix-run/react-router/blob/react-router@7.1.0/docs/upgrading/v6.md))
- All v6 `future.v7_*` flags were removed; their behaviour is now the default. — _affects this repo_ ([source](https://github.com/remix-run/react-router/blob/react-router@7.1.0/docs/upgrading/v6.md))
- React Router 7 requires Node 20 or later for SSR. — _nothing to search for automatically; review manually_ ([source](https://github.com/remix-run/react-router/releases/tag/react-router%407.0.0))

</details>

**Mode:** AI-assisted via `anthropic/claude-opus-5-5`

---
<sub>**Checked:** direct dependency bumps (react-router) using GitHub Releases, migration guides; searched source and component files that use each package, config files and package.json scripts. **Not checked:** transitive dependencies, runtime behaviour without a code-level signal, and usages that can't be followed statically. This is advisory and does not mean the upgrade is safe. Generated by [breakcheck](https://github.com/unknowndevice077/breakcheck).</sub>