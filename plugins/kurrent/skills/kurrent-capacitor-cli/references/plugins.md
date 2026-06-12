# Plugins: hooks and skills

`kcap plugin install` / `remove` manages the hooks and agent skills for each supported agent. `kcap setup` already installs these for detected agents; use `kcap plugin` to add an agent installed *after* setup, scope an install to one repo, or refresh.

```bash
kcap plugin install [--project] [--codex] [--cursor] [--skills] [--if-installed]
kcap plugin remove  [--codex] [--cursor] [--skills]
```

## What each target installs

| Command                        | Installs                                                                                                                                             |
|--------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `kcap plugin install`          | Claude Code plugin (user scope). **Claude is the default target, with no flag, there is no `--claude` flag.**                                        |
| `kcap plugin install --codex`  | Codex CLI **hooks AND agent skills** (`~/.codex/hooks.json` + `~/.agents/skills/`).                                                                  |
| `kcap plugin install --cursor` | Cursor hooks (`~/.cursor/hooks.json`; all 8 supported entries, merged with existing).                                                                |
| `kcap plugin install --skills` | Only the agent-agnostic skills (`~/.agents/skills/`), no Codex hooks. Use if you only have Cursor (or another agent that reads `~/.agents/skills/`). |

After installing **Codex** hooks, the next `codex` launch prompts to **trust the new hooks, accept once** to trust them all (or run `/hooks` inside Codex to trust entries individually). For a `--project` install also run `codex` once in the repo and accept the workspace-trust prompt.

> To add an agent installed after the initial `kcap setup`, run the matching `kcap plugin install` target rather than re-running the whole wizard: Codex is `kcap plugin install --codex`, and Claude is the bare `kcap plugin install` (optionally `--if-installed`). On `plugin install`, Claude is the default target with no flag of its own; `--claude` exists only on `kcap import` as a vendor filter.

## Scope

- **User scope (default):** hooks for the current user, fire for every session.
- **`--project`:** apply hooks to the current repo only, Claude → `<repo>/.claude/settings.local.json`, Codex → `<repo>/.codex/hooks.json`. **Skills are always user-wide; `--project` only affects hooks.**
- **Cursor** uses a single user-scope `~/.cursor/hooks.json`, there is no project variant, so `--project` has no effect with `--cursor`. Cursor is detected by user-dir presence, not `PATH`.

## The installed skills

`--codex` / `--skills` write five skills under `~/.agents/skills/`:

| Skill                | Wraps                | Purpose                                             |
|----------------------|----------------------|-----------------------------------------------------|
| `kcap-recap`         | `kcap recap`         | Session summary / continuation chain / repo history |
| `kcap-errors`        | `kcap errors`        | Tool-call error extraction                          |
| `kcap-hide`          | `kcap hide`          | Mark session owner-only                             |
| `kcap-disable`       | `kcap disable`       | Stop recording + delete server data                 |
| `kcap-validate-plan` | `kcap validate-plan` | Verify plan items were completed                    |

All five auto-resolve the active session from `KCAP_SESSION_ID` (Claude) or `CODEX_THREAD_ID` (Codex 0.81+); pass `<sessionId>` to target a different one. Any agent honoring the `.agents/skills` convention picks them up.

## `--if-installed` (refresh-only)

```bash
kcap plugin install --skills --if-installed   # no-op unless skills were previously installed
kcap plugin install --codex  --if-installed
kcap plugin install --if-installed            # Claude plugin registration
```

A no-op unless the user previously opted in (marker file or pre-marker entry detected). This is what the npm `postinstall` runs on every global install to refresh command strings + plugin paths on upgrade without forcing installs onto fresh systems; errors are swallowed. Scoped to user-wide installs only, it does **not** refresh `--project` installs. Re-run `kcap plugin install [--codex] --project` by hand after upgrading a project-scope install. Harmless to call manually.

## Uninstall

```bash
kcap uninstall                  # interactive, user-scope removal of all agent integrations
kcap uninstall --yes            # non-interactive (-y also works)
kcap uninstall --project --yes  # also strip project-scope hooks in the cwd's repo
kcap uninstall --keep-config    # remove integrations, keep ~/.config/kcap (profiles, tokens, ignore lists)
```

`uninstall` stops running daemons and watcher processes, strips kcap entries from user-level Claude / Codex / Cursor hook files (preserving non-kcap entries), removes the `~/.agents/skills/kcap-*` skills (plus legacy `~/.codex/skills/kcap-*`), and deletes `~/.config/kcap/`. `--project` additionally cleans `<repo>/.claude/settings.local.json` and `<repo>/.codex/hooks.json` (errors if not inside a git tree; Cursor is user-scope only, so `--project` doesn't touch it). Per-agent selective cleanup isn't exposed here, use `kcap plugin remove [--codex|--cursor|--skills]` for that.
