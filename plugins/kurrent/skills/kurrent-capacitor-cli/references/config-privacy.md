# Configuration and privacy

```bash
kcap config show            # print current configuration
kcap config set <key> <value>
```

## Where the config lives

The config file is **`$HOME/.config/kcap/config.json`**. `kcap status` prints the resolved path.

Override the location with **`KCAP_CONFIG_DIR`**, which relocates the whole config directory (everything kcap keeps on disk moves with it):

```bash
KCAP_CONFIG_DIR=/etc/kcap kcap status
```

`KCAP_CONFIG_DIR` is the only override; kcap does not honor `XDG_CONFIG_HOME`.

## Config keys

| Key                                        | Description                                                                                                         |
|--------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| `server_url`                               | Server URL. Must include a scheme (`https://...`), see the v1 upgrade note in [install-setup.md](install-setup.md). |
| `daemon.name`                              | Daemon name.                                                                                                        |
| `daemon.max_agents`                        | Max concurrent hosted coding agents.                                                                                |
| `daemon.claude_path` / `daemon.codex_path` | Paths to the agent binaries the daemon spawns (see [daemon.md](daemon.md)).                                         |
| `default_visibility`                       | Default session visibility: `private`, `org_public`, or `public`.                                                   |
| `excluded_repos`                           | Comma-separated `owner/repo` list to never record.                                                                  |
| `use_provider_api_key`                     | Keep `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in headless agent spawns (default off, see below).                      |
| `disable_session_guidelines`               | Skip injecting recurring-lessons context at SessionStart (`true`/`false`).                                          |
| `update_check`                             | Enable the CLI update check (`true`/`false`).                                                                       |

## Default visibility

Controls how your sessions appear to other users. Set during `kcap setup` or any time:

```bash
kcap config set default_visibility private      # only you
kcap config set default_visibility org_public   # org repos visible, others private (default)
kcap config set default_visibility public        # visible to everyone
```

## Two ways to exclude work from recording

These are distinct mechanisms, use the one that matches how you want to scope the exclusion. In both cases the session is **silently skipped: hooks fire no data and nothing is recorded** (and `kcap import` skips them too).

**By git remote**, `excluded_repos`:

```bash
kcap config set excluded_repos "myorg/secret-project,personal/diary"
```

**By working-directory path**, `kcap ignore` (any session whose cwd is, or sits inside, the path):

```bash
kcap ignore .                       # ignore the current directory
kcap ignore ~/code/secret-project   # ignore a specific tree
kcap ignore --list                  # show all ignored paths
kcap ignore --remove ~/code/secret-project
```

`kcap ignore` resolves `.`/`~` to absolute paths, strips trailing separators, and resolves symlinks (so a worktree symlink and its target match).

**Scope:** both lists are stored **per-profile** on the active profile (`excluded_repos` and the ignore/`excluded_paths` list live inside the profile object, not at the top level of the config). Switching profiles with `kcap use` switches both. Don't claim `excluded_repos` is global, and don't invent a `.kcapignore` file or a `--exclude` flag on commands.

## Provider API keys for headless calls

Title generation, summaries, and `kcap eval` judges **shell out to `claude -p` / `codex exec`** in the background (they are not in-process API calls). **By default kcap scrubs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from those spawns** so your *subscription* login (claude.ai / ChatGPT account) is used. A globally-set API key would otherwise override subscription auth and fail the call, so if title generation / summaries are failing while you have one of those keys set globally, this scrubbing is why it's intentionally stripped.

If you genuinely authenticate via API key (PAYG), opt back in:

```bash
kcap config set use_provider_api_key true     # keep the keys in headless spawns
KCAP_USE_PROVIDER_API_KEY=1 kcap recap ...       # one-off override (1/true/yes/on or 0/false/no/off)
```

The env var wins over the profile setting. `kcap setup` also prompts for this when it detects either key in the environment. (Don't advise simply unsetting the key as the only fix.)

## SessionStart guidance injection

At every Claude Code session start the server can inject top evaluation-derived facts for the current repo into `additionalContext`, a `## Known patterns` block (repo/project facts) and a `## Guidance from past sessions` block (agent-targeted action items). Opt out with:

```bash
kcap config set disable_session_guidelines true
```
