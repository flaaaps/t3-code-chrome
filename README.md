<img src="assets/icon.svg" width="64" height="64" alt="">

# T3 Code for GitHub (Chrome extension)

Hands GitHub pull requests to [T3 Code](https://t3.codes) sessions without leaving the PR page. On every
`github.com/<owner>/<repo>/pull/<n>` page a **T3 Code** button opens a side panel where you pick a prompt
template (review, address review comments, fix CI, reply to a comment, free prompt), choose a new or an
existing T3 session, and send. The project matching the repository is preselected, sessions that already
know this PR are listed first, and the status of what you sent is tracked in the panel, the toolbar badge and
desktop notifications.

The extension talks to T3 Code through its local MCP endpoint (`http://127.0.0.1:3773/mcp`), the same API the
`t3` CLI uses. It needs no GitHub token: the agent in T3 fetches diff, comments and checks itself.

## Install (unpacked)

```sh
pnpm install
pnpm build          # writes dist/
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select `dist/`.
2. Open the extension options (toolbar icon → *Optionen*). The local server `http://127.0.0.1:3773` is
   prefilled; click **Hinzufügen**.
3. Create a pairing code in T3 Code (Settings → Connections) or in a terminal:

   ```sh
   t3 auth pairing create --ttl 10m --label "Chrome"
   ```

   Paste the code, choose the access level (full access is recommended for reviews that push), click
   **Koppeln**. The connection shows up in T3 Code under Settings → Connections and can be revoked there.
4. Open any pull request on github.com and click **T3 Code** in the PR header (or press `Alt+Shift+T`).

More T3 servers (for example another machine over Tailscale) can be added by URL. Linked environments of a
server are offered automatically when T3 exposes them.

## Development

```sh
pnpm dev            # Vite + CRXJS with HMR; load dist/ once, then edits reload
pnpm test           # unit tests (vitest)
pnpm lint           # biome
pnpm typecheck
node test/e2e/run.mjs [--dispatch] [--headed] [--pr <url>]   # real Chrome + live T3 server
```

The end-to-end script builds nothing itself: run `pnpm build` first. It mints a pairing code with the `t3`
CLI, pairs the extension, opens a public PR, checks project preselection and the session list, and with
`--dispatch` starts a tiny scratch thread in T3 and waits for it to complete. Screenshots land in
`test/e2e/out/`.

## Layout

```
src/background/   service worker: MCP client, OAuth pairing, catalog cache, job tracker, message router
src/content/      GitHub integration: PR detection, DOM context, Shadow-DOM panel (Preact)
src/popup/        toolbar popup: connection status and active sessions
src/options/      options page: connections, prompt templates, defaults
src/shared/       models, message schemas (zod), templates, ranking
docs/             implementation plan and verified T3 API notes
```

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the architecture and the verified T3
server interface.
