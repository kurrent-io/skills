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

## Quick start

**`kcap setup` isn't interactive-only. Run it yourself with flags; don't punt to `! kcap setup` in a terminal.** Only the GitHub OAuth needs the user (browser, or device code on headless).

```bash
npm install -g @kurrent/kcap # works even if the npm allow-scripts warning fires
```

**Branch first: does the user have a Capacitor server? Don't assume. Nothing records without one.**

- **Has a URL** (e.g. `https://my-tenant.kcap.ai`, from their admin): skip to setup.
- **URL unknown:** run `kcap login --discover` (does GitHub login, finds any tenant their orgs already have, no prior config).
  - Finds one: saves + activates a profile. Run setup without `--server-url`.
  - **Finds nothing:** pre-signup, no server. Stop. Send them to https://capacitor.kurrent.io/signup/new to sign up and get their own server, then resume with that URL. Don't invent a server hostname or run setup without one.

**Setup is required — then ask y/n on each recommended extra. Don't auto-run, don't silently skip.**

```bash
kcap setup --server-url <url> --no-prompt # hooks for every detected agent — --skip-{claude,codex,cursor}-hooks to opt out — --device for headless login
```

Recording starts here once hooks land.

- **Backfill past sessions** (recommended). If yes, ask scope first (no safe default, can upload private repos), then `kcap import <scope> --yes` (`--repo .`, `--org`, or `--all`).
- **Start the daemon** (recommended for dashboard-launched hosted agents - not needed for plain recording). If yes, `kcap daemon start -d`.

Verify: `kcap status` (server / auth / hooks / daemon), `kcap whoami`.

Flags + allow-scripts: [`references/install-setup.md`](references/install-setup.md). Import scopes: [`references/import.md`](references/import.md). Daemon: [`references/daemon.md`](references/daemon.md).

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

## Switching profiles

**Before running `kcap use` to switch profiles, ask whether to bind it to this repo only (the no-flag default) or globally (`--global`).** A no-flag `kcap use` silently creates a repo-scoped binding that overrides the global active profile for that directory, so choosing scope for the user can quietly reroute one repo while the rest stay on the old profile. Surface the choice; don't assume. See [`references/profiles.md`](references/profiles.md) for the binding mechanics and resolution order.

## Quick Reference

```bash
# Install & first-run setup → see "Quick start" above

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