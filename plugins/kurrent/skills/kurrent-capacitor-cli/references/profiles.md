# Profiles and multi-server

A **profile** is one Capacitor server's configuration: its server URL, default visibility, daemon settings, ignore list, and excluded repos. Use profiles to keep work and open-source (or multiple tenants) on separate servers and switch automatically by repo.

## Managing profiles

```bash
kcap profile add work --server-url https://my-tenant.kcap.ai
kcap profile add oss  --server-url https://cap.oss.dev --remote "github.com/myorg/*"
kcap profile list
kcap profile show work          # defaults to the active profile when name omitted
kcap profile remove work
```

`--remote <pattern>` associates the profile with git-remote patterns and is **repeatable**, pass it multiple times for multiple orgs/hosts.

### `--remote` wildcard matching

The `*` in a remote pattern is **slash-bounded**: it matches exactly one path segment, not across `/`.

```text
✅ github.com/myorg/*   matches  github.com/myorg/repo
❌ github.com/myorg/*   does NOT match  github.com/myorg-labs/repo   (different segment)
❌ github.com/myorg/*   does NOT match  github.com/myorg/team/repo   (deeper path)
```

## Switching the active profile

```bash
kcap use work                  # bind 'work' to the current git repo root (or cwd if not a repo)
kcap use work --global         # set 'work' as the global default
kcap use oss --save            # bind AND write a committable .kcap.json for the whole team
```

Without `--global`, `use` binds to the repo root (or current directory). `--save` writes `.kcap.json` at the bind directory so a team shares one profile by committing the file.

## Resolution order

When the CLI needs to decide which profile/server to use, it checks, in order:

1. `--server-url` CLI flag
2. `KCAP_URL` environment variable
3. `KCAP_PROFILE` environment variable
4. `.kcap.json` in the repo root (or current directory if not in a repo)
5. Git remote pattern matching from `--remote`
6. Directory binding from `kcap use`
7. Global active profile (or `default`)

This is why `kcap import --org` works for tenant-bound profiles: `kcap setup` names the profile after the picked tenant, and `--org` uses that **profile name** as the GitHub org login. On the `default` profile or a manually-named one, use `--repo owner/name` instead, or bind a profile with `kcap use` / `kcap login --discover`.

## Discovering tenants

```bash
kcap login --discover
```

Runs tenant discovery across all your GitHub org memberships, exchanges tokens for each discovered Capacitor tenant, saves them as named profiles, and sets the picked tenant active. No existing profile config is required first.

> Profiles are real, named config objects, **do not** suggest per-repo environment variables or a single global config file the user hand-edits as the way to switch servers. Use `profile add` + `--remote` / `kcap use`.
