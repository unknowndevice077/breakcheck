<!-- breakcheck:comment -->
## ⚠️ 5 breaking changes may affect this repo

_breakcheck reads the release notes for each dependency bump in this PR and searches this repo for code the breaking changes touch._

| Package | Version range | Breaking changes found | Affect you |
| --- | --- | --- | --- |
| [`eslint`](https://www.npmjs.com/package/eslint) | 8.57.0 → 9.0.0 (major) | 25 | 5 possibly |

### What to look at

<details>
<summary>🟡 <b>eslint</b>: New default config format (`eslint.config.js`) (1 location)</summary>

- 🟡 [.eslintrc.json:1](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L1) _(possibly)_: File matches `.eslintrc.*`

**How to migrate**

1. **To address:** Update your configuration to the new format following the Configuration Migration Guide. In case you still need to use the deprecated eslintrc config format, set environment variable `ESLINT_USE_FLAT_CONFIG` to `false`.

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>🟡 <b>eslint</b>: Removed `require-jsdoc` and `valid-jsdoc` rules (1 location)</summary>

- 🟡 [.eslintrc.json:6](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L6) _(possibly)_: Uses `valid-jsdoc`

**How to migrate**

1. **To address:** Use the replacement rules in `eslint-plugin-jsdoc`.

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>🟡 <b>eslint</b>: `varsIgnorePattern` option of `no-unused-vars` no longer applies to catch arguments (1 location)</summary>

- 🟡 [.eslintrc.json:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L7) _(possibly)_: Uses `no-unused-vars`

**How to migrate**

1. **To address:** If you want to specify ignore patterns for `catch` clause variable names, use the `caughtErrorsIgnorePattern` option in addition to `varsIgnorePattern`.

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>🟡 <b>eslint</b>: `"eslint:recommended"` and `"eslint:all"` no longer accepted in flat config (1 location)</summary>

- 🟡 [.eslintrc.json:3](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L3) _(possibly)_: Uses `eslint:recommended`

**How to migrate**

1. **To address:** Use the `@eslint/js` package instead

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>🟡 <b>eslint</b>: `no-unused-vars` now defaults `caughtErrors` to `"all"` (1 location)</summary>

- 🟡 [.eslintrc.json:7](https://github.com/acme/shop/blob/c0ffee0000000000000000000000000000000002/.eslintrc.json#L7) _(possibly)_: Uses `no-unused-vars`

Source: https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md

</details>

<details>
<summary>All 25 breaking changes checked</summary>

**eslint** (rule-based, low confidence, notes truncated)

- Node.js < v18.18, v19 are no longer supported — _nothing to search for automatically; review manually_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- New default config format (`eslint.config.js`) — _possibly affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Removed multiple formatters — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Removed `require-jsdoc` and `valid-jsdoc` rules — _possibly affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `eslint:recommended` has been updated — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `--quiet` no longer runs rules set to `"warn"` — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `--output-file` now writes a file to disk even with an empty output — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `/* eslint */` comments with only severity now retain options from the config file — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Multiple `/* eslint */` comments for the same rule are now disallowed — _nothing to search for automatically; review manually_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Stricter `/* exported */` parsing — _nothing to search for automatically; review manually_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `no-constructor-return` and `no-sequences` rule schemas are stricter — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- New checks in `no-implicit-coercion` by default — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Case-sensitive flags in `no-invalid-regexp` — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `varsIgnorePattern` option of `no-unused-vars` no longer applies to catch arguments — _possibly affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `no-restricted-imports` now accepts multiple config entries with the same `name` — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `"eslint:recommended"` and `"eslint:all"` no longer accepted in flat config — _possibly affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `no-unused-vars` now defaults `caughtErrors` to `"all"` — _possibly affects this repo_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `no-useless-computed-key` flags unnecessary computed member names in classes by default — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `camelcase` allow option only accepts an array of strings — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Removed multiple `context` methods — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Removed `sourceCode.getComments()` — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Removed `CodePath#currentSegments` — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- Function-style rules are no longer supported — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `meta.schema` is required for rules with options — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))
- `FlatRuleTester` is now `RuleTester` — _no usages found_ ([source](https://github.com/eslint/eslint/blob/v9.0.0/docs/src/use/migrate-to-9.0.0.md))

</details>

<details>
<summary>Couldn't analyse (1)</summary>

- `eslint`: no source file imports eslint (config files and scripts were still checked)

</details>

**Mode:** Rule-based (no AI available), lower confidence: provider is set to "none"

---
<sub>**Checked:** direct dependency bumps (eslint) using CHANGELOG files, migration guides; searched source files that import each package, config files and package.json scripts. **Not checked:** transitive dependencies, runtime behaviour without a code-level signal, and usages that can't be followed statically. This is advisory and does not mean the upgrade is safe. Generated by [breakcheck](https://github.com/unknowndevice077/breakcheck).</sub>