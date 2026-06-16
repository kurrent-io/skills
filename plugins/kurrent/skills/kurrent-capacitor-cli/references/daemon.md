# Daemon and hosted agents

The daemon connects to the Capacitor server and runs Claude Code or Codex agents in isolated git worktrees, controlled from the dashboard's launch dialog. It supports hosted Claude and Codex agents on macOS and Linux. At startup it probes `daemon.claude_path` / `daemon.codex_path` and advertises only the vendors it can actually spawn, so the launch dialog hides whichever agent isn't installed.

## Lifecycle

```bash
kcap daemon start                   # foreground (defaults --name to your OS username)
kcap daemon start -d                # background (daemonize; logs to file automatically)
kcap daemon start --name laptop -d  # a uniquely-named daemon
kcap daemon status                  # list all running daemons
kcap daemon status --name laptop    # status of one
kcap daemon stop --name laptop      # stop just that one
kcap daemon stop --yes              # stop all running daemons unattended (-y also works)
kcap daemon logs                    # recent daemon log output
kcap daemon doctor                  # diagnose lock-file state for every daemon name
kcap daemon doctor --clean          # also remove stale lock/pid files (held entries untouched)
```

Start options: `--name`, `--server-url`, `--max-agents <n>` (default 5), `--log-file <path>`, `-d`/`--detach`.

## Running multiple daemons on one machine

Each daemon holds an exclusive `flock` on `~/.config/kcap/daemons/<name>.lock` for its entire lifetime. The kernel releases it automatically on process exit (including `SIGKILL` or power-off), so **leftover lock files on disk are never a blocker**, only a live process holding the kernel-level lock can prevent another daemon from acquiring the same name.

- **Different `--name` values → run side-by-side.**
- **Same name on the same machine → collide:** the second exits with code 2. If it somehow connects anyway, the server-side check rejects it with exit code 3.

So to run two daemons, give each a unique `--name`. There is no `--port` or `--instance` flag, and you don't configure this via a config file.

`KCAP_DAEMON_NAME` overrides the active profile's daemon name (an explicit `--name` flag supersedes it).

## Configuring the agent binaries

The daemon spawns the agent CLIs by these paths (stored on the active profile, take effect next daemon start):

```bash
kcap config set daemon.claude_path /opt/claude/bin/claude
kcap config set daemon.codex_path  /opt/codex/bin/codex
```

| Key                  | Default    | Notes                                  |
|----------------------|------------|----------------------------------------|
| `daemon.claude_path` | `"claude"` | Resolved via `PATH` when not absolute. |
| `daemon.codex_path`  | `"codex"`  | Resolved via `PATH` when not absolute. |

Runtime env-var overrides (take precedence over the profile):

```bash
KCAP_CLAUDE_PATH=/opt/claude/bin/claude kcap daemon start
KCAP_CODEX_PATH=/opt/codex/bin/codex   kcap daemon start
```

Hosted Codex agents require the Codex hook surface (installed by `kcap setup` or `kcap plugin install --codex`, see [plugins.md](plugins.md)). The daemon starts Codex with `--sandbox workspace-write` and `--ask-for-approval on-request`, escalating sensitive operations through the daemon's permission bridge to the dashboard.

## Known repo paths

The launch dialog shows repos you've used. Repos are added automatically when agents launch; to manage the list manually:

```bash
kcap repos                    # list known repos (sorted by last used)
kcap repos add .              # add current directory
kcap repos add ~/dev/project  # add a specific path
kcap repos remove ~/dev/old   # remove a path
```

Persisted to `~/.config/kcap/repos.json` and reported to the server on daemon connect, so previously-used repos survive restarts.

## Other maintenance

```bash
kcap cleanup        # kill all orphaned watcher processes
kcap update         # check for and install CLI updates
```
