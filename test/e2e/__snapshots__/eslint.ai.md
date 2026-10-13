<!-- breakcheck:comment -->
## ⚠️ 4 breaking changes affect this repo (1 more may)

_breakcheck reads the release notes for each dependency bump in this PR and searches this repo for code the breaking changes touch._

| Package | Version range | Breaking changes found | Affect you |
| --- | --- | --- | --- |
| [`eslint`](https://www.npmjs.com/package/eslint) | 8.57.0 → 9.0.0 (major) | 7 | **4** (+1 possibly) |

### What to look at

<details>
<summary>⚠️ <b>eslint</b>: <code>eslint.config.js</code> (flat config) is the default; <code>.eslintrc.*</code> files are no longer read. (1 location)</summary>

- 🔴 [.eslintrc.json:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L1): The repo is configured with `.eslintrc.json`, which ESLint 9 ignores by default.

**How to migrate**

1. Convert the config with `npx @eslint/migrate-config .eslintrc.json`.
2. Or set `ESLINT_USE_FLAT_CONFIG=false` temporarily (deprecated).

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>⚠️ <b>eslint</b>: The <code>--ext</code> CLI flag is not supported with flat config; file patterns come from the config's <code>files</code>. (1 location)</summary>

- 🔴 [package.json:5](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/package.json#L5): The `lint` script passes `--ext`, which errors under flat config.

  Suggested fix for `package.json:5`:

  ```diff
  -    "lint": "eslint --ext .js,.ts --format compact src",
  +    "lint": "eslint --format compact src",
  ```

**How to migrate**

1. Drop `--ext` and add `files: ['**/*.js', '**/*.ts']` to the relevant config object.

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>⚠️ <b>eslint</b>: The checkstyle, compact, jslint-xml, junit, tap, unix and visualstudio formatters were removed from core. (1 location)</summary>

- 🔴 [package.json:5](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/package.json#L5): Uses `--format compact`, which is no longer built in.

**How to migrate**

1. Install the standalone package, e.g. `eslint-formatter-compact`, and keep `--format compact`.

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>⚠️ <b>eslint</b>: The <code>require-jsdoc</code> and <code>valid-jsdoc</code> rules were removed. (1 location)</summary>

- 🔴 [.eslintrc.json:6](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L6): Enables `valid-jsdoc`, which no longer exists.

  Suggested fix for `.eslintrc.json:6`:

  ```diff
  -    "valid-jsdoc": "warn",
  ```

**How to migrate**

1. Remove the rules, or use `eslint-plugin-jsdoc` equivalents.

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>🟡 <b>eslint</b>: <code>no-unused-vars</code> now defaults <code>caughtErrors</code> to "all". (1 location)</summary>

- 🟡 [.eslintrc.json:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L7) _(unsure)_: The rule is enabled without `caughtErrors`, so unused catch parameters will start to be reported; depends on the code.

**How to migrate**

1. Set `caughtErrors: "none"` to keep the v8 behaviour, or prefix unused catch params with `_` and set `caughtErrorsIgnorePattern`.

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>All 7 breaking changes checked</summary>

**eslint** (AI-extracted, notes truncated)

- `eslint.config.js` (flat config) is the default; `.eslintrc.*` files are no longer read. — _affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- The `--ext` CLI flag is not supported with flat config; file patterns come from the config's `files`. — _affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- The checkstyle, compact, jslint-xml, junit, tap, unix and visualstudio formatters were removed from core. — _affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- The `require-jsdoc` and `valid-jsdoc` rules were removed. — _affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `no-unused-vars` now defaults `caughtErrors` to "all". — _possibly affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Node.js below v18.18 and v19 are no longer supported. — _nothing to search for automatically; review manually_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `"eslint:recommended"` and `"eslint:all"` no longer accepted in flat config — _matches ruled out_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))

</details>

<details>
<summary>Couldn't analyse (1)</summary>

- `eslint`: no source file imports eslint (config files and scripts were still checked)

</details>

**Mode:** AI-assisted via `copilot/auto`

---
<sub>**Checked:** direct dependency bumps (eslint) using CHANGELOG files, migration guides; searched source and component files that use each package, config files and package.json scripts. **Not checked:** transitive dependencies, runtime behaviour without a code-level signal, and usages that can't be followed statically. This is advisory and does not mean the upgrade is safe. Generated by [breakcheck](https://github.com/unknowndevice077/breakcheck).</sub>