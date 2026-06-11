# Install and setup

## Install

```bash
npm install -g @kurrent/kcap
```

npm picks the right native binary per platform automatically. The CLI is compiled with NativeAOT (fast startup, no runtime dependency).

**The `kcap` binary itself does not come from an install script.** It ships as a platform-specific package (`@kurrent/kcap-<os>-<arch>`) declared as an *optional dependency*; npm installs the matching one. So even if install scripts are blocked, `kcap` works.

Supported platforms: macOS ARM64, Linux x64 / ARM64 (glibc and musl/Alpine), Windows x64.

### The npm install-scripts warning

**npm 11+ gates lifecycle (install) scripts behind an `allow-scripts` policy:** by default it no longer runs a package's `postinstall`/install scripts until you explicitly approve them, and **global (`-g`) installs require an explicit opt-in**. Because of this policy you'll see something like *"1 package has install scripts not yet covered by allowScripts"*. The package declares a single lifecycle script:

```json
"scripts": { "postinstall": "node bin/postinstall.js" }
```

npm's suggested **`npm approve-scripts @kurrent/kcap`** may not resolve a global (`-g`) install: across npm versions the **approval is not consistently applied in the global-install context** (a known npm UX limitation), so running it can fail to whitelist the script even after you approve. Opt in one of two reliable ways instead:

```bash
# one-off, on the install command
npm install -g @kurrent/kcap --allow-scripts=@kurrent/kcap
```

```ini
# persistent: add to ~/.npmrc so every future `npm install -g` runs it
allow-scripts[]=@kurrent/kcap
```

**What the postinstall actually does:** it only *refreshes* user-scope agent integrations, Claude / Codex / Cursor skills and hook/plugin registration, by running `kcap plugin install ... --if-installed` for each. It runs on every global install but is gated by `--if-installed`, so it is a **no-op unless you previously opted in** (a marker file or pre-existing kcap entries are detected). It never installs onto a fresh system, swallows all errors, and always exits 0 so `npm install` can't fail.

Without opting in, re-run the refresh by hand after each upgrade:

```bash
kcap plugin install --if-installed            # Claude plugin registration
kcap plugin install --codex  --if-installed
kcap plugin install --cursor --if-installed
kcap plugin install --skills --if-installed
```

Do **not** chase unrelated causes (npm cache, file permissions, `sudo`), the warning is purely the allow-scripts policy.

## Setup wizard

```bash
kcap setup
```

Walks through these steps, in order:

1. **Server URL** — provided by your admin, e.g. `https://my-tenant.kcap.ai`.
2. **Login** — GitHub, browser/PKCE by default, falls back to Device Flow.
3. **Default visibility** — `private` / `org_public` / `public`; the dashboard-visibility default applied to new sessions.
4. **Coding-agent hooks** — one yes/no per detected agent (Claude Code / Codex CLI / Cursor).
5. **Daemon name**.

When you describe what `kcap setup` covers, list **all five** steps — the **default-visibility** choice is part of the wizard and is the one most easily forgotten.

Re-run any time to update configuration. Verify with:

```bash
kcap status     # server / auth / hooks / daemon
kcap whoami
```

> There is **no `kcap init`, `kcap start`, or hand-written config file**. Setup is the entry point and it writes everything to `~/.config/kcap/`.

### What gets recorded, and when

**Recording only happens once a supported coding agent is installed and its hooks are in place.** Setup alone just detects agents and writes hook registrations, it captures nothing on its own. The hook firing when the agent runs is the only trigger, so there's no recording without a supported agent.

Three agents are supported as recording sources: **Claude Code, Codex CLI, and Cursor.** Detection differs:

- **Claude Code** and **Codex CLI** are detected via `PATH`.
- **Cursor** is detected by user-dir presence (`~/.cursor/`), so IDE-only users without a `cursor` shell command are still covered.

Because of that split, don't describe recording as hinging solely on an agent being "on PATH", that's only true for Claude and Codex.

### Non-interactive / CI

```bash
kcap setup --server-url https://my-tenant.kcap.ai --no-prompt
```

In `--no-prompt` mode the wizard installs hooks for **every detected agent by default.** Opt out per agent with these exact flags (there is no `--only-claude` / `--agents=...`):

```bash
# Claude hooks only:
kcap setup --server-url <url> --no-prompt --skip-codex-hooks --skip-cursor-hooks
# Codex only:
kcap setup --server-url <url> --no-prompt --skip-claude-hooks --skip-cursor-hooks
# Cursor only:
kcap setup --server-url <url> --no-prompt --skip-claude-hooks --skip-codex-hooks
```

Other setup flags: `--daemon-name <name>`, `--default-visibility <private|org_public|public>`, `--device` (force Device Flow login), `--use-provider-api-key <true|false>` (see [config-privacy.md](config-privacy.md)).

`--plugin-scope <user|project|skip>` is legacy: `user` is a no-op, `project` installs the Claude plugin into `<repo>/.claude/settings.local.json`, `skip` aliases `--skip-claude-hooks`. New scripts should use the `--skip-*-hooks` flags and `kcap plugin install --project` for project scope.

If you run setup outside a git working tree it still completes (user-scope hooks fire for every session), but sessions from non-repo dirs won't capture owner/repo/branch/PR context.

## Login on its own

```bash
kcap login            # browser OAuth (localhost callback + PKCE for GitHub)
kcap login --device   # force GitHub Device Flow (SSH / headless / no browser)
kcap login --discover # discover every Capacitor tenant across your GitHub orgs and save each as a profile
kcap logout           # delete stored tokens
```

## Upgrading from v1: `An invalid request URI was provided`

The **v1 config format stored `server_url` as a bare host name without a scheme.** After upgrading, a command may crash with `An invalid request URI was provided`. Fix the scheme:

```bash
kcap config set server_url https://my-tenant.kcap.ai
```

Or reset and re-run setup:

```bash
rm ~/.config/kcap/config.json
kcap setup
```

This is a config-format issue, **not** a network, TLS, or server-down problem. Current builds usually surface a self-documenting hint (*"server_url is missing a scheme. Run: kcap config set server_url https://<host>"*) instead of the raw .NET error; the raw `An invalid request URI was provided` is the older/narrower symptom.
