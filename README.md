<img src="assets/icon.svg" width="64" height="64" alt="">

# T3 Code for GitHub (Chrome extension)

Hands GitHub pull requests to [T3 Code](https://t3.codes) sessions without leaving the PR page.

- **One click in the PR header.** A split button (`▶ Review starten | ▾`) dispatches the action that fits the
  PR (review, fix failing CI, address requested changes, summarise a draft) with smart defaults: the T3 project
  matching the repository, a worktree on the PR branch, your default model. A short countdown toast lets you
  cancel or adjust.
- **Steer agents inline.** An Agent-Box under the PR header lists every session working on this PR with its
  last message. Answer questions, queue follow-ups, stop a run, or open the thread in T3 Code.
- **Composer for the long tail.** "Anpassen…" opens a drawer: your text first, the target as one line (this
  PR's sessions, new session in a project, scratch, search), review output (inline comments on GitHub or a
  report in T3), model and mode under "Erweitert".
- **Comments and selections.** A `T3 ▾` menu on every review comment implements it, answers it, or hands it
  to the PR's running session. Selected text can be sent via the context menu.
- **Inbox in the popup.** What waits for you first, then what runs, then what finished today, with an inline
  reply field. First run is a three-step wizard (detect the local server, paste a pairing code, open a PR).

The extension talks to T3 Code through its local MCP endpoint (`http://127.0.0.1:3773/mcp`), the same API the
`t3` CLI uses. It needs no GitHub token: the agent in T3 fetches diff, comments and checks itself.

## Install (unpacked)

```sh
pnpm install
pnpm build          # writes dist/
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select `dist/`.
2. Click the toolbar icon. The popup finds the local T3 Code server on `127.0.0.1:3773` by itself.
3. Create a pairing code in T3 Code (Settings → Connections → Pair a client) or in a terminal:

   ```sh
   t3 auth pairing create --ttl 10m --label "Chrome"
   ```

   Paste the code, keep **Vollzugriff** (recommended for reviews that push and comment), click **Koppeln**.
   The connection shows up in T3 Code under Settings → Connections and can be revoked there.
4. Open any pull request on github.com: the **Review starten** button sits in the PR header. `Alt+Shift+T`
   opens the composer, `Cmd/Ctrl+Enter` sends, `Esc` closes.

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
CLI, pairs the extension through the popup wizard, opens a public PR, checks the header action, the composer's
target list and the guard against empty prompts, and with `--dispatch` starts a tiny scratch thread in T3 and
waits for the Agent-Box to show it as finished. Screenshots land in
`test/e2e/out/`.

## Layout

```
src/background/   service worker: MCP client, OAuth pairing, catalog cache, job tracker, message router
src/content/      GitHub integration: PR detection, DOM context, header split button, Agent-Box, composer (Preact + signals)
src/popup/        toolbar popup: inbox (waiting / running / done) and first-run wizard
src/options/      options page: connections, actions (prompt editor with live preview), defaults
src/shared/       models, message schemas (zod), templates, ranking
docs/             implementation plan, verified T3 API notes, UX review
```

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the architecture and the verified T3
server interface.
