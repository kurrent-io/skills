# Importing past sessions and remapping moved directories

## Backfilling history

`kcap import` discovers and uploads past local transcripts from every detected agent so they appear in the dashboard:

- Claude, `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`
- Codex, `~/.codex/sessions/.../rollout-<sid>.jsonl`
- Cursor, `~/.cursor/projects/<sanitized-workspace>/agent-transcripts/<sid>/<sid>.jsonl`

### A scope is REQUIRED

You must pick an explicit scope so personal/private repos aren't uploaded by accident. There is no safe scopeless default, running `kcap import` with no scope on an interactive terminal shows a picker; in CI it errors.

```bash
kcap import --all                 # every discovered session from every agent
kcap import --org                 # sessions whose repo owner matches the active profile name
kcap import --repo owner/name     # one specific repo
kcap import --repo .              # the repo at the current cwd (must be a git repo with an origin remote)
```

**`--org` uses the active profile *name* as the GitHub org login** to filter on. It works out of the box for tenant-bound profiles created by `kcap setup`; on `default` or a manually-named profile, use `--repo` instead (or bind a profile, see [profiles.md](profiles.md)). Don't claim `--org` auto-detects the org from git.

The command is **idempotent and resumable**, a server-side watermark dedupes already-imported lines, so re-running the same scope only uploads what's missing. Each run shows a confirmation summary (scope, matched count, repo samples, visibility) before uploading.

### Vendor filters (additive)

By default every available agent is imported. Pass one or more filters to restrict the run:

```bash
kcap import --claude --org        # only Claude transcripts
kcap import --codex  --org        # only Codex rollouts
kcap import --cursor --all        # only Cursor
```

### Other flags

```bash
kcap import --org --yes           # skip the confirmation prompt (-y also works)
kcap import --org --private       # mark every imported session Only Visible to You
kcap import --org --since 2026-01-01   # only sessions on/after this date
kcap import --org --cwd /path     # filter by working directory (composes with scope)
kcap import --org --session <id>  # a single session (composes with scope)
kcap import --min-lines <n>       # skip sessions shorter than n lines (default 15)
kcap import --generate-summaries  # also generate per-session what's-done summaries
```

**Non-interactive runs (no TTY, e.g. CI) must pass both a scope flag and `--yes` (or `-y`).**

## Renamed or moved directories: `kcap remap`

Historic transcripts record the absolute working directory they ran in. If you've since renamed or moved that directory on disk, `kcap import --org` / `--repo` can't run git inside the missing path, so those sessions silently drop from the matched count. Every import prints a one-shot report of missing cwds at the top, add a remap for each one you want to recover.

```bash
kcap remap ~/dev/eventstore/foo-cli ~/dev/eventstore/bar-cli   # add or replace a mapping
kcap remap --list                                              # show all mappings
kcap remap --remove ~/dev/eventstore/foo-cli                   # drop one
```

Then re-run the import (`kcap import --org`, etc.). **Do not** re-import from scratch or hand-edit sessions.

### Matching semantics

- **Path-prefix rewrite** with a path boundary: matches when `cwd == from` or `cwd` starts with `from` + separator (`/`, or `\` on Windows). So `~/dev/foo` will **not** rewrite `~/dev/foo-cli`.
- `~` (and `~\` on Windows) expands to the current user's home at apply time, so entries stay portable across users/hosts.
- Comparison follows the host filesystem's case policy: case-insensitive on Windows, case-sensitive elsewhere.
- Longest `from` wins when multiple rules apply; rules are applied once (no chaining).

### Scope

Remaps live at the **top level** of `~/.config/kcap/config.json` under a `cwd_remap` array (`{ "from": ..., "to": ... }` objects). They are **global across all profiles**, since the same on-disk rename affects every profile's import. (This is the one list that is *not* per-profile, contrast with `excluded_repos` / ignore paths in [config-privacy.md](config-privacy.md).)

Ephemeral worktree cwds shaped `<project>/.<anything>/worktrees/<slug>` (e.g. `~/dev/my-repo/.claude/worktrees/<slug>`) are auto-attributed to `<project>` when it still exists, so they never need a remap entry.
