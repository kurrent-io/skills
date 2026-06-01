# Rebranding the Rust gRPC client from EventStoreDB to KurrentDB

EventStoreDB rebranded to **KurrentDB** in 2025. Rust gRPC client published as [`kurrentdb` v1.0.0](https://github.com/kurrent-io/KurrentDB-Client-Rust), retiring `eventstore` at 4.0.0. No release notes: cut-over across three commits (`6576ac2` rebrand, `898dfd8` add `kurrentdb://` scheme, `c33b1a7` rename `ExpectedRevision` to `StreamState`) plus a republish under the new crate name. gRPC protocol, event model, signatures, and async shape unchanged.

Scope: projects on `eventstore` 4.x (or 3.x), namespace `eventstore::`. No first-party legacy TCP client exists for Rust.

## Source-crate matrix

Read `Cargo.toml`, `Cargo.lock`, and every `use` line before classifying. Bulk find-and-replace before classification leaves the project unable to resolve either side.

| Found in the project                                                              | Classification    | Action                                                            |
|-----------------------------------------------------------------------------------|-------------------|-------------------------------------------------------------------|
| `eventstore = "4.x"` (or earlier 3.x) in `Cargo.toml`, namespace `eventstore::`   | EventStoreDB gRPC | Continue with this reference.                                     |
| `kurrentdb = "1.x"` already present, no `eventstore` dependency left              | Current gRPC      | Nothing to do here. Use `kurrent-docs`.                           |
| Any community wrapper around the HTTP API, or a custom `tonic`-generated client   | Out of scope      | Not covered by this skill; rebrand the wrapper upstream first.    |

Both `eventstore` and `kurrentdb` in the same `Cargo.toml`: mid-migration. Finish the rebrand, then drop `eventstore`. Both compile because crate names differ, but `cargo tree` surfaces duplicate transitive `tonic` / `prost` versions and two copies of the generated protobuf types end up in the build.

| Topic                                                                                | When to read                                                                       |
|--------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| [Crate + import swap](#1-replace-the-crate-and-import-path)                          | First step. Dependency name and every `use eventstore::` line change.              |
| [Edition + MSRV bump](#2-edition-and-msrv-bump)                                      | `kurrentdb` is `edition = "2024"`. Workspaces with a pinned global edition need attention. |
| [Connection string](#3-connection-string-esdb-and-kurrentdb)                         | `kurrentdb://` preferred; `esdb://` (and `kurrent://`, `kdb://`) still parse, no deprecation warning. |
| [`ExpectedRevision` → `StreamState`](#4-expectedrevision--streamstate)                | Breaking. Enum renamed; variant `Exact` → `StreamRevision`; builder method `.expected_revision(...)` → `.stream_state(...)`. |
| [`WrongExpectedVersion` field type](#5-wrongexpectedversion-and-errorwrongexpectedversion) | Breaking. `expected` field type changes from `ExpectedRevision` to `StreamState`. Field name unchanged. |
| [`kurrentdb-extras`](#6-kurrentdb-extras-if-the-project-uses-the-stats-helper)        | Only if the project depends on `eventstore-extras`.                                |
| [Checklist](#rebrand-checklist)                                                      | Final verification.                                                                |

## 1. Replace the crate and import path

Current client publishes as [`kurrentdb`](https://crates.io/crates/kurrentdb) on crates.io. Single crate: persistent subscriptions, projection management, batch / multi-stream append all live inside it.

```diff
 # Cargo.toml
 [dependencies]
-eventstore = "4"
+kurrentdb = "1"
```

```sh
cargo remove eventstore
cargo add kurrentdb
cargo update
```

**Pin to the latest 1.x.** Server-feature coverage and bug fixes land much faster on `kurrentdb`. Examples: `Client::multi_stream_append`, the new `AppendRecords` operation, V2 projection engine, bearer-token auth.

Drop `eventstore` in the same commit as the rename. Both compile because crate names differ, but `cargo tree` flags duplicate transitive `tonic`, `prost`, `tokio`, and the generated `event_store::client::*` protobuf types appear twice.

Import-path rename is mechanical:

| EventStoreDB gRPC                                              | KurrentDB                                                       |
|----------------------------------------------------------------|-----------------------------------------------------------------|
| `use eventstore::{Client, EventData, ...};`                    | `use kurrentdb::{Client, EventData, ...};`                      |
| `eventstore::Client::new(settings)`                            | `kurrentdb::Client::new(settings)`                              |
| `eventstore::ClientSettings`                                   | `kurrentdb::ClientSettings`                                     |
| `eventstore::Credentials`                                      | `kurrentdb::Credentials`                                        |
| `eventstore::operations::*`                                    | `kurrentdb::operations::*`                                      |

**All exported type and method names stay the same** (`Client`, `EventData`, `Credentials`, `ResolvedEvent`, `RecordedEvent`, `ReadStream`, `Subscription`, `PersistentSubscription`, `SubscriptionFilter`, `RetryOptions`, `StreamPosition`, `Position`, `Direction`, `ReadAllOptions`, `ReadStreamOptions`, `SubscribeToAllOptions`, `SubscribeToStreamOptions`, `PersistentSubscriptionOptions`, `AppendToStreamOptions`, `DeleteStreamOptions`, `TombstoneStreamOptions`, etc.). Only public-surface rename: `ExpectedRevision` → `StreamState`, covered in [section 4](#4-expectedrevision--streamstate).

Safe rename order:

1. Update `Cargo.toml` (`cargo remove eventstore && cargo add kurrentdb`).
2. Find-and-replace the import path. Scope to whole-word `eventstore` followed by `::` to avoid touching unrelated identifiers:

   ```sh
   git grep -l '\beventstore::' \
     | xargs sed -i 's/\beventstore::/kurrentdb::/g'
   ```

3. Find-and-replace `use eventstore` (covers `use eventstore;` and `extern crate eventstore;`):

   ```sh
   git grep -l '^use eventstore\b' \
     | xargs sed -i 's/^use eventstore\b/use kurrentdb/'
   git grep -l '^extern crate eventstore\b' \
     | xargs sed -i 's/^extern crate eventstore\b/extern crate kurrentdb/'
   ```

4. If any file uses `use eventstore as es;`, keep the alias only on real collision; otherwise drop it so the rebrand is visible in review.

5. `cargo build`. Remaining errors should be the `ExpectedRevision` → `StreamState` rename (section 4), possibly the `WrongExpectedVersion` field type (section 5).

### Client construction

```rust
// EventStoreDB gRPC
- use eventstore::{Client, ClientSettings};
-
- let settings: ClientSettings = connection_string.parse()?;
- let client = Client::new(settings)?;

// KurrentDB
+ use kurrentdb::{Client, ClientSettings};
+
+ let settings: ClientSettings = connection_string.parse()?;
+ let client = Client::new(settings)?;
```

`Client::new`, `Client::with_runtime_handle`, the `FromStr` impl on `ClientSettings`, and the `connection_string.parse()` idiom are unchanged. No separate cluster constructor: scheme picks single-node vs gossip discovery.

## 2. Edition and MSRV bump

`kurrentdb` is `edition = "2024"`. A crate depending on `kurrentdb` does **not** need to bump its own edition (Cargo handles cross-edition deps), but two situations need attention:

- **Workspace-pinned edition.** Root `Cargo.toml` with `[workspace.package] edition = "2021"` inherited via `edition.workspace = true` is unaffected. Only the `kurrentdb` build artifact uses 2024.
- **Rust toolchain floor.** `edition = "2024"` requires Rust 1.85+. If `rust-toolchain.toml` or CI matrix pins older, `cargo build` fails at the dependency build step. Bump the toolchain pin in the same PR.

```sh
# Quick check the current toolchain meets the floor.
rustc --version  # need 1.85.0 or newer
```

`eventstore` 4.x's final release was already on `edition = "2024"`, so 4.x projects passed this gate. `eventstore` 3.x targeted `edition = "2021"`; bump the toolchain when jumping from 3.x directly to `kurrentdb`.

## 3. Connection string: `esdb://` and `kurrentdb://`

`ClientSettings`'s `FromStr` impl accepts **eight** schemes on `kurrentdb` v1.x, up from two on `eventstore` v4.x:

```
kurrentdb://node1:2113                                  # preferred
kurrentdb+discover://node1:2113,node2:2113,node3:2113   # preferred (cluster discovery)
kurrent://node1:2113                                    # accepted alias
kurrent+discover://node1:2113,node2:2113                # accepted alias
kdb://node1:2113                                        # accepted alias
kdb+discover://node1:2113,node2:2113                    # accepted alias
esdb://node1:2113                                       # still parses
esdb+discover://node1:2113,node2:2113                   # still parses
```

`esdb://` kept for back-compat so the crate swap need not force a configuration change. **Standardise on `kurrentdb://` at the next configuration touch.** Mixed schemes complicate grep audits; external tooling (`esc` CLI, server logs, dashboards) all use `kurrentdb://`. The `kdb://` and `kurrent://` aliases parse but appear in no first-party documentation; prefer `kurrentdb://` in source.

**Rust client does not log a deprecation warning when parsing `esdb://`**, unlike the Node.js client. No runtime signal that configuration is stale; rely on grep / CI lint rules.

```rust
// All three resolve the same way today.
let a: ClientSettings = "kurrentdb://node1:2113".parse()?;
let b: ClientSettings = "kurrentdb+discover://node1:2113,node2:2113".parse()?;
let c: ClientSettings = "esdb://node1:2113".parse()?; // still works, but rebrand to kurrentdb:// when you can
```

> **Credentials handling.** Parser accepts `user:pass@` and writes into `ClientSettings`'s default credentials, but **never** embed real credentials in source. Migration agents copy examples verbatim into committed code; a literal `admin:changeit@` from a sample lands in production. Source credentials from environment or a secret manager and assemble the connection string at runtime, or pass per-operation credentials via `.authenticated(Credentials::new(user, pass))` on every options struct (`AppendToStreamOptions`, `ReadStreamOptions`, `SubscribeToAllOptions`, ...). Snippets here are **structural** only.

Query-parameter names (`tls`, `tlsVerifyCert`, `nodePreference`, `defaultDeadline`, `keepAliveInterval`, `keepAliveTimeout`, `connectionName`, `userCertFile`, `userKeyFile`, `tlsCaFile`) unchanged.

## 4. `ExpectedRevision` → `StreamState`

`ExpectedRevision` enum **renamed** to `StreamState`. One variant renamed at the same time: `ExpectedRevision::Exact(u64)` becomes `StreamState::StreamRevision(u64)`. Other three variants (`Any`, `NoStream`, `StreamExists`) unchanged.

Every options-builder method that took `ExpectedRevision` renamed from `.expected_revision(...)` to `.stream_state(...)` on:

- `AppendToStreamOptions`
- `DeleteStreamOptions`
- `TombstoneStreamOptions`

| EventStoreDB gRPC                                          | KurrentDB                                                         |
|------------------------------------------------------------|-------------------------------------------------------------------|
| `eventstore::ExpectedRevision` (enum)                      | `kurrentdb::StreamState` (enum)                                   |
| `ExpectedRevision::Any`                                    | `StreamState::Any`                                                |
| `ExpectedRevision::NoStream`                               | `StreamState::NoStream`                                           |
| `ExpectedRevision::StreamExists`                           | `StreamState::StreamExists`                                       |
| `ExpectedRevision::Exact(rev)`                             | `StreamState::StreamRevision(rev)`                                |
| `AppendToStreamOptions::default().expected_revision(...)`  | `AppendToStreamOptions::default().stream_state(...)`              |
| `DeleteStreamOptions::default().expected_revision(...)`    | `DeleteStreamOptions::default().stream_state(...)`                |
| `TombstoneStreamOptions::default().expected_revision(...)` | `TombstoneStreamOptions::default().stream_state(...)`             |

### Append call sites

```rust
// EventStoreDB gRPC
- use eventstore::{AppendToStreamOptions, Client, EventData, ExpectedRevision};
-
- let options = AppendToStreamOptions::default()
-     .expected_revision(ExpectedRevision::NoStream);
-
- client.append_to_stream("order-7", &options, event).await?;

// KurrentDB
+ use kurrentdb::{AppendToStreamOptions, Client, EventData, StreamState};
+
+ let options = AppendToStreamOptions::default()
+     .stream_state(StreamState::NoStream);
+
+ client.append_to_stream("order-7", &options, event).await?;
```

```rust
// Optimistic concurrency against a known revision. `Exact` is the variant that changes name, not just the enum.
- let options = AppendToStreamOptions::default()
-     .expected_revision(ExpectedRevision::Exact(
-         last_event.get_original_event().revision,
-     ));
+ let options = AppendToStreamOptions::default()
+     .stream_state(StreamState::StreamRevision(
+         last_event.get_original_event().revision,
+     ));
```

### Delete and tombstone call sites

```rust
// EventStoreDB gRPC
- let options = DeleteStreamOptions::default()
-     .expected_revision(ExpectedRevision::StreamExists);
-
- client.delete_stream("order-7", &options).await?;

// KurrentDB
+ let options = DeleteStreamOptions::default()
+     .stream_state(StreamState::StreamExists);
+
+ client.delete_stream("order-7", &options).await?;
```

```rust
// Tombstone is identical in shape.
- let options = TombstoneStreamOptions::default()
-     .expected_revision(ExpectedRevision::Any);
+ let options = TombstoneStreamOptions::default()
+     .stream_state(StreamState::Any);
```

Grep for remaining call sites:

```sh
git grep -nE 'ExpectedRevision\b|\.expected_revision\(' -- '*.rs'
```

> **Watch out for variable names.** Locals named `expected_revision: ExpectedRevision` fail to compile after the enum rename, but `expected_revision: StreamState` compiles fine and lies. Rename to `stream_state` at the same time.

> **No catch-all replacement on `Exact`.** Blanket `ExpectedRevision::` → `StreamState::` leaves `StreamState::Exact(...)`, which fails to compile (no `Exact` variant on `StreamState`). Do the variant rename in the same pass:
>
> ```sh
> git grep -lE '\bExpectedRevision::Exact\b' -- '*.rs' \
>   | xargs sed -i 's/\bExpectedRevision::Exact\b/StreamState::StreamRevision/g'
> git grep -lE '\bExpectedRevision::' -- '*.rs' \
>   | xargs sed -i 's/\bExpectedRevision::/StreamState::/g'
> git grep -lE '\bExpectedRevision\b' -- '*.rs' \
>   | xargs sed -i 's/\bExpectedRevision\b/StreamState/g'
> ```

Pattern matches keep working with the new name and same branches (`Any`, `NoStream`, `StreamExists`, `StreamRevision(n)`). Destructuring `Exact(n)` needs the variant rename:

```rust
- match expected {
-     ExpectedRevision::Any => /* ... */,
-     ExpectedRevision::NoStream => /* ... */,
-     ExpectedRevision::StreamExists => /* ... */,
-     ExpectedRevision::Exact(n) => /* ... */,
- }
+ match expected {
+     StreamState::Any => /* ... */,
+     StreamState::NoStream => /* ... */,
+     StreamState::StreamExists => /* ... */,
+     StreamState::StreamRevision(n) => /* ... */,
+ }
```

## 5. `WrongExpectedVersion` and `Error::WrongExpectedVersion`

Struct and `Error` variant keep their names (`WrongExpectedVersion`, `Error::WrongExpectedVersion`). The `expected` field's **type** changes from `ExpectedRevision` to `StreamState`. Field name unchanged.

| EventStoreDB gRPC                                                | KurrentDB                                                  |
|------------------------------------------------------------------|------------------------------------------------------------|
| `WrongExpectedVersion { current, expected: ExpectedRevision }`   | `WrongExpectedVersion { current, expected: StreamState }`  |
| `Error::WrongExpectedVersion { expected: ExpectedRevision, .. }` | `Error::WrongExpectedVersion { expected: StreamState, .. }`|

`current: CurrentRevision` unchanged in name and type (`CurrentRevision::Current(u64)` / `CurrentRevision::NoStream`).

```rust
match client.append_to_stream("order-7", &options, event).await {
    Ok(write_result) => { /* ... */ }
    Err(kurrentdb::Error::WrongExpectedVersion { expected, current }) => {
-       tracing::warn!(?expected, ?current, "optimistic concurrency conflict");
+       tracing::warn!(?expected, ?current, "optimistic concurrency conflict");
        // `expected` is now `StreamState`. If the surrounding code matched on
        // `ExpectedRevision::Exact(n)`, the arm becomes `StreamState::StreamRevision(n)`.
    }
    Err(other) => return Err(other.into()),
}
```

Easy to miss in projects that only match `Err(_)` on a catch-all. After section 4's enum rename, the compiler flags every site that destructures `expected` against old variant names. Grep still useful for code that names the type explicitly (error-conversion glue):

```sh
git grep -nE 'expected:\s*ExpectedRevision' -- '*.rs'
```

## 6. `kurrentdb-extras` (if the project uses the stats helper)

Companion crate `eventstore-extras` renamed to [`kurrentdb-extras`](https://crates.io/crates/kurrentdb-extras) in the same release. Same single helper (`StatisticsExt::parse_statistics` on `kurrentdb::operations::RawStatistics`). Skip if `Cargo.toml` does not reference `eventstore-extras`.

```diff
 # Cargo.toml
 [dependencies]
-eventstore-extras = "0.1"
+kurrentdb-extras = "0.1"
```

```rust
// EventStoreDB gRPC
- use eventstore_extras::stats::StatisticsExt;
- let stats = raw_stats.parse_statistics()?; // returns eventstore_extras::stats::Statistics

// KurrentDB
+ use kurrentdb_extras::stats::StatisticsExt;
+ let stats = raw_stats.parse_statistics()?; // returns kurrentdb_extras::stats::Statistics
```

`Statistics` / `Proc` / `Sys` / `Es` field shapes unchanged.

## Rebrand checklist

Before declaring the rebrand done, confirm:

- [ ] `eventstore` removed from `Cargo.toml` and `Cargo.lock`. `kurrentdb` referenced at the latest 1.x.
- [ ] If the project used `eventstore-extras`: `eventstore-extras` removed, `kurrentdb-extras` referenced at a matching minor.
- [ ] No `use eventstore` / `use eventstore::` / `extern crate eventstore` lines remain. Every `eventstore::` qualifier replaced with `kurrentdb::`.
- [ ] `ExpectedRevision` is gone from source. Append, delete, and tombstone call sites use `.stream_state(StreamState::Any)` / `.stream_state(StreamState::NoStream)` / `.stream_state(StreamState::StreamExists)` / `.stream_state(StreamState::StreamRevision(n))`.
- [ ] `ExpectedRevision::Exact(n)` rewrites are `StreamState::StreamRevision(n)`, not `StreamState::Exact(n)`. Variant renamed, not just the enum.
- [ ] Locals previously named `expected_revision` renamed to `stream_state`.
- [ ] `match` arms updated: `Any`, `NoStream`, `StreamExists` keep names; `Exact(n)` becomes `StreamRevision(n)`.
- [ ] `Error::WrongExpectedVersion { expected, current }` arms still compile. `expected` is now `StreamState`; any inner pattern destructuring `ExpectedRevision::Exact(n)` is now `StreamState::StreamRevision(n)`.
- [ ] Connection strings standardised on `kurrentdb://` (or `kurrentdb+discover://`). `esdb://` left only where a deliberate compatibility window is in effect. No runtime deprecation warning, so grep / CI lint is the only signal.
- [ ] No literal `user:pass@` credentials in any connection string in source or committed config. Credentials sourced from environment or a secret manager, or passed per-operation via `.authenticated(Credentials::new(...))`.
- [ ] `rust-toolchain.toml` / CI matrix on Rust 1.85+ (the `edition = "2024"` floor). Only relevant when jumping from `eventstore` 3.x.
- [ ] `cargo build --all-targets` clean. `cargo clippy --all-targets -- -D warnings` clean. `cargo tree | grep -E '\b(eventstore|eventstore-extras)\b'` returns nothing.
- [ ] Integration tests run end-to-end against a real KurrentDB target (the project's own suite).
