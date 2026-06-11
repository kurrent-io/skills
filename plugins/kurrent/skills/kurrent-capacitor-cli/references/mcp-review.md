# MCP servers and PR review

kcap ships three stdio MCP servers and a `kcap review` launcher that give coding agents transcript-grounded context.

```bash
kcap mcp sessions      # search/inspect past Capacitor sessions
kcap mcp review        # PR review context (implementation transcripts)
kcap mcp judge         # per-session judge facts/clusters
```

## Auto-registration

The Kurrent Capacitor plugin (installed by `kcap setup`) **auto-registers `kcap-sessions` and `kcap-review`** for both Claude Code (via the plugin's `.mcp.json`) and Codex CLI (via `.codex-plugin/plugin.json` → `.codex-mcp.json`). **There's nothing to add manually** after setup, no `claude mcp add`, no TOML edit.

`kcap-judge` is **not** auto-registered. Add it explicitly if wanted:

```bash
# Claude Code
claude mcp add kcap-judge -- kcap mcp judge
```
```toml
# Codex (~/.config/codex/mcp_servers.toml)
[kcap-judge]
command = "kcap"
args    = ["mcp", "judge"]
```

## `kcap mcp sessions`: recall past work mid-chat

Lets an agent search and recall prior Capacitor sessions without leaving the chat. **Repo-aware:** it resolves cwd to a repo at startup, so `cd` into a project before spawning the agent and searches default to that repo. Requires `kcap login`. Three tools:

- **`search_sessions`**: free-text search over past sessions (and subagent transcripts) in the current repo. Pass `repo: "all"` to search everything you can see, or `repo: "owner/name"` for a different one; filter by `author` / `author_github_id`. Returns ranked hits with `session_id`, snippet, and (for transcript hits) `hit_event_index` + `agent_id`.
- **`get_session_summary`**: concise `summary_text` + `plan` for a session; use this to orient first.
- **`get_session_transcript`**: speaker-tagged events; pair `around_event` (and `agent_id` for a subagent hit) with the values from `search_sessions` to fetch exact decision context.

> Because it's auto-registered, the answer to "can my agent search my past sessions mid-chat?" is yes, don't tell the user to write an MCP config from scratch.

## `kcap review`: PR review with full context

```bash
kcap review https://github.com/owner/repo/pull/123
kcap review owner/repo#123
```

Launches a Claude Code session equipped with the `kcap-review` MCP tools that query the implementation transcripts, so a reviewer can ask *why* code changed, what alternatives were considered, and verify test coverage, grounded in what actually happened during development.

### The `kcap-review` tools

`get_pr_summary`, `list_pr_files`, `get_file_context`, `search_context`, `list_sessions` (each accepts an optional `pr` arg, `"owner/repo#123"` or a URL, so one server can answer about any PR), plus `get_transcript` (keys off `session_id`, no `pr` needed).

Per-call resolution: tool `pr` arg → startup `--owner/--repo/--pr` → git auto-detect from the current branch.

```bash
kcap mcp review --owner <owner> --repo <repo> --pr <number>   # session defaults
```

## `kcap mcp judge`

Binds to a session and surfaces judge facts/clusters for that session:

```bash
kcap mcp judge --session <sessionId>
```
