# agents bundling

Why the swe/fe/pm plugins are vendored into `agents/` and shipped in the tarball, and how discovery prefers a CLI-registered copy.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## The agents ship with the app
The swe / fe / pm plugins are **vendored into this repo at `agents/<namespace>` and shipped in the
release tarball**, because a new device has neither the plugin directories nor the Claude Code
marketplace entries that point at them — so registry-only discovery gave a fresh install an empty
agent list and nothing to dispatch.
- **Nothing has to be installed through the `claude` CLI for an agent to run.** The runner loads
  a plugin by path (`plugins: [{ type: "local", path: agent.sourcePath }]` in
  `runner/session-manager.ts`), so the CLI's registry is only ever how an agent is *found*.
- **Discovery is registry-first, bundle-as-fallback** (`lib/discovery/agents.ts`): a plugin
  registered through the CLI wins over the bundled copy of the same namespace, so on a machine
  where these agents are being developed the live source directory is still what runs. Only the
  registry side is filtered to `swe`/`fe`/`pm` — anything in `agents/` was shipped deliberately.
  Bundled agents get id `<namespace>@bundled`, `scope: "bundled"`, and `sourcePath` inside the
  app directory. `PLATFORM_AGENTS_DIR` overrides where that directory is.
- **An agent that reappears under a different plugin id reuses its existing row.** `tasks.agent_id`
  is a foreign key with ON DELETE CASCADE, so `syncAgents()` adopts the row already holding that
  namespace rather than inserting a second one and stranding the history — that's what makes
  switching between a CLI install and the bundled copy safe in either direction.
- **`agents/` is a vendored copy, so it drifts.** `pnpm agents:sync` rsyncs it from the source
  checkouts (`../{swe,fe,pm}-agent`, or `CC_AGENT_SRC`); run it after changing an agent and commit
  the result, or releases ship a stale agent. The release workflow asserts the three
  `.claude-plugin/plugin.json` files are in the tarball — losing them is silent otherwise.
- Because `~/.control-center/app` is replaced wholesale on update, the agents are updated by
  `control-center update` along with everything else — and local edits to them are lost. Someone
  who wants to *edit* an agent should register it with `claude plugin marketplace add <dir>` +
  `claude plugin install <ns>@<marketplace>`; that entry then takes precedence over the bundle.
