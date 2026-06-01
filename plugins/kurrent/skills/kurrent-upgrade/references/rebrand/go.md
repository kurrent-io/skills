# Rebranding the Go gRPC client from EventStoreDB to KurrentDB

EventStoreDB rebranded to **KurrentDB** in 2025. Go gRPC client released [v1.0.0 of `github.com/kurrent-io/KurrentDB-Client-Go`](https://github.com/kurrent-io/KurrentDB-Client-Go/releases/tag/v1.0.0). gRPC protocol, event model, method signatures unchanged. Migration: module path rename, package rename, **one** field rename (`ExpectedRevision` → `StreamState`).

Scope: projects on the EventStoreDB Go gRPC client (`github.com/EventStore/EventStore-Client-Go/v4`, package `esdb`). No first-party legacy TCP client for Go.

## Source-module matrix

Read `go.mod` and every `import` line before classifying. Bulk find-and-replace before the matrix check breaks resolution on both sides.

| Found in the project                                                              | Classification    | Action                                                            |
|-----------------------------------------------------------------------------------|-------------------|-------------------------------------------------------------------|
| `github.com/EventStore/EventStore-Client-Go/v4` (package `esdb`)                  | EventStoreDB gRPC | Continue with this reference.                                     |
| `github.com/kurrent-io/KurrentDB-Client-Go` already present, no `EventStore/...`  | Current gRPC      | Nothing to do. Use `kurrent-docs`.                                |
| Non-first-party EventStore Go client (community wrappers around HTTP API)         | Out of scope      | Not covered. Rebrand the wrapper upstream first.                  |

If both modules appear in the same `go.mod`, classify as mid-migration: finish the rebrand, then remove the `EventStore/...` require.

| Topic                                                                                | When to read                                                                       |
|--------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| [Module + package swap](#1-replace-the-module-and-package-name)                      | First step. Require path and package identifier both change.                       |
| [Import + identifier renames](#2-import-and-identifier-renames)                      | Mechanical find-and-replace, after the module swap.                                |
| [Connection string](#3-connection-string-esdb-and-kurrentdb)                         | `kurrentdb://` preferred; `esdb://`, `kdb://`, `kurrent://` still parse.           |
| [Expected revision API](#4-expected-revision-streamstate-replaces-the-expectedrevision-interface) | Breaking. `ExpectedRevision` interface removed; `StreamState` is the new sum type. Field rename hits `AppendToStreamOptions`, `DeleteStreamOptions`, `TombstoneStreamOptions`. |
| [Error handling](#5-error-handling)                                                  | `ErrorCodeWrongExpectedVersion` unchanged; new error codes added.                  |
| [Checklist](#rebrand-checklist)                                                      | Final verification.                                                                |

## 1. Replace the module and package name

Current client: single Go module [`github.com/kurrent-io/KurrentDB-Client-Go`](https://pkg.go.dev/github.com/kurrent-io/KurrentDB-Client-Go), one importable package `kurrentdb`. No `/v1` suffix on the module path even though the tag is `v1.0.0`; intentionally unversioned.

```sh
go get github.com/kurrent-io/KurrentDB-Client-Go@latest
go mod tidy
```

In `go.mod`, from:

```go
require github.com/EventStore/EventStore-Client-Go/v4 v4.4.0
```

to:

```go
require github.com/kurrent-io/KurrentDB-Client-Go v1.2.0
```

**Pin to the latest 1.x.** Server-feature coverage and bug fixes land faster here. Examples only on `KurrentDB-Client-Go`: `Client.MultiStreamAppend`, `Client.AppendRecords`, `ConsumerStrategyPinnedByCorrelation`.

Drop the old `require` in the same commit as the rename. Leaving both compiles (package identifiers differ: `esdb` vs `kurrentdb`), but `go mod tidy` flags duplicate transitive `google.golang.org/grpc` and `google.golang.org/protobuf` versions that confuse `go vet ./...` and produce "duplicate proto registration" warnings at startup.

## 2. Import and identifier renames

Package dir moves from `esdb/` to `kurrentdb/`, package name from `package esdb` to `package kurrentdb`, every call-site qualifier from `esdb.` to `kurrentdb.`. **All exported type and method names stay the same** (`Client`, `EventData`, `ContentTypeJson`, `Any`, `NoStream`, `StreamExists`, `StreamRevision`, `Position`, `Start`, `End`, `Backwards`, `Forwards`, `Credentials`, `ResolvedEvent`, `RecordedEvent`, `SubscriptionFilter`, `StreamFilterType`, `EventTypeFilter`, `PersistentSubscriptionSettings`, `ProjectionClient`, etc.).

| EventStoreDB gRPC                                              | KurrentDB                                                       |
|----------------------------------------------------------------|-----------------------------------------------------------------|
| `import "github.com/EventStore/EventStore-Client-Go/v4/esdb"`  | `import "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"`  |
| `esdb.NewClient(...)`                                          | `kurrentdb.NewClient(...)`                                      |
| `esdb.ParseConnectionString(...)`                              | `kurrentdb.ParseConnectionString(...)`                          |
| `*esdb.Client`, `*esdb.Configuration`, `esdb.EventData`, etc.  | `*kurrentdb.Client`, `*kurrentdb.Configuration`, `kurrentdb.EventData`, etc. |
| `esdb.NewProjectionClient(...)` / `*esdb.ProjectionClient`     | `kurrentdb.NewProjectionClient(...)` / `*kurrentdb.ProjectionClient` |

**No separate persistent-subscriptions client in Go.** Persistent-subscription operations are methods on `*Client` (`SubscribeToPersistentSubscription`, `CreatePersistentSubscription`, `DeletePersistentSubscription`, `ReplayParkedMessages`, `ListAllPersistentSubscriptions`, ...). Do not invent a `KurrentDBPersistentSubscriptionsClient` from the .NET/Java guides.

Rename order:

1. Update `go.mod` (`go get`, `go mod tidy`).
2. Find-and-replace the import path:

   ```sh
   git grep -l 'github.com/EventStore/EventStore-Client-Go/v4/esdb' \
     | xargs sed -i 's|github.com/EventStore/EventStore-Client-Go/v4/esdb|github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb|g'
   ```

3. Find-and-replace the package qualifier. Scope to `esdb.` followed by an uppercase letter to avoid unrelated identifiers:

   ```sh
   git grep -l '\besdb\.' | xargs sed -i 's/\besdb\.\([A-Z]\)/kurrentdb.\1/g'
   ```

4. If any file uses a renamed import (`import esdb "..."` or `import foo ".../esdb"`), drop the alias unless a real collision exists; an `esdb` alias on the new package buries the rebrand in review.

5. Compile (`go build ./...`). Only remaining errors should be the `ExpectedRevision` → `StreamState` rename in section 4.

### Client construction

```go
// EventStoreDB gRPC
- import "github.com/EventStore/EventStore-Client-Go/v4/esdb"
-
- settings, err := esdb.ParseConnectionString(connectionString)
- if err != nil {
-     log.Fatalf("invalid connection string: %v", err)
- }
- db, err := esdb.NewClient(settings)
- if err != nil {
-     log.Fatalf("could not create client: %v", err)
- }
- defer db.Close()

// KurrentDB
+ import "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"
+
+ settings, err := kurrentdb.ParseConnectionString(connectionString)
+ if err != nil {
+     log.Fatalf("invalid connection string: %v", err)
+ }
+ db, err := kurrentdb.NewClient(settings)
+ if err != nil {
+     log.Fatalf("could not create client: %v", err)
+ }
+ defer db.Close()
```

### Projection client

```go
// EventStoreDB gRPC
- pmc, err := esdb.NewProjectionClient(settings)
- // or, from an existing Client:
- pmc := esdb.NewProjectionClientFromExistingClient(db)

// KurrentDB
+ pmc, err := kurrentdb.NewProjectionClient(settings)
+ // or, from an existing Client:
+ pmc := kurrentdb.NewProjectionClientFromExistingClient(db)
```

Signatures, method set, lifecycle of `ProjectionClient` unchanged.

## 3. Connection string: `esdb://` and `kurrentdb://`

`ParseConnectionString` accepts **eight** schemes in v1.0.0 (up from two):

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

`esdb://` kept for back-compat so the module swap is not gated on a configuration change. **Standardise on `kurrentdb://` at the next configuration touch.** Mixed schemes across environments make grep audits noisier, and external tooling (`esc` CLI, server logs, dashboards) all use `kurrentdb://`. The `kdb://` and `kurrent://` aliases parse but are not used in first-party docs; prefer `kurrentdb://` in source.

```go
// All three resolve the same way today.
settings, _ := kurrentdb.ParseConnectionString("kurrentdb://node1:2113")
settings, _  = kurrentdb.ParseConnectionString("kurrentdb+discover://node1:2113,node2:2113")
settings, _  = kurrentdb.ParseConnectionString("esdb://node1:2113") // still works, but rebrand to kurrentdb:// when you can
```

> **Credentials handling.** Parser accepts `user:pass@` and writes them into `Configuration.Username` / `Configuration.Password`. **Never** embed real credentials in source. Migration agents copy sample literals verbatim into committed code. Set `Configuration.Username` / `Configuration.Password` from environment or a secret manager after parsing, or pass per-call credentials via `AppendToStreamOptions{Authenticated: &kurrentdb.Credentials{Login: ..., Password: ...}}` populated the same way. Snippets here are **structural** examples only.

Query-parameter names (`tls`, `tlsverifycert`, `nodepreference`, `defaultdeadline`, `keepaliveinterval`, `keepalivetimeout`, `connectionname`, `userCertFile`, `userKeyFile`) unchanged.

## 4. Expected revision: `StreamState` replaces the `ExpectedRevision` interface

`ExpectedRevision` interface **removed**. `StreamState` is the new sum type for the expected-revision argument on every options struct: append, delete, tombstone. Field on each options struct renamed from `ExpectedRevision` to `StreamState`.

Sentinel structs (`Any{}`, `NoStream{}`, `StreamExists{}`) and `StreamRevision` struct **unchanged in name**. Previously implemented `ExpectedRevision`; now implement `StreamState`. Existing sentinel call sites only need the field rename and (rare) interface-name rename.

| EventStoreDB gRPC                                                 | KurrentDB                                                |
|-------------------------------------------------------------------|----------------------------------------------------------|
| `var rev esdb.ExpectedRevision = esdb.Any{}`                      | `var rev kurrentdb.StreamState = kurrentdb.Any{}`        |
| `esdb.Any{}`, `esdb.NoStream{}`, `esdb.StreamExists{}`            | `kurrentdb.Any{}`, `kurrentdb.NoStream{}`, `kurrentdb.StreamExists{}` (unchanged) |
| `esdb.StreamRevision{Value: n}` / `esdb.Revision(n)`              | `kurrentdb.StreamRevision{Value: n}` / `kurrentdb.Revision(n)` (unchanged) |
| `AppendToStreamOptions{ExpectedRevision: ...}`                    | `AppendToStreamOptions{StreamState: ...}`                |
| `DeleteStreamOptions{ExpectedRevision: ...}`                      | `DeleteStreamOptions{StreamState: ...}`                  |
| `TombstoneStreamOptions{ExpectedRevision: ...}`                   | `TombstoneStreamOptions{StreamState: ...}`               |

`ResolvedEvent.OriginalStreamRevision()` still exists, still returns a `StreamRevision`. Code feeding it back into an options struct (`opts.ExpectedRevision = ev.OriginalStreamRevision()`) keeps working after the field rename.

### Append call sites

```go
// EventStoreDB gRPC
- opts := esdb.AppendToStreamOptions{
-     ExpectedRevision: esdb.NoStream{},
- }
- _, err := db.AppendToStream(ctx, "order-7", opts, evt)

// KurrentDB
+ opts := kurrentdb.AppendToStreamOptions{
+     StreamState: kurrentdb.NoStream{},
+ }
+ _, err := db.AppendToStream(ctx, "order-7", opts, evt)
```

```go
// Optimistic concurrency against a known revision — the common rename
- opts := esdb.AppendToStreamOptions{
-     ExpectedRevision: lastEvent.OriginalStreamRevision(),
- }
+ opts := kurrentdb.AppendToStreamOptions{
+     StreamState: lastEvent.OriginalStreamRevision(),
+ }
```

### Delete and tombstone call sites

```go
// EventStoreDB gRPC
- _, err := db.DeleteStream(ctx, "order-7", esdb.DeleteStreamOptions{
-     ExpectedRevision: esdb.StreamExists{},
- })

// KurrentDB
+ _, err := db.DeleteStream(ctx, "order-7", kurrentdb.DeleteStreamOptions{
+     StreamState: kurrentdb.StreamExists{},
+ })
```

Grep for leftover usages:

```bash
grep -rn 'ExpectedRevision\b' --include='*.go' .
```

> **Watch variable names.** Locals named `expectedRevision` are not flagged by the compiler. They still compile, they just lie. Rename to `streamState` so the call site reads truthfully.

> **`StreamState` is not an enum.** Old call sites using a switch over the `ExpectedRevision` interface keep working: the new `StreamState` interface has the same four implementations (`Any`, `NoStream`, `StreamExists`, `StreamRevision`); type-switches keep the same case branches. The interface method moved from `isExpectedRevision()` to `toRawInt64()`, so any code asserting on the unexported method (vanishingly rare) will not compile.

## 5. Error handling

`Error`, `ErrorCode`, `FromError` unchanged. Full list of pre-existing error codes unchanged, including `ErrorCodeWrongExpectedVersion`, `ErrorCodeStreamDeleted`, `ErrorCodeUnauthenticated`, `ErrorCodeResourceNotFound`. Existing `switch esErr.Code()` blocks keep working.

```go
_, err := db.AppendToStream(ctx, "order-7", opts, evt)
if err != nil {
    if kurrentErr, ok := kurrentdb.FromError(err); !ok {
        switch kurrentErr.Code() {
        case kurrentdb.ErrorCodeWrongExpectedVersion:
            // optimistic concurrency conflict — retry or surface
        case kurrentdb.ErrorCodeStreamDeleted:
            // stream was deleted
        }
    }
}
```

KurrentDB 1.x **adds** error codes not in the EventStoreDB client. Emitted by the new `MultiStreamAppend` and `AppendRecords` operations, not classic `AppendToStream`. Existing code keeps the same shape:

| New in KurrentDB v1.0                       | Emitted by                                | Detail type                          |
|---------------------------------------------|-------------------------------------------|--------------------------------------|
| `ErrorCodeStreamRevisionConflict`           | `MultiStreamAppend`, `AppendRecords`      | `*StreamRevisionConflictError`       |
| `ErrorCodeStreamTombstoned`                 | `MultiStreamAppend`, `AppendRecords`      | `*StreamTombstoneError`              |
| `ErrorCodeAppendRecordSizeExceeded`         | `MultiStreamAppend`, `AppendRecords`      | `*AppendRecordSizeExceededError`     |
| `ErrorCodeAppendTransactionSizeExceeded`    | `MultiStreamAppend`, `AppendRecords`      | `*AppendTransactionSizeExceededError` |
| `ErrorCodeAppendConsistencyViolation`       | `AppendRecords`                           | `*AppendConsistencyViolationError`   |

Additive. Adopt when (and only when) the project moves to `MultiStreamAppend` / `AppendRecords`; not required for the rebrand.

```bash
# After the field rename, sanity check that no `esdb.` qualifier survived.
grep -rn '\besdb\.' --include='*.go' .
```

## Rebrand checklist

Before declaring the rebrand done, confirm:

- [ ] `github.com/EventStore/EventStore-Client-Go/v4` removed from `go.mod` and `go.sum`. `github.com/kurrent-io/KurrentDB-Client-Go` referenced at the latest 1.x.
- [ ] No `import ".../EventStore-Client-Go/v4/esdb"` lines remain. Every `esdb.` qualifier replaced with `kurrentdb.`.
- [ ] `*esdb.Client`, `*esdb.Configuration`, `*esdb.ProjectionClient` gone from source. `kurrentdb`-qualified equivalents in place.
- [ ] `ExpectedRevision` gone from struct literals. Append, delete, tombstone call sites use `StreamState: kurrentdb.Any{}` / `kurrentdb.NoStream{}` / `kurrentdb.StreamExists{}` / `kurrentdb.Revision(n)` or `kurrentdb.StreamRevision{Value: n}`.
- [ ] Locals previously named `expectedRevision` renamed to `streamState`.
- [ ] `kurrentdb.ExpectedRevision` interface not referenced anywhere. Type-switches on sentinel structs compile against `kurrentdb.StreamState`.
- [ ] `FromError` / `Error.Code()` switches checked: pre-existing error codes (`ErrorCodeWrongExpectedVersion`, `ErrorCodeStreamDeleted`, ...) unchanged. New `ErrorCodeStreamRevisionConflict` / `ErrorCodeAppendConsistencyViolation` only relevant if adopting `MultiStreamAppend` / `AppendRecords`.
- [ ] Connection strings standardised on `kurrentdb://` (or `kurrentdb+discover://`) at the next configuration touch. `esdb://` left only where a deliberate compatibility window applies.
- [ ] No literal `user:pass@` credentials in any connection string in source or in committed configuration. Credentials wired through `Configuration.Username` / `Configuration.Password` (or per-call `AppendToStreamOptions{Authenticated: ...}`) from environment or a secret manager.
- [ ] `go build ./...` clean. `go vet ./...` clean. `go mod tidy` shows no leftover transitive references to `github.com/EventStore/EventStore-Client-Go/v4`.
- [ ] Integration tests run end-to-end against a real KurrentDB target (the project's own suite).
