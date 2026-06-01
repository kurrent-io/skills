# Migrating the .NET client from TCP to gRPC

The legacy TCP client (`EventStore.Client` / `EventStore.ClientAPI` / `EventStoreConnection`) is end of life. **Migrate to the gRPC client (`KurrentDB.Client` / `KurrentDBClient`).** The TCP client receives security patches only; all new database features (such as persistent subscriptions to `$all`) ship for gRPC only.

> **Scope: `Akka.Persistence.EventStore` (.NET).** If the project depends on the community [`akkadotnet/Akka.Persistence.EventStore`](https://github.com/akkadotnet/Akka.Persistence.EventStore) plugin and it transitively pulls in `EventStore.Client` (TCP), this reference is **not enough on its own**. The plugin is community-maintained on a small contributor pool. Verify which client the pinned version targets: if it already references `KurrentDB.Client` (gRPC), this reference alone suffices. If it still pulls `EventStore.Client` (TCP), either wait for the plugin to migrate upstream, fork and patch it, or rewrite the persistence layer against `KurrentDB.Client` directly (Akka.NET's `AsyncWriteJournal` contract maps cleanly). The [Kurrent connectors](https://docs.kurrent.io/connectors/) are an alternative if KurrentDB can be a downstream projection rather than the Akka journal. Budget for it separately.

## Required outcomes

A complete migration produces all of:

- [ ] Project targets a supported framework (.NET 8+ recommended).
- [ ] `EventStore.Client` removed from the build; `KurrentDB.Client` referenced at the latest 1.x.
- [ ] **The migrated library is referenced by the consuming application.** Check `.sln` / `.slnx` membership and confirm a `ProjectReference` (or `PackageReference` if shipped as NuGet) from each consumer. A migrated library outside the solution graph compiles in isolation but is dead code.
- [ ] Connection string uses `kurrentdb://` or `kurrentdb+discover://`; `tls` set deliberately (not `tls=false` outside local dev).
- [ ] No literal `user:pass@` credentials in any connection string in source or in configuration committed to the repo. Credentials wired through `KurrentDBClientSettings.DefaultCredentials` populated from configuration / a secret manager.
- [ ] `KurrentDBClient` registered as a singleton (no async setup, no `ConnectAsync`).
- [ ] All `Guid` event ids replaced with `Uuid`; `isJson` flags replaced with content types.
- [ ] `ExpectedVersion` / `long` replaced with `StreamState` / `StreamRevision`.
- [ ] No `StartTransactionAsync` / `EventStoreTransaction` references; each transaction collapsed into a single `AppendToStreamAsync(events[])` call.
- [ ] Paged reads collapsed into `IAsyncEnumerable` consumers; `.Data.Span` used in deserialisation.
- [ ] **Retry policy wired around every append and read** (Polly v8 / `ResiliencePipeline`). Appends use deterministic `Uuid` plus specific `StreamRevision` so retries are idempotent; idempotency is a precondition to set up, not a property to evaluate.
- [ ] Subscriptions wrapped in a reconnect loop with checkpoint persistence (not in a retry policy).
- [ ] Every catch-up subscription audited for `resolveLinkTos` and live-mode handling.
- [ ] Sync-over-async bridges (`.GetAwaiter().GetResult()`) tagged as deliberate temporaries with a planned refactor; not present in code that already runs on an async context.

The rest of this file is the per-operation implementation reference.

## 1. Update the target .NET framework

The gRPC client does **not** support `netstandard`. Pick a target the gRPC stack supports:

- **.NET 8+** is the recommended target.
- **.NET Framework 4.8+** works but requires Windows 11 / Server 2019 because the older HTTP/2 stack on Windows is the limiting factor. See [.NET gRPC supported platforms](https://learn.microsoft.com/en-us/aspnet/core/grpc/supported-platforms).

Update your project file:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
-   <TargetFramework>netstandard2.0</TargetFramework>
+   <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
```

## 2. Replace the package reference

Replace the TCP package with the current gRPC client:

```xml
<ItemGroup>
- <PackageReference Include="EventStore.Client" Version="22.0.*" />
+ <PackageReference Include="KurrentDB.Client" Version="1.1.*" />
</ItemGroup>
```

**Always pin to the latest `KurrentDB.Client` minor.** The package ships server feature coverage and bug fixes much faster than the TCP client ever did.

## 3. Stage the migration

In a large codebase, do not big-bang the migration. Run both clients side by side and cut over operation by operation:

1. Add `KurrentDB.Client` to the project, leave `EventStore.Client` in place.
2. Migrate operations in dependency order: usually appends and reads first, then catch-up subscriptions, then persistent subscriptions.
3. Once nothing uses the TCP client, remove the `EventStore.Client` package reference.

### Wrap the client to make cutover boring

Centralise client calls behind a thin interface so each migration step is a one-file change inside the wrapper. This is Martin Fowler's [preparatory refactoring](https://martinfowler.com/articles/preparatory-refactoring-example.html) applied to KurrentDB.

```csharp
// TCP-backed implementation — what you have today
public class EventStore {
    readonly IEventStoreConnection tcpConnection;

    public EventStore(IEventStoreConnection tcpConnection)
        => this.tcpConnection = tcpConnection;

    public Task AppendEvents(string streamName, long version, params object[] events) {
        var preparedEvents = events.Select(ToEventData).ToArray();
        return tcpConnection.AppendToStreamAsync(streamName, version, preparedEvents);

        static EventData ToEventData(object @event) =>
            new EventData(
                Guid.NewGuid(),
                TypeMapper.GetTypeName(@event.GetType()),
                isJson: true,
                Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(@event))
            );
    }
}
```

Replace the implementation with the gRPC version (covered below); callers stay unchanged.

## 4. Construct `KurrentDBClient` as a singleton (drop `ConnectAsync`)

### Stop calling `ConnectAsync`

The TCP client kept a persistent connection and required `ConnectAsync` before use:

```csharp
// ❌ TCP — must call ConnectAsync, not thread-safe to call concurrently
var tcp = EventStoreConnection.Create("ConnectTo=tcp://admin:changeit@localhost:1113");
await tcp.ConnectAsync();
```

gRPC does not hold a persistent connection. There is no `ConnectAsync`, no `Closed` event, and **the client is safe to construct synchronously and share as a singleton**:

```csharp
// ✅ gRPC — synchronous construction, share as singleton
using KurrentDB.Client;

// Credentials come from configuration / secret manager, never embedded in source.
var settings = KurrentDBClientSettings.Create(connectionString);
var client = new KurrentDBClient(settings);
```

### Register once in DI

Because there is no async setup, DI registration collapses to a single line:

```csharp
using KurrentDB.Client;

var client = new KurrentDBClient(
    KurrentDBClientSettings.Create(configuration["KurrentDB:ConnectionString"])
);
services.AddSingleton(client);
```

**Anti-pattern in TCP DI (recognize and rewrite):**

```csharp
// ❌ TCP: every consumer had to await the connection
public class EventStore {
    readonly Task<IEventStoreConnection> connect;

    public EventStore(Task<IEventStoreConnection> connect) => this.connect = connect;

    public async Task AppendEvents(string streamName, long version, params object[] events) {
        var tcpConnection = await connect;
        await tcpConnection.AppendToStreamAsync(streamName, version, events.Select(ToEventData));
    }
}
```

### Switch to a connection string

The TCP and gRPC connection strings are **not compatible**. The gRPC client uses the `kurrentdb://` (single node) or `kurrentdb+discover://` (cluster discovery) schemes:

```
kurrentdb://localhost:2113
kurrentdb+discover://node1:2113,node2:2113,node3:2113
```

> **Credentials handling.** The connection-string parser does accept `user:pass@` in the URI, but **never** embed real credentials in source or in samples copied from this reference. Migration agents read these examples as templates; a literal `admin:changeit@` from a sample will end up in committed code. Pass credentials through `KurrentDBClientSettings.DefaultCredentials = new UserCredentials(user, pass)` populated from configuration / a secret manager, or via the SDK's overload that takes `UserCredentials` per call. Treat these snippets as **structural** examples only.

Common parameters:

| Parameter                                | Default     | Notes                                                           |
|------------------------------------------|-------------|-----------------------------------------------------------------|
| `tls`                                    | `true`      | Set `tls=false` for local insecure development only             |
| `nodePreference`                         | `leader`    | Use `leader` for writes; `follower`/`readOnlyReplica` for reads |
| `defaultDeadline`                        | none        | Client-wide operation deadline (ms); overridable per call       |
| `keepAliveInterval` / `keepAliveTimeout` | `10` / `10` | Seconds                                                         |

Even before fully cutting over, prefer connection strings on both sides of the migration: a single configuration entry centralises the eventual swap.

### Built-in TCP reconnect settings have no gRPC equivalent

TCP had `KeepReconnecting()`, `LimitAttemptsForOperationTo()`, `SetOperationTimeoutTo()`. gRPC manages reconnection internally and does **not** retry failed operations. If retry behaviour is needed, see "Wire a Polly retry policy" below.

### Bridging sync consumers

The TCP client had several sync-shaped methods (notably `EventStoreConnection.Create` was sync). The gRPC client's data-path API is **async-only**: `AppendToStreamAsync`, `ReadStreamAsync`, `SubscribeToStream`. If the consuming interface in the project is also async, this is invisible: just `await` everywhere.

If the consuming interface is **synchronous** (legacy `IRepository<T> Save(T entity)`, an MVC controller method that wasn't converted to `async Task<IActionResult>`, a desktop event handler, etc.), document the bridge as a **deliberate temporary** and plan to make the interface async:

```csharp
// ⚠️ Sync-over-async bridge: DELIBERATE TEMPORARY.
//     The sync caller blocks a thread per call; under load this exhausts the ThreadPool and deadlocks.
//     Make the interface async at the first refactor opportunity.
public class SyncEventStore : IEventStore {
    readonly KurrentDBClient client;

    public void Append(string streamName, StreamRevision revision, EventData[] events) =>
        client.AppendToStreamAsync(streamName, revision, events)
              .GetAwaiter()
              .GetResult();
}
```

**Do NOT use `.Result` or `.Wait()`.** Those forms swallow the inner exception inside an `AggregateException`, making errors harder to diagnose. `.GetAwaiter().GetResult()` re-throws the original exception cleanly.

**Do NOT do this in code that already runs on an async context** (ASP.NET request pipeline, a Task-based handler, a `Task.Run` callback). Sync-over-async in those contexts is a deadlock waiting to happen; make the surrounding code async instead.

Treat the sync wrapper as a migration aid, not the destination. The verifier flags long-lived sync-over-async wrappers as a quality concern.

## 5. Enforce TLS and externalize credentials

KurrentDB is secure by default since 20.6. The gRPC client follows that posture.

```csharp
// ✅ Secure (production). Credentials come from configuration / secret manager,
//    NOT from a literal `user:pass@` in source. The connection string just specifies the host.
kurrentdb://cluster.example.com:2113

// ⚠️ Insecure — local dev only. ACLs are NOT enforced over insecure connections.
kurrentdb://localhost:2113?tls=false
```

**Insecure mode disables ACL checks entirely.** Never deploy with `tls=false`.

> Code samples in this reference are read by migration agents as templates. Examples deliberately omit `user:pass@` from connection strings so an agent does not copy a hard-coded `admin:changeit@` into the migrated project. Wire credentials through `KurrentDBClientSettings.DefaultCredentials` populated from configuration, never from source.

## 6. Rewrite appends with `Uuid`, content types, and `StreamState`

### `EventData` changes

| Field        | TCP (`EventStore.ClientAPI`) | gRPC (`KurrentDB.Client`)                          |
|--------------|------------------------------|----------------------------------------------------|
| Event id     | `Guid.NewGuid()`             | `Uuid.NewUuid()`                                   |
| Content type | `bool isJson` flag           | `string contentType`, default `"application/json"` |
| Data payload | `byte[]`                     | `byte[]` or `ReadOnlyMemory<byte>`                 |
| Namespace    | `EventStore.ClientAPI`       | `KurrentDB.Client`                                 |

**JSON payload — TCP:**

```csharp
using EventStore.ClientAPI;

public static EventData ToJsonEventData(object @event, string eventType, object? metadata = null) =>
    new EventData(
        Guid.NewGuid(),
        eventType,
        isJson: true,
        Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(@event)),
        Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(metadata ?? new { }))
    );
```

**JSON payload — gRPC:**

```csharp
using KurrentDB.Client;

public static EventData ToJsonEventData(object @event, string eventType, object? metadata = null) =>
    new EventData(
        Uuid.NewUuid(),
        eventType,
        Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(@event)),
        Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(metadata ?? new { }))
    );
```

**Binary payload — gRPC** (the `isJson: false` flag is replaced with an explicit content type):

```csharp
using KurrentDB.Client;

public static EventData ToBinaryEventData(object @event, string eventType, object? metadata = null) =>
    new EventData(
        Uuid.NewUuid(),
        eventType,
        SerializeToByteArray(@event),
        SerializeToByteArray(metadata ?? new { }),
        contentType: "application/octet-stream"
    );
```

**Supported content types today: `application/json` and `application/octet-stream`.** Other values are reserved for future use.

> **Serializer note.** TCP samples used `Json.NET` (Newtonsoft); gRPC samples use `System.Text.Json` (faster, in-box). The migration does not require swapping serializers, but it is a natural moment. [Migration guide](https://docs.microsoft.com/en-us/dotnet/standard/serialization/system-text-json-migrate-from-newtonsoft-how-to).

### Optimistic concurrency: `ExpectedVersion` becomes `StreamState` / `StreamRevision`

| TCP                                 | gRPC                       | Meaning                             |
|-------------------------------------|----------------------------|-------------------------------------|
| `ExpectedVersion.Any` (-2)          | `StreamState.Any`          | No optimistic check                 |
| `ExpectedVersion.NoStream` (-1)     | `StreamState.NoStream`     | Stream must not exist               |
| `ExpectedVersion.StreamExists` (-4) | `StreamState.StreamExists` | Stream (or its metadata) must exist |
| `long version`                      | `StreamRevision` / `ulong` | Specific revision                   |

The type change from `long` to `ulong` prevents accidentally passing a negative sentinel as a revision number.

**Updating the wrapper from "Stage the migration":**

```csharp
public Task AppendEvents(
    string streamName,
-   long version,
+   StreamRevision version,
    params object[] events
) {
    var preparedEvents = events.Select(ToEventData).ToArray();

-   return tcpConnection.AppendToStreamAsync(streamName, version, preparedEvents);
+   return grpcClient.AppendToStreamAsync(streamName, version, preparedEvents);
}

public Task AppendEvents(string streamName, params object[] events)
-   => AppendEvents(streamName, ExpectedVersion.Any, events);
+   => grpcClient.AppendToStreamAsync(streamName, StreamState.Any, events.Select(ToEventData));
```

### Breaking: transactions are removed

Transactions (`IEventStoreConnection.StartTransactionAsync`, `WriteAsync`, `CommitAsync`) are **removed** in gRPC. The replacement is a single `AppendToStreamAsync` call with the full event batch, which is atomic at the stream level. TCP transactions were always single-stream (`StartTransactionAsync` takes one stream name), so this is a mechanical swap, not an architectural change.

#### Before (TCP)

```csharp
var tx = await connection.StartTransactionAsync(
    "order-7",
    ExpectedVersion.Any
);
await tx.WriteAsync(orderPlacedEvent);
await tx.WriteAsync(paymentReceivedEvent);
await tx.WriteAsync(shipmentRequestedEvent);
await tx.CommitAsync();
```

#### After (gRPC)

```csharp
await client.AppendToStreamAsync(
    "order-7",
    StreamState.Any,
    new[] { orderPlacedEvent, paymentReceivedEvent, shipmentRequestedEvent }
);
```

If concurrency control matters, pass `StreamRevision.FromInt64(currentRevision)` instead of `StreamState.Any` and re-read on `WrongExpectedVersionException`.

Any remaining `StartTransactionAsync` or `EventStoreTransaction` reference is a BLOCKER: the call site will not compile against `KurrentDB.Client` because the API is gone.

## 7. Rewrite reads with `ReadStreamAsync` / `ReadAllAsync`

### Direction is now a parameter, not a method name

| TCP                             | gRPC                                        |
|---------------------------------|---------------------------------------------|
| `ReadStreamEventsForwardAsync`  | `ReadStreamAsync(Direction.Forwards, ...)`  |
| `ReadStreamEventsBackwardAsync` | `ReadStreamAsync(Direction.Backwards, ...)` |
| `ReadAllEventsForwardAsync`     | `ReadAllAsync(Direction.Forwards, ...)`     |
| `ReadAllEventsBackwardAsync`    | `ReadAllAsync(Direction.Backwards, ...)`    |

```csharp
using KurrentDB.Client;

// Stream, forwards
await using var forward = client.ReadStreamAsync(
    Direction.Forwards, streamName, StreamPosition.Start
);

// Stream, backwards
await using var backward = client.ReadStreamAsync(
    Direction.Backwards, streamName, StreamPosition.End
);

// $all, forwards
await using var all = client.ReadAllAsync(Direction.Forwards, Position.Start);
```

### Positions are typed, not raw `long`

| TCP type                           | gRPC type                           |
|------------------------------------|-------------------------------------|
| `long` stream position             | `StreamPosition` (wraps `ulong`)    |
| `long?` checkpoint                 | `StreamPosition` / `FromStream`     |
| `Position` (`long` commit/prepare) | `Position` (`ulong` commit/prepare) |

`StreamPosition` has implicit conversions:

```csharp
StreamPosition pos = 100UL;
var fromRevision = StreamPosition.FromStreamRevision(streamRevision);
```

### Results are `IAsyncEnumerable` — no manual paging

**TCP shape (for recognition):** the legacy client forced a `do { page = await tcpConnection.ReadStreamEventsForwardAsync(stream, readFrom, pageSize, ...); ... readFrom = page.NextEventNumber; } while (!page.IsEndOfStream);` loop with a `SliceReadStatus.StreamNotFound` check. gRPC returns an `IAsyncEnumerable` that streams events one at a time, so paging disappears entirely:

```csharp
// ✅ gRPC — IAsyncEnumerable, no paging
using KurrentDB.Client;

public async Task<IReadOnlyList<object>> LoadEvents(string stream) {
    var result = client.ReadStreamAsync(Direction.Forwards, stream, StreamPosition.Start);

    if (await result.ReadState != ReadState.Ok)
        throw new ArgumentOutOfRangeException(nameof(stream), $"Stream '{stream}' was not found");

    return await result.Select(Deserialize).ToListAsync();
}
```

**Deadline gotcha:** the call still respects the client deadline (default 10 seconds). For very long streams either increase `defaultDeadline` on the connection string or fall back to explicit ranged reads.

### Deserialisation: data is `ReadOnlyMemory<byte>`, not `byte[]`

To avoid copies, gRPC exposes event payloads as `ReadOnlyMemory<byte>`. The fix is a one-character change in your deserialiser:

```csharp
object Deserialize(ResolvedEvent resolvedEvent) {
    var dataType = TypeMapper.GetType(resolvedEvent.Event.EventType);
-   var jsonData = Encoding.UTF8.GetString(resolvedEvent.Event.Data);
+   var jsonData = Encoding.UTF8.GetString(resolvedEvent.Event.Data.Span);
    return JsonConvert.DeserializeObject(jsonData, dataType)!;
}
```

## 8. Wire a Polly retry policy

The TCP client retried failed operations automatically (`KeepReconnecting`, `LimitRetriesForOperationTo`, `SetOperationTimeoutTo`). **gRPC has no built-in retries.** Every transient failure surfaces to the caller; absence of a retry layer is a reliability regression, not a style choice.

Wire Polly v8 (`Microsoft.Extensions.Resilience`) around every `AppendToStreamAsync` and `ReadStreamAsync` call. Make appends idempotent by setting a deterministic `Uuid` and a specific `StreamRevision` (not `StreamState.Any`); idempotency is a precondition to set up, not a property to evaluate.

**Subscriptions belong in a reconnect loop with persisted checkpoints, not in the retry pipeline.** Wrapping a subscription in a retry policy will replay the stream from scratch on every transient failure.

Retry policy is a hard requirement in "Required outcomes" at the top of this file; do not skip. The language-neutral contract and the .NET recipe (Polly v8) both live at [`../grpc-retry-policy.md`](../grpc-retry-policy.md).

## 9. Rewrite catch-up subscriptions with `SubscribeToStream` / `SubscribeToAll`

### One API per scope

The TCP client had a sprawl of subscription methods. gRPC collapses them to two:

| Scope         | TCP                                                                                            | gRPC                |
|---------------|------------------------------------------------------------------------------------------------|---------------------|
| Single stream | `SubscribeToStreamAsync`, `SubscribeToStreamFrom`, `FilteredSubscribeToStream...`              | `SubscribeToStream` |
| `$all`        | `SubscribeToAll`, `SubscribeToAllFrom`, `FilteredSubscribeToAll`, `FilteredSubscribeToAllFrom` | `SubscribeToAll`    |

Override defaults only when needed.

### Checkpoints use `FromStream` / `FromAll`

Where the TCP client took `long?`, gRPC uses dedicated start-position helpers:

```csharp
// ❌ TCP — nullable long checkpoint
long? checkpoint = GetLastCheckpoint();
tcpConnection.SubscribeToStreamFrom(streamName, checkpoint, resolveLinkTos: true, EventAppeared, SubscriptionDropped);
```

```csharp
// ✅ gRPC — FromStream
using KurrentDB.Client;

ulong? checkpoint = GetLastCheckpoint();
var start = checkpoint is null
    ? FromStream.Start
    : FromStream.After(new StreamPosition(checkpoint.Value));

await using var sub = client.SubscribeToStream(streamName, start, cancellationToken: ct);
```

The `$all` equivalent uses `FromAll.Start` / `FromAll.After(new Position(commit, prepare))`.

### Server-side filtering on `$all`

`FilteredSubscribeToAll*` and `CatchUpSubscriptionFilteredSettings` are gone; gRPC uses a single `SubscriptionFilterOptions`:

```csharp
// ❌ TCP
var filter = Filter.ExcludeSystemEvents;
var filteredSettings = CatchUpSubscriptionFilteredSettings.Default;
tcpConnection.FilteredSubscribeToAllFrom(position, filter, filteredSettings, EventAppeared, LiveProcessingStarted, SubscriptionDropped);
```

```csharp
// ✅ gRPC
using KurrentDB.Client;

var filter = new SubscriptionFilterOptions(EventTypeFilter.ExcludeSystemEvents());

await using var sub = client.SubscribeToAll(
    FromAll.Start,
    filterOptions: filter,
    cancellationToken: ct
);
```

### Detecting "now live" with `StreamMessage`

The TCP client took a `liveProcessingStarted` callback. The gRPC client emits this as a message in the subscription's `IAsyncEnumerable`. Use a `switch` on `StreamMessage` to react:

```csharp
using KurrentDB.Client;

await using var subscription = client.SubscribeToStream(streamName, FromStream.Start, cancellationToken: ct);

await foreach (var message in subscription.Messages.WithCancellation(ct)) {
    switch (message) {
        case StreamMessage.Event(var resolved):
            await HandleEvent(resolved);
            break;
        case StreamMessage.CaughtUp:
            Console.WriteLine("Subscription is now live");
            break;
        case StreamMessage.FellBehind:
            Console.WriteLine("Subscription has fallen back into catch-up");
            break;
    }
}
```

`StreamMessage.FellBehind` has no TCP equivalent; persist live/catch-up state from this branch if the application acts on it.

### Link-tos: default flipped to `false`

The TCP client resolved projection link events automatically. gRPC requires explicit opt-in:

```csharp
// Single stream
await using var sub = client.SubscribeToStream(
    streamName,
    FromStream.Start,
    resolveLinkTos: true,
    cancellationToken: ct
);

// $all
await using var subAll = client.SubscribeToAll(
    FromAll.Start,
    resolveLinkTos: true,
    cancellationToken: ct
);
```

**Audit every subscription** that consumed from `$ce-`, `$et-`, or any other system projection stream. If it does not pass `resolveLinkTos: true`, it will receive empty link events instead of the original event data.
