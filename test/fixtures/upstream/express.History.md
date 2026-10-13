5.0.1 / 2024-10-08
==========

* Update `cookie` semver lock to address [CVE-2024-47764](https://nvd.nist.gov/vuln/detail/CVE-2024-47764)

5.0.0 / 2024-09-10
=========================
* remove:
  - `path-is-absolute` dependency - use `path.isAbsolute` instead
* breaking:
  * `res.status()` accepts only integers, and input must be greater than 99 and less than 1000
    * will throw a `RangeError: Invalid status code: ${code}. Status code must be greater than 99 and less than 1000.` for inputs outside this range
    * will throw a `TypeError: Invalid status code: ${code}. Status code must be an integer.` for non integer inputs
  * deps: send@1.0.0
  * `res.redirect('back')` and `res.location('back')` is no longer a supported magic string, explicitly use `req.get('Referrer') || '/'`.
* change:
  - `res.clearCookie` will ignore user provided `maxAge` and `expires` options
* deps: cookie-signature@^1.2.1
* deps: debug@4.3.6
* deps: merge-descriptors@^2.0.0
* deps: serve-static@^2.1.0
* deps: qs@6.13.0
* deps: accepts@^2.0.0
* deps: mime-types@^3.0.0
  - `application/javascript` => `text/javascript`
* deps: type-is@^2.0.0
* deps: content-disposition@^1.0.0
* deps: finalhandler@^2.0.0
* deps: fresh@^2.0.0
* deps: body-parser@^2.0.1
* deps: send@^1.1.0

5.0.0-beta.3 / 2024-03-25
=========================

This incorporates all changes after 4.19.1 up to 4.19.2.

5.0.0-beta.2 / 2024-03-20
=========================

This incorporates all changes after 4.17.2 up to 4.19.1.

5.0.0-beta.1 / 2022-02-14
=========================

This is the first Express 5.0 beta release, based off 4.17.2 and includes
changes from 5.0.0-alpha.8.

  * change:
    - Default "query parser" setting to `'simple'`
    - Requires Node.js 4+
    - Use `mime-types` for file to content type mapping
  * deps: array-flatten@3.0.0
  * deps: body-parser@2.0.0-beta.1
    - `req.body` is no longer always initialized to `{}`
    - `urlencoded` parser now defaults `extended` to `false`
    - Use `on-finished` to determine when body read
  * deps: router@2.0.0-beta.1
    - Add new `?`, `*`, and `+` parameter modifiers
    - Internalize private `router.process_params` method
    - Matching group expressions are only RegExp syntax
    - Named matching groups no longer available by position in `req.params`
    - Regular expressions can only be used in a matching group
    - Remove `debug` dependency
    - Special `*` path segment behavior removed
    - deps: array-flatten@3.0.0
    - deps: parseurl@~1.3.3
    - deps: path-to-regexp@3.2.0
    - deps: setprototypeof@1.2.0
  * deps: send@1.0.0-beta.1
    - Change `dotfiles` option default to `'ignore'`
    - Remove `hidden` option; use `dotfiles` option instead
    - Use `mime-types` for file to content type mapping
    - deps: debug@3.1.0
  * deps: serve-static@2.0.0-beta.1
    - Change `dotfiles` option default to `'ignore'`
    - Remove `hidden` option; use `dotfiles` option instead
    - Use `mime-types` for file to content type mapping
    - deps: send@1.0.0-beta.1

5.0.0-alpha.8 / 2020-03-25
==========================

This is the eighth Express 5.0 alpha release, based off 4.17.1 and includes
changes from 5.0.0-alpha.7.

5.0.0-alpha.7 / 2018-10-26
==========================

This is the seventh Express 5.0 alpha release, based off 4.16.4 and includes
changes from 5.0.0-alpha.6.

The major change with this alpha is the basic support for returned, rejected
Promises in the router.

  * remove:
    - `path-to-regexp` dependency
  * deps: debug@3.1.0
    - Add `DEBUG_HIDE_DATE` environment variable
    - Change timer to per-namespace instead of global
    - Change non-TTY date format
    - Remove `DEBUG_FD` environment variable support
    - Support 256 namespace colors
  * deps: router@2.0.0-alpha.1
    - Add basic support for returned, rejected Promises
    - Fix JSDoc for `Router` constructor
    - deps: debug@3.1.0
    - deps: parseurl@~1.3.2
    - deps: setprototypeof@1.1.0
    - deps: utils-merge@1.0.1

5.0.0-alpha.6 / 2017-09-24
==========================

This is the sixth Express 5.0 alpha release, based off 4.15.5 and includes
changes from 5.0.0-alpha.5.

  * remove:
    - `res.redirect(url, status)` signature - use `res.redirect(status, url)`
    - `res.send(status, body)` signature - use `res.status(status).send(body)`
  * deps: router@~1.3.1
    - deps: debug@2.6.8

5.0.0-alpha.5 / 2017-03-06
==========================

This is the fifth Express 5.0 alpha release, based off 4.15.2 and includes
changes from 5.0.0-alpha.4.

5.0.0-alpha.4 / 2017-03-01
==========================

This is the fourth Express 5.0 alpha release, based off 4.15.0 and includes
changes from 5.0.0-alpha.3.

  * remove:
    - Remove Express 3.x middleware error stubs
  * deps: router@~1.3.0
    - Add `next("router")` to exit from router
    - Fix case where `router.use` skipped requests routes did not
    - Skip routing when `req.url` is not set
    - Use `%o` in path debug to tell types apart
    - deps: debug@2.6.1
    - deps: setprototypeof@1.0.3
    - perf: add fast match path for `*` route

5.0.0-alpha.3 / 2017-01-28
==========================

This is the third Express 5.0 alpha release, based off 4.14.1 and includes
changes from 5.0.0-alpha.2.

  * remove:
    - `res.json(status, obj)` signature - use `res.status(status).json(obj)`
    - `res.jsonp(status, obj)` signature - use `res.status(status).jsonp(obj)`
    - `res.vary()` (no arguments) -- provide a field name as an argument
  * deps: array-flatten@2.1.1
  * deps: path-is-absolute@1.0.1
  * deps: router@~1.1.5
    - deps: array-flatten@2.0.1
    - deps: methods@~1.1.2
    - deps: parseurl@~1.3.1
    - deps: setprototypeof@1.0.2

5.0.0-alpha.2 / 2015-07-06
==========================

This is the second Express 5.0 alpha release, based off 4.13.1 and includes
changes from 5.0.0-alpha.1.

  * remove:
    - `app.param(fn)`
    - `req.param()` -- use `req.params`, `req.body`, or `req.query` instead
  * change:
    - `res.render` callback is always async, even for sync view engines
    - The leading `:` character in `name` for `app.param(name, fn)` is no longer removed
    - Use `router` module for routing
    - Use `path-is-absolute` module for absolute path detection

5.0.0-alpha.1 / 2014-11-06
==========================

This is the first Express 5.0 alpha release, based off 4.10.1.

  * remove:
    - `app.del` - use `app.delete`
    - `req.acceptsCharset` - use `req.acceptsCharsets`
    - `req.acceptsEncoding` - use `req.acceptsEncodings`
    - `req.acceptsLanguage` - use `req.acceptsLanguages`
    - `res.json(obj, status)` signature - use `res.json(status, obj)`
    - `res.jsonp(obj, status)` signature - use `res.jsonp(status, obj)`
    - `res.send(body, status)` signature - use `res.send(status, body)`
    - `res.send(status)` signature - use `res.sendStatus(status)`
    - `res.sendfile` - use `res.sendFile` instead
    - `express.query` middleware
  * change:
    - `req.host` now returns host (`hostname:port`) - use `req.hostname` for only hostname
    - `req.query` is now a getter instead of a plain property
  * add:
    - `app.router` is a reference to the base router

4.20.0 / 2024-09-10
==========
  * deps: serve-static@0.16.0
    * Remove link renderization in html while redirecting
  * deps: send@0.19.0
    * Remove link renderization in html while redirecting
  * deps: body-parser@0.6.0
    * add `depth` option to customize the depth level in the parser
    * IMPORTANT: The default `depth` level for parsing URL-encoded data is now `32` (previously was `Infinity`)
  * Remove link renderization in html while using `res.redirect`
  * deps: path-to-regexp@0.1.10
    - Adds support for named matching groups in the routes using a regex
    - Adds backtracking protection to parameters without regexes defined
  * deps: encodeurl@~2.0.0
    - Removes encoding of `\`, `|`, and `^` to align better with URL spec
  * Deprecate passing `options.maxAge` and `options.expires` to `res.clearCookie`
    - Will be ignored in v5, clearCookie will set a cookie with an expires in the past to instruct clients to delete the cookie

4.19.2 / 2024-03-25
==========

  * Improved fix for open redirect allow list bypass

4.19.1 / 2024-03-20
==========

  * Allow passing non-strings to res.location with new encoding handling checks

4.19.0 / 2024-03-20
==========

  * Prevent open redirect allow list bypass due to encodeurl
  * deps: cookie@0.6.0

4.18.3 / 2024-02-29
==========

  * Fix routing requests without method
  * deps: body-parser@1.20.2
    - Fix strict json error message on Node.js 19+
    - deps: content-type@~1.0.5
    - deps: raw-body@2.5.2
  * deps: cookie@0.6.0
    - Add `partitioned` option

4.18.2 / 2022-10-08
===================

  * Fix regression routing a large stack in a single route
  * deps: body-parser@1.20.1
    - deps: qs@6.11.0
    - perf: remove unnecessary object clone
  * deps: qs@6.11.0

4.18.1 / 2022-04-29
===================

  * Fix hanging on large stack of sync routes

