# Try breakcheck in five minutes

`demo-app/` is a tiny Express 4 + ESLint 8 project that uses several APIs that
Express 5 and ESLint 9 remove. Put it in its own repository, bump the
dependencies, and watch breakcheck comment on the PR.

1. Create a new repository on GitHub and copy the **contents** of `demo-app/`
   into it (including the hidden `.github/` and `.eslintrc.json`).
2. Generate a lockfile and push:
   ```sh
   npm install
   git add -A && git commit -m "demo app" && git push
   ```
3. Open an upgrade PR. Either wait for Dependabot (`.github/dependabot.yml`
   is included; enable Dependabot version updates in the repo settings), or
   do it by hand:
   ```sh
   git switch -c bump-express-eslint
   npm install express@5 eslint@9
   git commit -am "Bump express to 5 and eslint to 9" && git push -u origin HEAD
   ```
   then open a pull request from that branch.
4. The `breakcheck` workflow runs and posts one comment listing the breaking
   changes that hit `src/server.js`, `.eslintrc.json` and the `lint` script,
   with links to the exact lines.

Without Copilot on the account (or if you delete the `copilot-requests: write`
line), the comment says "Rule-based (no AI available)" and lists the same
locations as "possibly affected".

`workflow.yml` is the same workflow file on its own, ready to copy into an
existing project.
