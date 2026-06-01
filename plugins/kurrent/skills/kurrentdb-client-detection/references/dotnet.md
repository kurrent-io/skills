# .NET client detection

Patterns for inventorying the KurrentDB / EventStoreDB client surface in a .NET codebase. Pair with the workflow in `../SKILL.md`.

## Files to read (in precedence order)

When signals disagree across files, the file higher in this list wins:

1. **`*.csproj`**: the project's own `<PackageReference>` is what compiles. A direct ref overrides anything inherited.
2. **`Directory.Build.props` / `Directory.Build.targets`**: applies to every project in the directory tree. May add or override references via `<ItemGroup>`.
3. **`Directory.Packages.props`**: Central Package Management. Only declares **versions** (via `<PackageVersion>`); the actual `<PackageReference>` still lives in the `.csproj` or `Directory.Build.props`. Never classify a project solely from `Directory.Packages.props`; cross-check that some other file actually references the package.
4. **`global.json`**: does not identify the client. Pins the SDK version, which constrains the target framework (e.g. SDK 8 cannot publish `net9.0`).
5. **`nuget.config`**: only relevant if the package source is private. Does not affect classification.

## Client package patterns

Grep project files for `<PackageReference Include="...">` entries (or `<PackageVersion>` in CPM):

| Package id                                       | Version range | Classification        |
| ------------------------------------------------ | ------------- | --------------------- |
| `EventStore.ClientAPI`                           | any           | **legacy TCP**        |
| `EventStore.Client`                              | ≤ 22.x        | **legacy TCP** (see callout below) |
| `EventStore.Client`                              | 23.x          | **intermediate gRPC** (see callout below) |
| `EventStore.Client.Grpc.Streams`                 | any           | **intermediate gRPC** |
| `EventStore.Client.Grpc.PersistentSubscriptions` | any           | **intermediate gRPC** |
| `EventStore.Client.Grpc.ProjectionManagement`    | any           | **intermediate gRPC** |
| `EventStore.Client.Grpc.UserManagement`          | any           | **intermediate gRPC** |
| `EventStore.Client.Grpc.Operations`              | any           | **intermediate gRPC** |
| `KurrentDB.Client`                               | any           | **current gRPC**      |

> **Critical:** the package id `EventStore.Client` is **reused** across two completely different clients. Versions `≤ 22.x` ship the TCP client. Version `23.x` is a transitional rebrand of the gRPC client. **Always read the installed version before classifying.** Classifying by name alone is the single most common detection error and produces a migration plan that does not compile.

The same trap applies to `EventStore.Client.Grpc.*`: it is the intermediate gRPC family. If a project still references any package in that family, it is **not** on the current client even if `KurrentDB.Client` is also referenced (mid-migration state; report both rows).

If both `EventStore.ClientAPI` and `EventStore.Client.Grpc.*` are present in the same project, classify as **mid-migration** and report both rows; the migration is partially done.

## Legacy types to grep in source (TCP)

Search `*.cs` files for these symbol names. Capture `file:line` for each hit.

- `EventStoreConnection` / `IEventStoreConnection` (TCP connection root).
- `ConnectionSettings` / `ConnectionSettingsBuilder` (TCP-only configuration).
- `ClusterSettings` / `ClusterSettingsBuilder` (TCP-only discovery).
- `ExpectedVersion` (replaced by `StreamState` / `StreamRevision` in gRPC).
- `EventData(` constructor calls passing `Guid.NewGuid()` (gRPC uses `Uuid.NewUuid()`).
- `.ConnectAsync(` (gRPC has no explicit connect; the client manages its channel).
- `.StartTransactionAsync(` / `EventStoreTransaction` (**removed in gRPC**; flag as a blocker).
- `.AppendToStreamAsync(` overloads taking a `long expectedVersion`.
- `.ReadStreamEventsForwardAsync(` / `.ReadStreamEventsBackwardAsync(` / `.ReadAllEventsForwardAsync(`.
- `.SubscribeToStreamAsync(` / `.SubscribeToAllAsync(` / `.SubscribeToStreamFrom(` / `.SubscribeToAllFrom(`.
- `.CreatePersistentSubscriptionAsync(` taking `PersistentSubscriptionSettings`.

## Intermediate types to grep in source (intermediate gRPC)

- `EventStoreClient` (root, becomes `KurrentDBClient`).
- `EventStoreClientSettings` (becomes `KurrentDBClientSettings`).
- `EventStorePersistentSubscriptionsClient` (becomes `KurrentDBPersistentSubscriptionsClient`).
- `EventStoreProjectionManagementClient` / `EventStoreUserManagementClient` / `EventStoreOperationsClient`.

The API shape is unchanged between intermediate gRPC and current gRPC; only the package id and type names move. A migration from intermediate is a mechanical rename, not a rewrite.

## Current types (current gRPC, expected after migration)

A clean migration leaves only these in source:

- `KurrentDBClient`, `KurrentDBClientSettings`.
- `KurrentDBPersistentSubscriptionsClient`.
- `StreamState` (`Any`, `NoStream`, `StreamExists`), `StreamRevision`.
- `EventData` constructed with `Uuid.NewUuid()`.

If any **legacy** or **intermediate** symbol from the sections above still appears alongside these, the migration is incomplete.

## Connection-string locations

Grep these files for `esdb://`, `esdb+discover://`, `kurrentdb://`, `kurrentdb+discover://`:

- `appsettings*.json`, `appsettings.*.json`.
- `*.config` (legacy `app.config` / `web.config`).
- `.env`, `.env.*`.
- `docker-compose*.yml`, `compose*.yml`.
- `*.tf`, `*.tfvars` (Terraform).
- `*.cs` (hardcoded strings, often in `Program.cs` or `Startup.cs`).
- Helm `values*.yaml`, Kubernetes manifests under `*.yml` / `*.yaml`.

Capture file, line, scheme, and the relevant query parameters (`tls`, `tlsVerifyCert`, `connectionName`, `nodePreference`, `gossipTimeout`).

## DI registration patterns

Grep `Program.cs`, `Startup.cs`, and any `*ServiceCollectionExtensions.cs` for:

- `services.AddSingleton<IEventStoreConnection>(` → legacy TCP DI.
- `services.AddEventStoreClient(` → intermediate gRPC DI helper.
- `services.AddKurrentDBClient(` → current gRPC DI helper.
- Manual `new EventStoreConnection(...)` / `new EventStoreClient(...)` / `new KurrentDBClient(...)`.

Report each as a single row; the migration agent uses these to decide whether DI registration needs rewriting.

## Build / package metadata to report

For each project row in the inventory, capture:

- `TargetFramework(s)` from the `*.csproj` (gRPC requires `net8.0+` or `net48` on Windows 11 / Server 2019; report any project still on `netstandard2.0` as a TFM blocker).
- The exact installed package version (e.g. `EventStore.Client 22.0.0`).
- Whether Central Package Management is in use (`Directory.Packages.props` present and `ManagePackageVersionsCentrally` is `true`).

## Patterns to ignore

- Hits inside `obj/`, `bin/`, `artifacts/`, `TestResults/`.
- Hits inside generated files: `*.Designer.cs`, `*.g.cs`, `*.AssemblyInfo.cs`.
- `using` aliases that re-export the legacy types (rare; report as a separate "aliasing" warning).
