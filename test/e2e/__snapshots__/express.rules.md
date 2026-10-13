<!-- breakcheck:comment -->
## ⚠️ 5 breaking changes may affect this repo

_breakcheck reads the release notes for each dependency bump in this PR and searches this repo for code the breaking changes touch._

| Package | Version range | Breaking changes found | Affect you |
| --- | --- | --- | --- |
| [`express`](https://www.npmjs.com/package/express) | 4.21.2 → 5.0.1 (major) | 33 | 5 possibly |

### What to look at

<details>
<summary>🟡 <b>express</b>: Removed: `app.del` - use `app.delete` (1 location)</summary>

- 🟡 [src/server.js:20](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L20) _(possibly)_: Uses `app.del`

Source: https://github.com/expressjs/express/blob/v5.0.1/History.md

</details>

<details>
<summary>🟡 <b>express</b>: Removed: `res.json(obj, status)` signature - use `res.json(status, obj)` (3 locations)</summary>

- 🟡 [src/server.js:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L7) _(possibly)_: Uses `res.json`
- 🟡 [src/server.js:12](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L12) _(possibly)_: Uses `res.json`
- 🟡 [src/server.js:17](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L17) _(possibly)_: Uses `res.json`

Source: https://github.com/expressjs/express/blob/v5.0.1/History.md

</details>

<details>
<summary>🟡 <b>express</b>: Removed: `res.sendfile` - use `res.sendFile` instead (1 location)</summary>

- 🟡 [src/server.js:25](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L25) _(possibly)_: Uses `res.sendfile`

Source: https://github.com/expressjs/express/blob/v5.0.1/History.md

</details>

<details>
<summary>🟡 <b>express</b>: Removed: `req.param()` -- use `req.params`, `req.body`, or `req.query` instead (1 location)</summary>

- 🟡 [src/server.js:16](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L16) _(possibly)_: Uses `req.param`

Source: https://github.com/expressjs/express/blob/v5.0.1/History.md

</details>

<details>
<summary>🟡 <b>express</b>: Removed: `res.json(status, obj)` signature - use `res.status(status).json(obj)` (3 locations)</summary>

- 🟡 [src/server.js:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L7) _(possibly)_: Uses `res.json`
- 🟡 [src/server.js:12](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L12) _(possibly)_: Uses `res.json`
- 🟡 [src/server.js:17](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/src/server.js#L17) _(possibly)_: Uses `res.json`

Source: https://github.com/expressjs/express/blob/v5.0.1/History.md

</details>

<details>
<summary>All 33 breaking changes checked</summary>

**express** (rule-based, low confidence)

- Removed: `app.del` - use `app.delete` — _possibly affects this repo_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `req.acceptsCharset` - use `req.acceptsCharsets` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `req.acceptsEncoding` - use `req.acceptsEncodings` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `req.acceptsLanguage` - use `req.acceptsLanguages` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.json(obj, status)` signature - use `res.json(status, obj)` — _possibly affects this repo_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.jsonp(obj, status)` signature - use `res.jsonp(status, obj)` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.send(body, status)` signature - use `res.send(status, body)` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.send(status)` signature - use `res.sendStatus(status)` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.sendfile` - use `res.sendFile` instead — _possibly affects this repo_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `express.query` middleware — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: `req.host` now returns host (`hostname:port`) - use `req.hostname` for only hostname — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: `req.query` is now a getter instead of a plain property — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `app.param(fn)` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `req.param()` -- use `req.params`, `req.body`, or `req.query` instead — _possibly affects this repo_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: `res.render` callback is always async, even for sync view engines — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: The leading `:` character in `name` for `app.param(name, fn)` is no longer removed — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: Use `router` module for routing — _nothing to search for automatically; review manually_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: Use `path-is-absolute` module for absolute path detection — _nothing to search for automatically; review manually_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.json(status, obj)` signature - use `res.status(status).json(obj)` — _possibly affects this repo_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.jsonp(status, obj)` signature - use `res.status(status).jsonp(obj)` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.vary()` (no arguments) -- provide a field name as an argument — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: Remove Express 3.x middleware error stubs — _nothing to search for automatically; review manually_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.redirect(url, status)` signature - use `res.redirect(status, url)` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.send(status, body)` signature - use `res.status(status).send(body)` — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `path-to-regexp` dependency — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: Default "query parser" setting to `'simple'` — _nothing to search for automatically; review manually_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: Requires Node.js 4+ — _nothing to search for automatically; review manually_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: Use `mime-types` for file to content type mapping — _nothing to search for automatically; review manually_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `path-is-absolute` dependency - use `path.isAbsolute` instead — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.status()` accepts only integers, and input must be greater than 99 and less than 1000 — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: deps: send@1.0.0 — _nothing to search for automatically; review manually_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Removed: `res.redirect('back')` and `res.location('back')` is no longer a supported magic string, explicitly use `req.get('Referrer') \|\| '/'`. — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))
- Changed: `res.clearCookie` will ignore user provided `maxAge` and `expires` options — _no usages found_ ([source](https://github.com/expressjs/express/blob/v5.0.1/History.md))

</details>

**Mode:** Rule-based (no AI available), lower confidence: provider is set to "none"

---
<sub>**Checked:** direct dependency bumps (express) using CHANGELOG files; searched source files that import each package, config files and package.json scripts. **Not checked:** transitive dependencies, runtime behaviour without a code-level signal, and usages that can't be followed statically. This is advisory and does not mean the upgrade is safe. Generated by [breakcheck](https://github.com/unknowndevice077/breakcheck).</sub>