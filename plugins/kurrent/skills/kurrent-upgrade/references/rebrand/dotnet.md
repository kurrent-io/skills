# Rebranding the .NET gRPC client from EventStoreDB to KurrentDB

EventStoreDB rebranded to **KurrentDB** in 2025. The .NET gRPC client shipped `KurrentDB.Client` v1.0.0. gRPC protocol, event model, and API shape are unchanged. Migration is package + symbol rename plus a few API breaks.

Scope: projects already on the EventStoreDB gRPC client (`EventStore.Client` 23.x and friends). Legacy TCP projects go to [`../tcp-to-grpc/dotnet.md`](../tcp-to-grpc/dotnet.md); rename is the smallest part of that work.

## Source-package matrix

Read the project file before classifying. The package id `EventStore.Client` is reused across two unrelated clients, so a wrong classification turns the rebrand into a silent type-not-found compile failure.

| Found in the project                                                                                                                              | Classification    | Action                                                                                |
|---------------------------------------------------------------------------------------------------------------------------------------------------|-------------------|---------------------------------------------------------------------------------------|
| `EventStore.Client` version ≤ 22.x                                                                                                                | Legacy TCP        | **STOP.** Load [`../tcp-to-grpc/dotnet.md`](../tcp-to-grpc/dotnet.md).                |
| `EventStore.Client` version 23.x                                                                                                                  | EventStoreDB gRPC | Continue with this reference.                                                         |
| `EventStore.Client.Grpc.Streams` / `EventStore.Client.Grpc.PersistentSubscriptions` / `.ProjectionManagement` / `.UserManagement` / `.Operations` | EventStoreDB gRPC | Continue with this reference.                                                         |
| `KurrentDB.Client` already present, no `EventStore.*` left                                                                                        | Current gRPC      | Nothing to do here. Use `kurrent-docs`.                                               |

Both `EventStore.*` and `KurrentDB.Client` in the same project: mid-migration. Finish via this reference, then remove `EventStore.*`.

Read every `.csproj`, `Directory.Build.props`, and `Directory.Packages.props` before any rename. Bulk find-and-replace before the matrix check leaves the project unable to resolve either side.

| Topic                                                                                | When to read                                                                |
|--------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| [Package swap](#1-replace-the-package-references)                                    | First step. New package consolidates the old sub-packages.                  |
| [Namespace and type renames](#2-namespace-and-type-renames)                          | Find-and-replace, after the package swap.                                   |
| [Connection string](#3-connection-string-esdb-and-kurrentdb)                         | `kurrentdb://` preferred; `esdb://` still parses.                           |
| [Expected revision API](#4-expected-revision-streamrevision-collapses-into-streamstate) | Breaking. `StreamRevision` removed; `StreamState` covers sentinel + numeric. |
| [`WrongExpectedVersionException` field rename](#5-wrongexpectedversionexception-field-rename) | Breaking. `ExpectedStreamRevision` → `ExpectedStreamState`.                |
| [DI registration](#6-di-registration)                                                | Service-collection helpers renamed.                                         |
| [Checklist](#rebrand-checklist)                                                      | Final verification.                                                         |

## 1. Replace the package references

Current client ships as a single NuGet package, [`KurrentDB.Client`](https://www.nuget.org/packages/KurrentDB.Client). Previously separate sub-packages (persistent subscriptions, projection management, user management, operations) are gone; types live inside `KurrentDB.Client`.

```xml
<ItemGroup>
- <PackageReference Include="EventStore.Client" Version="23.*" />
- <PackageReference Include="EventStore.Client.Grpc.Streams" Version="23.*" />
- <PackageReference Include="EventStore.Client.Grpc.PersistentSubscriptions" Version="23.*" />
- <PackageReference Include="EventStore.Client.Grpc.ProjectionManagement" Version="23.*" />
- <PackageReference Include="EventStore.Client.Grpc.UserManagement" Version="23.*" />
- <PackageReference Include="EventStore.Client.Grpc.Operations" Version="23.*" />
+ <PackageReference Include="KurrentDB.Client" Version="1.*" />
</ItemGroup>
```

Pin to latest 1.x. Server-feature coverage and bug fixes (V2 projections, `AppendRecords`) ship only there.

Drop old package references in the same commit as the rename. Both referenced compiles (namespaces differ), but duplicate transitive dependencies confuse `dotnet restore` and produce binding warnings.

## 2. Namespace and type renames

Every class, settings type, and namespace gains a `KurrentDB` prefix. Run find-and-replace **after** the package swap. API shape and method signatures unchanged; only type and namespace names move.

| EventStoreDB gRPC                                  | KurrentDB                                              |
|----------------------------------------------------|--------------------------------------------------------|
| `using EventStore.Client;`                         | `using KurrentDB.Client;`                              |
| `EventStoreClient`                                 | `KurrentDBClient`                                      |
| `EventStoreClientSettings`                         | `KurrentDBClientSettings`                              |
| `EventStorePersistentSubscriptionsClient`          | `KurrentDBPersistentSubscriptionsClient`               |
| `EventStoreProjectionManagementClient`             | `KurrentDBProjectionManagementClient`                  |
| `EventStoreUserManagementClient`                   | `KurrentDBUserManagementClient`                        |
| `EventStoreOperationsClient`                       | `KurrentDBOperationsClient`                            |

Unchanged: `EventData`, `Uuid`, `StreamPosition`, `Position`, `Direction`, `FromStream`, `FromAll`, `SubscriptionFilterOptions`, `EventTypeFilter`, `StreamMessage`, `ResolvedEvent`, `UserCredentials`, and all method names (`AppendToStreamAsync`, `ReadStreamAsync`, `ReadAllAsync`, `SubscribeToStream`, `SubscribeToAll`, etc.). Scope the replace to symbols in the table above; do not rename `EventData` or method bodies.

### Client construction

```csharp
// EventStoreDB gRPC
- using EventStore.Client;
-
- var settings = EventStoreClientSettings.Create(connectionString);
- await using var client = new EventStoreClient(settings);

// KurrentDB
+ using KurrentDB.Client;
+
+ var settings = KurrentDBClientSettings.Create(connectionString);
+ await using var client = new KurrentDBClient(settings);
```

### Persistent subscriptions client

No separate package, no separate settings type.

```csharp
// EventStoreDB gRPC
- using EventStore.Client;
-
- await using var psc = new EventStorePersistentSubscriptionsClient(
-     EventStoreClientSettings.Create(connectionString)
- );

// KurrentDB
+ using KurrentDB.Client;
+
+ await using var psc = new KurrentDBPersistentSubscriptionsClient(
+     KurrentDBClientSettings.Create(connectionString)
+ );
```

### Projection management client

```csharp
// EventStoreDB gRPC
- await using var pmc = new EventStoreProjectionManagementClient(
-     EventStoreClientSettings.Create(connectionString)
- );

// KurrentDB
+ await using var pmc = new KurrentDBProjectionManagementClient(
+     KurrentDBClientSettings.Create(connectionString)
+ );
```

## 3. Connection string: `esdb://` and `kurrentdb://`

Parser accepts both schemes:

```
kurrentdb://node1:2113                                  # preferred
kurrentdb+discover://node1:2113,node2:2113,node3:2113   # preferred (cluster discovery)
esdb://node1:2113                                       # still parses
esdb+discover://node1:2113,node2:2113                   # still parses
```

`esdb://` kept for back-compat so package swap does not force a config change in the same commit. **Standardise on `kurrentdb://` at the next configuration touch.** External tooling (`esc` CLI, server logs, dashboards) uses `kurrentdb://`.

```csharp
// All three resolve the same way today.
var settings = KurrentDBClientSettings.Create("kurrentdb://node1:2113");
var settings = KurrentDBClientSettings.Create("kurrentdb+discover://node1:2113,node2:2113");
var settings = KurrentDBClientSettings.Create("esdb://node1:2113"); // still works, but rebrand to kurrentdb:// when you can
```

> **Credentials.** Parser accepts `user:pass@`, but **never** embed real credentials in source. Migration agents copy examples verbatim into committed code. Wire credentials through `KurrentDBClientSettings.DefaultCredentials = new UserCredentials(user, pass)` from configuration or a secret manager. Snippets here are **structural** only.

Query-parameter names unchanged: `tls`, `tlsVerifyCert`, `nodePreference`, `defaultDeadline`, `keepAliveInterval`, `keepAliveTimeout`, `connectionName`.

## 4. Expected revision: `StreamRevision` collapses into `StreamState`

`StreamRevision` struct is **removed**. `StreamState` is now the single type for the expected-revision argument on append: both sentinels (`Any`, `NoStream`, `StreamExists`) and concrete revisions.

| EventStoreDB gRPC                          | KurrentDB                                                                  |
|--------------------------------------------|----------------------------------------------------------------------------|
| `StreamState.Any`                          | `StreamState.Any` (unchanged)                                              |
| `StreamState.NoStream`                     | `StreamState.NoStream` (unchanged)                                         |
| `StreamState.StreamExists`                 | `StreamState.StreamExists` (unchanged)                                     |
| `StreamRevision.FromInt64(version)`        | `StreamState.StreamRevision(version)` or implicit `(ulong)` conversion     |
| `StreamRevision.None`                      | `StreamState.NoStream` (intent: "stream must not exist")                   |
| `new StreamRevision(ulongValue)`           | `(StreamState)ulongValue` (implicit conversion)                            |

**`StreamRevision.None`.** v1.0.0 release notes show it replaced by `StreamState.None`, but there is no `StreamState.None` on the current client. Replacement depends on intent:

- *"Stream must not exist yet"* → `StreamState.NoStream`.
- *"No opinion about the current revision"* → `StreamState.Any`. **Be deliberate**: `StreamState.Any` disables optimistic concurrency.

Confirm intent at the call site before bulk-replacing. A blanket replace risks silently dropping optimistic concurrency on an append that previously enforced it.

### Append call sites

```csharp
// EventStoreDB gRPC
- await client.AppendToStreamAsync(
-     "order-7",
-     StreamRevision.FromInt64(currentRevision),
-     new[] { evt }
- );

// KurrentDB — implicit conversion from ulong
+ await client.AppendToStreamAsync(
+     "order-7",
+     (ulong)currentRevision,
+     new[] { evt }
+ );

// or, explicit factory
+ await client.AppendToStreamAsync(
+     "order-7",
+     StreamState.StreamRevision((ulong)currentRevision),
+     new[] { evt }
+ );
```

```csharp
// "Stream must not exist yet" — the common rename
- await client.AppendToStreamAsync("order-7", StreamRevision.None, new[] { evt });
+ await client.AppendToStreamAsync("order-7", StreamState.NoStream, new[] { evt });
```

Numeric type moved from `long` to `ulong`. Compiler surfaces every call site that still passes `long`; cast (or pull from a stored `ulong`).

## 5. `WrongExpectedVersionException` field rename

Exception class name unchanged. Two fields renamed:

| EventStoreDB gRPC                                | KurrentDB                                       |
|--------------------------------------------------|-------------------------------------------------|
| `WrongExpectedVersionException.ExpectedStreamRevision` (`StreamRevision`) | `WrongExpectedVersionException.ExpectedStreamState` (`StreamState`) |
| `WrongExpectedVersionException.ActualStreamRevision` (`StreamRevision`)   | `WrongExpectedVersionException.ActualStreamState` (`StreamState`)   |

`StreamName`, `ExpectedVersion` (`long?`), and `ActualVersion` (`long?`) unchanged.

```csharp
try {
    await client.AppendToStreamAsync("order-7", (ulong)expected, events);
} catch (WrongExpectedVersionException ex) {
-   logger.LogWarning("Conflict on {Stream}: expected {Expected}, actual {Actual}",
-       ex.StreamName, ex.ExpectedStreamRevision, ex.ActualStreamRevision);
+   logger.LogWarning("Conflict on {Stream}: expected {Expected}, actual {Actual}",
+       ex.StreamName, ex.ExpectedStreamState, ex.ActualStreamState);
}
```

Easy to miss when the project catches `WrongExpectedVersionException` in only one place. Grep after the symbol rename:

```bash
grep -rn 'ExpectedStreamRevision\|ActualStreamRevision' --include='*.cs' .
```

## 6. DI registration

`IServiceCollection` extensions follow the type rename. Behaviour unchanged: register once, share as singleton, no async setup.

```csharp
// EventStoreDB gRPC
- services.AddEventStoreClient(configuration["KurrentDB:ConnectionString"]);
- services.AddEventStorePersistentSubscriptionsClient(configuration["KurrentDB:ConnectionString"]);

// KurrentDB
+ services.AddKurrentDBClient(configuration["KurrentDB:ConnectionString"]);
+ services.AddKurrentDBPersistentSubscriptionsClient(configuration["KurrentDB:ConnectionString"]);
```

If the project uses manual `new EventStoreClient(...)` instead of the extension method, see [Client construction](#client-construction).

## Rebrand checklist

Before declaring the rebrand done, confirm:

- [ ] All `EventStore.Client*` package references removed. `KurrentDB.Client` at latest 1.x.
- [ ] No `using EventStore.Client;` (or `EventStore.Client.*`) directives remain.
- [ ] `EventStoreClient`, `EventStoreClientSettings`, `EventStorePersistentSubscriptionsClient`, `EventStoreProjectionManagementClient`, `EventStoreUserManagementClient`, `EventStoreOperationsClient` gone from source. `KurrentDB`-prefixed equivalents in place.
- [ ] DI registrations updated: `AddEventStoreClient` → `AddKurrentDBClient`, same for persistent-subscriptions and projection-management extensions.
- [ ] `StreamRevision` type gone from source. Append call sites pass `StreamState.Any` / `StreamState.NoStream` / `StreamState.StreamExists` or a `ulong` revision (implicit) / `StreamState.StreamRevision(value)` (explicit).
- [ ] Every `StreamRevision.None` call site reviewed for intent. "Must not exist" → `StreamState.NoStream`; "no opinion" → `StreamState.Any` (only with deliberate sign-off; disables optimistic concurrency).
- [ ] `WrongExpectedVersionException.ExpectedStreamRevision` / `ActualStreamRevision` reads replaced with `ExpectedStreamState` / `ActualStreamState`. Logging, metrics, tests updated.
- [ ] Connection strings standardised on `kurrentdb://` (or `kurrentdb+discover://`) at the next configuration touch. `esdb://` left only for deliberate compatibility windows.
- [ ] No literal `user:pass@` credentials in any connection string in source or committed configuration. Credentials wired through `KurrentDBClientSettings.DefaultCredentials` from configuration or a secret manager.
- [ ] `dotnet build` clean. `dotnet restore` shows no warnings about duplicate transitive `EventStore.Client.Grpc.*` dependencies.
- [ ] Integration tests run end-to-end against a real KurrentDB target (the project's own suite).
