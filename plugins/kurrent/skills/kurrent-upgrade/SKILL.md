---
name: kurrent-upgrade
description: Use when migrating an app onto the KurrentDB gRPC client from a legacy EventStoreDB client. Covers both the TCP rewrite and gRPC rebrand paths, plus the esdb to kurrentdb connection-string switch. NOT for code already on the KurrentDB client (use kurrent-docs) or server upgrades.
---

# KurrentDB client migration

Two flavours of migration land here, both targeting `KurrentDB.Client` / `KurrentDBClient`:

- **TCP rewrite** for projects still on the legacy EventStoreDB TCP client. A real rewrite: package, transport, API shape, and event model all change.
- **gRPC rebrand** for projects on the intermediate EventStoreDB gRPC client (`EventStore.Client` 23.x and equivalents). A mechanical package + symbol rename plus a small number of API breaks.

Pick the flavour first, then the language reference. Each reference is self-contained and walks the migration top-to-bottom.

## Routing

### Step 1: pick the flavour

| Source state                                                                                                                                    | Flavour      | Folder                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------- |
| Legacy TCP client (.NET `EventStore.ClientAPI` / `EventStoreConnection`, JVM `com.geteventstore:eventstore-client` / `EsConnection`)            | TCP rewrite  | [`references/tcp-to-grpc/`](references/tcp-to-grpc/) |
| Intermediate gRPC client (`EventStore.Client` 23.x, `EventStore.Client.Grpc.*`, `com.eventstore:db-client-java`, `@eventstore/db-client`, etc.) | gRPC rebrand | [`references/rebrand/`](references/rebrand/)         |
| Already on `KurrentDB.Client` and `kurrentdb://`                                                                                                | none         | route to `kurrent-docs`                              |

If you cannot tell which flavour applies, run `kurrentdb-client-detection` first and use its classification.

### Step 2: pick the language reference

| Language   | TCP rewrite                                                            | gRPC rebrand                                                   |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| .NET       | [`references/tcp-to-grpc/dotnet.md`](references/tcp-to-grpc/dotnet.md) | [`references/rebrand/dotnet.md`](references/rebrand/dotnet.md) |
| JVM (Java) | [`references/tcp-to-grpc/jvm.md`](references/tcp-to-grpc/jvm.md)       | [`references/rebrand/java.md`](references/rebrand/java.md)     |
| Node.js    | (not authored)                                                         | [`references/rebrand/nodejs.md`](references/rebrand/nodejs.md) |
| Go         | (not authored)                                                         | [`references/rebrand/go.md`](references/rebrand/go.md)         |
| Python     | (not authored)                                                         | [`references/rebrand/python.md`](references/rebrand/python.md) |
| Rust       | (not authored)                                                         | [`references/rebrand/rust.md`](references/rebrand/rust.md)     |

The TCP JVM reference targets Java consumers of EventStore.JVM (the Scala-based legacy client exposes a Java facade under `eventstore.j.*`); pure Scala consumers follow the same API mapping but keep `scala.concurrent.Future` instead of `CompletableFuture`.

For an ecosystem and flavour combination not in the table, link the [official client upgrade docs](https://docs.kurrent.io/) and do not improvise package names, connection strings, or API shapes. The shape of these renames is not portable across SDKs.

> **Done-criteria.** Every TCP-rewrite reference opens with a `## Required outcomes` checklist. Load it first, satisfy each item, and reread before declaring the migration complete. The rebrand references close with an equivalent end-of-page checklist.

## Do NOT use for

- **Current-SDK usage in a project already on `KurrentDB.Client`.** Use `kurrent-docs`.
- **Server cluster upgrades** (binary, schema, gossip). Defer to the official [server upgrade docs](https://docs.kurrent.io/server/quick-start/installation/upgrade.html); per-version playbooks will land under sibling `kurrent-upgrade-v*-to-v*` skills.
- **Greenfield SDK adoption.** Use `kurrent-docs`.

## Load order

1. **Step 1** above: pick the flavour folder.
2. **Step 2** above: load the matching language reference and work top-to-bottom. Each reference depends on previous sections compiling.
3. **[`references/grpc-retry-policy.md`](references/grpc-retry-policy.md)**. The gRPC client has no built-in retries; wire a retry pipeline before declaring done. The file holds the language-neutral contract and a .NET recipe (Polly v8); other languages apply the contract to their idiomatic resilience library. For the rebrand flavour this is only relevant if the project does not already have retry policies wired (the retry contract did not change in the rebrand).
