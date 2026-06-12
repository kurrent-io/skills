---
name: kurrent-capacitor-cli
description: >-
  Use when installing, configuring, or operating the kcap CLI, aka the
  Kurrent Capacitor CLI / Capacitor CLI (npm @kurrent/kcap), which records
  Claude Code, Codex, and Cursor sessions to a Capacitor server. Covers
  install/setup/login, profiles, where its config and on-disk state live,
  importing and remapping past sessions, recap/eval/errors on a recorded
  session, visibility and privacy (hide, disable, ignoring or excluding
  repos and directory trees from recording), the daemon and hosted agents,
  MCP sessions/review and PR review, and plugin hooks. 
---

# kcap CLI (Kurrent Capacitor)

`kcap` is the `@kurrent/kcap` npm CLI that records coding-agent sessions (Claude Code, Codex CLI, Cursor) to a Kurrent Capacitor server, then lets you recap, evaluate, and PR-review them with full transcript context. This skill is the source of truth for its commands, flags, config keys, and gotchas, the binary ships from a repo created after the model's training cutoff, so **do not reconstruct command or flag names from memory; copy them from the reference files.**

## Overview

The CLI splits into a few concerns. Match the user's need to a reference file below and load only that one.

**Key surfaces:**

- **Onboarding**: `kcap setup` (one wizard: server URL, GitHub login, visibility, agent hooks, daemon name), then verify with `kcap status` / `kcap whoami`.
- **Recording**: once an agent's hooks are installed, sessions stream automatically; nothing else to run.
- **Profiles**: one server config each (URL, visibility, daemon, ignore list); auto-switch by git remote.
- **History**: `kcap import` backfills past local transcripts; requires an explicit scope.
- **Session tools**: `recap`, `errors`, `eval`, `validate-plan`, `hide`, `disable` operate on a recorded session.
- **Agents for daemon/MCP**: `kcap daemon` runs hosted agents from the dashboard; `kcap mcp ...` and `kcap review` give agents transcript context.
- **Privacy**: `excluded_repos`, `kcap ignore`, and default visibility keep sensitive work off the server.

## Routing

Pick the one file that owns the user's need. Don't load more than you need.

| User need                                                                                                                                                                                                               | Read                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Install (`npm install -g @kurrent/kcap`), the npm install-scripts / `allow-scripts` warning, `kcap setup` (interactive or `--no-prompt`), login, verifying it works, agent detection, the v1 `server_url` upgrade crash | [`references/install-setup.md`](references/install-setup.md)   |
| Multiple Capacitor servers, `kcap profile add`, `--remote` auto-matching, `kcap use`, `.kcap.json`, profile resolution order, `kcap login --discover`                                                                   | [`references/profiles.md`](references/profiles.md)             |
| Backfilling old sessions with `kcap import`, scope flags (`--all` / `--org` / `--repo`), vendor filters, CI/non-interactive runs, `kcap remap` for renamed directories                                                  | [`references/import.md`](references/import.md)                 |
| Working with a recorded session: `kcap recap`, `errors`, `eval` (LLM-as-judge), `validate-plan`, `hide`, `disable`, `set-title`, and how the session ID is resolved                                                     | [`references/sessions.md`](references/sessions.md)             |
| Where the config file lives (`$HOME/.config/kcap/config.json`) and the `KCAP_CONFIG_DIR` override, `kcap config show` / `set`, config keys, default visibility, excluding repos vs paths (`excluded_repos` / `kcap ignore`), provider-API-key scrubbing, SessionStart guidance injection | [`references/config-privacy.md`](references/config-privacy.md) |
| `kcap daemon` lifecycle, running multiple daemons (naming / flock), hosted Claude/Codex agents, `daemon.claude_path` / `daemon.codex_path`, `kcap repos`, daemon env vars                                               | [`references/daemon.md`](references/daemon.md)                 |
| Giving an agent session/PR context: `kcap mcp sessions` / `review` / `judge`, `kcap review <pr>`, auto-registration, the MCP tools                                                                                      | [`references/mcp-review.md`](references/mcp-review.md)         |
| `kcap plugin install` / `remove` (hooks + skills) for Claude / Codex / Cursor, `--project` vs user scope, `--skills`, `--if-installed`, and `kcap uninstall`                                                            | [`references/plugins.md`](references/plugins.md)               |

## Quick Reference

```bash
# First run
npm install -g @kurrent/kcap        # native binary ships as a platform optional-dependency
kcap setup                          # server URL, login, visibility, agent hooks, daemon
kcap status                         # server / auth / hooks / daemon health
kcap whoami

# Backfill past sessions (scope is REQUIRED)
kcap import --org                   # repos owned by the active profile's org
kcap import --repo owner/name       # one repo;  --all for everything;  add --yes for CI

# Inspect a recorded session (ID defaults to the current session inside an agent)
kcap recap <sessionId>              # AI summary;  --full for transcript;  --chain for the whole chain
kcap errors <sessionId>             # extract tool-call errors
kcap eval  <sessionId>              # LLM-as-judge score (safety / plan / quality / efficiency)

# Privacy
kcap hide [sessionId]               # owner-only visibility (still recorded)
kcap disable [sessionId]            # stop recording AND delete server data (irreversible, no prompt)
kcap ignore <path>                  # never record sessions under this directory
kcap config set excluded_repos "owner/secret,personal/diary"
```

## Do NOT use for

- **KurrentDB the database, its client SDKs, or Kurrent Cloud.** Those are unrelated to this CLI, use `kurrent-docs`. (`kcap` records coding-agent sessions; it is not a KurrentDB client and does not talk to a KurrentDB cluster.)
- **Migrating EventStoreDB code to the KurrentDB client.** Use `kurrent-upgrade`.
- **Running a single session action when the kcap plugin's own skills are installed.** The kcap plugin ships action-skills (`kcap:recap`, `kcap:errors`, `kcap:hide`, `kcap:disable`, `kcap:validate-plan`) that perform those commands on the current session. Defer to them when the user just wants to _run_ one of those actions. Use `kurrent-capacitor-cli` for how the CLI works: setup, flags, profiles, import, config, the daemon, the MCP servers, and which command to reach for.