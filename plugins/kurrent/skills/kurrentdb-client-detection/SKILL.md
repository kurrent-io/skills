---
name: kurrentdb-client-detection
description: Use when inventorying an application's KurrentDB or EventStoreDB client surface before a migration or audit. NOT for server or cluster state (use kurrentdb-server-detection).
---

# KurrentDB / EventStoreDB client detection

Inventory the KurrentDB / EventStoreDB client surface in an application codebase. Produce a structured report that downstream agents (`migration-specialist`, `code-reviewer`) consume to plan or verify a migration.

## When to use

- Before invoking `migration-specialist`, to confirm the source-and-target pair.
- Inside `code-reviewer` (post-migration mode), to verify no legacy packages, types, or `esdb://` strings remain after a migration.
- Standalone, when answering "are we still on the old client?" / "what SDK does this project use?".

## What this skill does not do

- Does not execute the migration. That is `migration-specialist`'s job.
- Does not probe a running server. Use `kurrentdb-server-detection` for that.
- Does not recommend a target package or version. The agent consumer interprets the inventory.

## Workflow

Run the passes in order. Stop early only if the user has scoped the request to a single dimension (e.g. "just check connection strings").

### Pass 1: identify the ecosystem

Detect the language from project files:

| Found                                                                    | Ecosystem |
| ------------------------------------------------------------------------ | --------- |
| `*.csproj`, `*.sln`, `Directory.Build.props`, `Directory.Packages.props` | .NET      |
| `package.json`                                                           | Node      |
| `pom.xml`, `build.gradle`, `build.gradle.kts`                            | JVM       |
| `pyproject.toml`, `requirements.txt`, `setup.py`                         | Python    |
| `go.mod`                                                                 | Go        |

If multiple ecosystems coexist, report each separately.

### Pass 2: identify the client package

Open the ecosystem-specific reference and grep project files for the patterns it lists.

- **.NET:** [`references/dotnet.md`](references/dotnet.md).
- **Other ecosystems:** No synced patterns yet. Grep package manifests for any token containing `eventstore` or `kurrent` and report what was found without classification. Defer to the [official client docs](https://docs.kurrent.io/) for interpretation.

Classify each project's client as one of: **legacy TCP**, **intermediate gRPC**, **current gRPC**, or **unknown**.

### Pass 3: identify connection schemes

Grep config and source for connection string literals and environment-variable defaults.

- **Files to scan:** `appsettings*.json`, `.env`, `.env.*`, `*.config`, `application*.{yml,yaml,properties}`, `docker-compose*.yml`, `*.tf`, source files matching the ecosystem.
- **Patterns:** `esdb://`, `esdb+discover://`, `kurrentdb://`, `kurrentdb+discover://`.

Capture file, line, scheme, host count, and query parameters (`tls`, `tlsVerifyCert`, `connectionName`) for every hit. A string still on `esdb://` is a migration target regardless of which package version is installed.

### Pass 4: identify API surfaces in use

Grep source for the call sites the migration will rewrite. Use the patterns in the ecosystem reference. The intent is to **scope** the migration, not enumerate every call. Stop after roughly 20 samples per pattern, then report counts and a few representative `file:line` citations.

### Pass 5: produce the inventory report

Emit a structured report. Do not interpret beyond what the patterns directly support.

```
## Kurrent client inventory (<scope>)

### Projects
| Project              | Ecosystem | Client package                          | Classification     | Connection scheme |
|----------------------|-----------|-----------------------------------------|--------------------|-------------------|
| Orders.csproj        | .NET      | EventStore.Client 22.0.0                | legacy TCP         | esdb://           |
| Billing.csproj       | .NET      | EventStore.Client.Grpc.Streams 23.10.0  | intermediate gRPC  | esdb://           |
| WebApp/package.json  | Node      | (none)                                  | n/a                | n/a               |

### Call site counts
| Project       | EventStoreConnection.Create | AppendToStreamAsync | ExpectedVersion.* | StartTransactionAsync |
|---------------|-----------------------------|---------------------|-------------------|-----------------------|
| Orders.csproj | 3                           | 47                  | 22                | 2                     |

### Connection strings
| File                          | Line | Scheme    | Sample                                |
|-------------------------------|------|-----------|---------------------------------------|
| appsettings.Production.json   | 7    | esdb://   | esdb://node1:2113,node2:2113,...      |
| docker-compose.yml            | 14   | esdb://   | ESDB_CONNECTION_STRING=esdb://...     |
```

Close with a one-line summary: `Inventory complete. <N> projects scanned. <M> still on legacy / intermediate client; <K> still on esdb://.`

## Decision rules

- **Mixed packages in a single project**: report all rows; do not deduplicate. A transitive dependency may drag in `EventStore.Client.Grpc.*` after the user replaced direct refs.
- **Tests-only references**: report under a separate "test projects" subsection. A test project on the legacy client may be acceptable mid-migration.
- **No KurrentDB / EventStoreDB references at all**: report "no client detected" and stop. Do not improvise.
- **Hits inside `obj/`, `bin/`, `node_modules/`, `target/`, `vendor/`**: ignore. Build output, not authored source.
- **Hits inside `.git/`**: ignore.

## How agents use this skill

- `migration-specialist` calls this skill in its detection phase, then loads `kurrent-upgrade` and opens the matching flavour (`references/tcp-to-grpc/` or `references/rebrand/`) using the classification.
- `code-reviewer` (post-migration mode) calls this skill after a migration to confirm zero remaining legacy packages, types, or `esdb://` strings.

Both agents quote the report verbatim. They do not collapse rows or omit findings.
