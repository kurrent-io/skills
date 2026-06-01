# Migrating the JVM client from TCP (EventStore.JVM) to the gRPC Java client (KurrentDB-Client-Java)

The legacy JVM client (`com.geteventstore:eventstore-client_2.13`, namespace `eventstore.*` / `eventstore.j.*`, actor-based on Akka) is end of life. **EventStoreDB v24.2 and later do not speak TCP at all.** Migrate to the gRPC Java client (`io.kurrent:kurrentdb-client`, namespace `io.kurrent.dbclient.*`).

Use this reference for **Java consumers** of EventStore.JVM. For pure Scala consumers, the API mapping is identical; substitute `scala.concurrent.Future` for `CompletableFuture`.

> **Scope: `EventStore.Akka.Persistence`.** If the project depends on [`EventStore.Akka.Persistence`](https://github.com/kurrent-io/EventStore.Akka.Persistence) (an Akka Persistence journal/snapshot plugin layered on the JVM TCP client), this reference is **not enough on its own**. The plugin is itself archived and pulls `eventstore-client_2.13` transitively, so swapping just the client leaves a journal stuck on the dead transport. Either rewrite the persistence layer against the gRPC Java client directly (the API maps cleanly onto Akka's `AsyncWriteJournal` contract) or treat KurrentDB as a downstream projection rather than the Akka journal (see the [Kurrent connectors](https://docs.kurrent.io/connectors/)). Budget for it separately; it is a larger piece of work than the client swap.

## Required outcomes

A complete migration produces all of:

- [ ] `com.geteventstore:eventstore-client_2.13` removed from the build; `io.kurrent:kurrentdb-client` referenced at the latest 1.x.
- [ ] Akka dependencies dropped if they were only there for the client.
- [ ] **The migrated module is referenced by the consuming application.** Check Gradle `include` / Maven `<modules>` so a migrated library does not compile in isolation as dead code.
- [ ] Connection string uses `kurrentdb://` or `kurrentdb+discover://`; `tls` set deliberately (not `tls=false` outside local dev).
- [ ] No literal `user:pass@` credentials in any connection string in source or in configuration committed to the repo. Credentials wired through `ConnectionSettingsBuilder#defaultCredentials` populated from configuration or a secret manager.
- [ ] `KurrentDBClient` registered as a singleton; no `ActorSystem`, no `ConnectionActor`, no `EsConnection`.
- [ ] All `eventstore.j.EventDataBuilder` usages replaced with `EventData.builderAsJson` / `builderAsBinary`.
- [ ] `expectAnyVersion()` / `expectNoStream()` / `expectVersion(long)` replaced with `StreamState.any()` / `StreamState.noStream()` / `.streamRevision(long)`.
- [ ] No `TransactionActor`, `TransactionStart`, `EsTransaction`, or `EsTransactionImpl` references; each transaction collapsed into a single `appendToStream(events…)` call.
- [ ] Paged reads collapsed into `ReadResult#getEvents()` consumers, or `readStreamReactive` for streams over ~10k events.
- [ ] **Retry policy wired around every append and read** (Resilience4j). Appends use deterministic event ids plus specific `streamRevision` so retries are idempotent; idempotency is a precondition to set up, not a property to evaluate.
- [ ] Subscriptions wrapped in a reconnect loop with checkpoint persistence (not in a retry policy).
- [ ] Every catch-up subscription audited for `.resolveLinkTos()` and the new `onCaughtUp` / `onFellBehind` callbacks.
- [ ] `client.shutdown()` wired into application shutdown (Spring `@PreDestroy`, JVM hook, etc.).
- [ ] Project targets Java 8 or later.

The rest of this file is the per-operation implementation reference.

## 1. Replace the artifact and drop Akka

### JDK target

| Client                 | Minimum JDK             | Notes                                              |
|------------------------|-------------------------|----------------------------------------------------|
| Legacy (EventStore.JVM) | Java 8, Scala 2.12/2.13 | Pulls in Akka 2.6.x as a hard runtime dependency   |
| gRPC (Java client)     | Java 8                  | No Akka, no Scala stdlib, no actor system required |

### Replace the artifact

The package coordinates change and **the Scala suffix disappears**. The new client is pure Java and is published once, not once per Scala major.

**Gradle (`build.gradle`):**

```diff
 dependencies {
-    implementation 'com.geteventstore:eventstore-client_2.13:7.4.0'
+    implementation 'io.kurrent:kurrentdb-client:1.2.+'
 }
```

**Always pin to the latest `kurrentdb-client` minor.** The package ships server feature coverage and bug fixes much faster than the TCP client ever did.

**Maven (`pom.xml`):**

```diff
 <dependencies>
-    <dependency>
-        <groupId>com.geteventstore</groupId>
-        <artifactId>eventstore-client_2.13</artifactId>
-        <version>7.4.0</version>
-    </dependency>
+    <dependency>
+        <groupId>io.kurrent</groupId>
+        <artifactId>kurrentdb-client</artifactId>
+        <version>1.2.0</version>
+    </dependency>
 </dependencies>
```

**sbt (`build.sbt`):**

```diff
-libraryDependencies += "com.geteventstore" %% "eventstore-client" % "7.4.0"
+libraryDependencies += "io.kurrent" % "kurrentdb-client" % "1.2.0"
```

Use single `%` (not `%%`) for the new artifact: sbt's `%%` appends `_2.13` to the artifact id, and the gRPC client is not cross-built.

### Legacy artifact reality

The last published release on Maven Central is `com.geteventstore:eventstore-client_2.13:8.0.1`, which **predates the 23.10 server**. Projects connecting to 22.10 or 23.10 were typically given a per-tenant jar built from the [`yoeight/fix-client-22.10` branch](https://github.com/kurrent-io/EventStore.JVM/tree/yoeight/fix-client-22.10) (`8.0.2-SNAPSHOT`), distributed manually because Kurrent does not own the `com.geteventstore` coordinates on Sonatype and cannot cut official releases. There is no plan to publish further versions; the [`EventStore.JVM`](https://github.com/kurrent-io/EventStore.JVM) repository is end-of-life and slated for archival. If the project currently pins a `-SNAPSHOT` build or a vendored jar, treat that as a signal to migrate, not a target to upgrade.

### Drop Akka

Akka was a transitive dependency of the TCP client. If Akka has other callers in the project, leave it alone; the gRPC client coexists with a running `ActorSystem` without using it. If Akka has no other callers, remove these once the client migration is complete:

```diff
-implementation 'com.typesafe.akka:akka-actor_2.13:2.6.17'
-implementation 'com.typesafe.akka:akka-stream_2.13:2.6.17'
```

## 2. Stage the migration

Do not big-bang. Run both clients side by side and cut over operation by operation.

1. Add `io.kurrent:kurrentdb-client` to the build, leave `eventstore-client_2.13` in place.
2. Migrate operations in dependency order: appends and reads first, then catch-up subscriptions, then persistent subscriptions. Transactions collapse during the append migration (see "Breaking: transactions are removed" under section 6).
3. Remove the legacy artifact (and Akka, if it was only there for the client) once nothing imports `eventstore.*`.

### Stage the client migration before the v24.2+ server upgrade

If KurrentDB is upgraded **before** the JVM client is retired, the legacy TCP client breaks against v24.2 and later, typically at the TLS handshake:

```text
System.Security.Authentication.AuthenticationException:
  Cannot determine the frame size or a corrupted frame was received.
```

The two TLS escape hatches that older deployments relied on are gone:

| Knob                           | Status                                                                                                                                                                |
|--------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Server `DisableExternalTcpTls: true` | **Removed in v24.2.** Unwired in [KurrentDB#4113](https://github.com/kurrent-io/KurrentDB/pull/4113), removed in [KurrentDB#4153](https://github.com/kurrent-io/KurrentDB/pull/4153). |
| Client `ValidateServer=false`  | Never existed on the JVM client; that switch was only ever on the .NET TCP client.                                                                                    |

**Workaround for the migration window** (validated against v24.10.6): configure the JVM client through `src/main/resources/application.conf`, not `SettingsBuilder`. The builder does **not** expose TLS; only the typesafe-config path does (see [`reference.conf#L16`](https://github.com/kurrent-io/EventStore.JVM/blob/e57d27dcf993734618768589848f83f567b753ac/core/src/main/resources/reference.conf#L16) and the `ssl-config` block at [`#L22`](https://github.com/kurrent-io/EventStore.JVM/blob/e57d27dcf993734618768589848f83f567b753ac/core/src/main/resources/reference.conf#L22)).

```hocon
# src/main/resources/application.conf
eventstore {
  address {
    host = "kurrentdb.example.com"
    port = 1113
  }
  enable-tcp-tls = true
}
```

TLS 1.3 against KurrentDB has not been verified for this client. If TLS still fails, there are two options and no third: run the cluster `Insecure: true` cluster-wide (disables all TLS **and** ACLs; not production-safe), or finish the migration.

**Therefore: retire the JVM client first, then upgrade the server.** Migrating against a healthy 23.10 cluster is far cheaper than fighting TLS on a dead client while the server has already moved on.

### Wrap the client to make cutover boring

Centralise client calls behind a thin interface so each step is a one-file change inside the wrapper. This is Martin Fowler's [preparatory refactoring](https://martinfowler.com/articles/preparatory-refactoring-example.html) applied to KurrentDB.

```java
// TCP-backed implementation: what you have today
public class EventStore {
    private final ActorSystem  system;
    private final EsConnection connection;
    private final ObjectMapper mapper;

    public EventStore(ActorSystem system, EsConnection connection, ObjectMapper mapper) {
        this.system     = system;
        this.connection = connection;
        this.mapper     = mapper;
    }

    public CompletionStage<Void> appendEvents(String streamName, long version, Object... events) {
        List<EventData> prepared = Arrays.stream(events)
            .map(this::toEventData)
            .collect(Collectors.toList());

        WriteEvents msg = new WriteEventsBuilder(streamName)
            .addEvents(prepared)
            .expectVersion(version)
            .build();

        // bridge actor reply to a CompletionStage
        return PatternsCS.ask(connectionActor, msg, 5_000)
            .thenApply(reply -> null);
    }

    private EventData toEventData(Object event) {
        try {
            return new EventDataBuilder(event.getClass().getSimpleName())
                .eventId(UUID.randomUUID())
                .jsonData(mapper.writeValueAsString(event))
                .build();
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }
}
```

Replace the implementation with the gRPC version (covered below); callers stay unchanged.

## 3. Construct `KurrentDBClient` as a singleton

### Replace `ConnectionActor` / `EsConnection`

The legacy client offered two APIs and neither survives:

```java
// ❌ TCP, actor-based
ActorSystem system     = ActorSystem.create();
Settings    settings   = new SettingsBuilder()
    .address(new InetSocketAddress("127.0.0.1", 1113))
    .build();
ActorRef    connection = system.actorOf(ConnectionActor.getProps(settings));

// or the Future-style facade
EsConnection facade = EsConnectionFactory.create(system);
Future<Event> result = facade.readEvent("my-stream", new EventNumber.Exact(0), false, null);
```

gRPC drops the actor system entirely. Construction is synchronous, returns a single client object, and the client is **thread-safe to share as a singleton**:

```java
// ✅ gRPC: synchronous construction, no ActorSystem
import io.kurrent.dbclient.*;

KurrentDBClientSettings settings = KurrentDBConnectionString.parseOrThrow(connectionString);
KurrentDBClient client = KurrentDBClient.create(settings);
```

### Bridge `scala.concurrent.Future` once

`EsConnection` returns `scala.concurrent.Future<T>`, which is painful to consume from Java. During the migration window, bridge it to `CompletableFuture` so the wrapper interface can be migrated independently of the underlying client:

```java
import scala.compat.java8.FutureConverters;

CompletableFuture<Event> bridged = FutureConverters
    .toJava(facade.readEvent("my-stream", new EventNumber.Exact(0), false, null))
    .toCompletableFuture();
```

After the migration the bridge disappears: every `KurrentDBClient` method already returns `CompletableFuture`.

### Register once in DI

The Java client has no async setup. In Spring, Micronaut, Guice, etc. register a singleton:

```java
@Bean
public KurrentDBClient kurrentDbClient(@Value("${kurrentdb.connectionString}") String cs) {
    return KurrentDBClient.create(KurrentDBConnectionString.parseOrThrow(cs));
}
```

### Resource cleanup

```java
// ❌ TCP: shut down the actor system
Await.result(system.terminate(), Duration.create(5, TimeUnit.SECONDS));
```

```java
// ✅ gRPC: close the client
client.shutdown().get();
```

`KurrentDBClient#shutdown()` returns `CompletableFuture<Void>`; call it during application shutdown (Spring `@PreDestroy`, a JVM shutdown hook, etc.) and `.get()` / `.join()` to wait for the close to finish. After shutdown `isShutdown()` returns `true` and pending operations complete exceptionally.

## 4. Rewrite the connection string

The legacy URI scheme is **not compatible** with gRPC. Replace `tcp://host:1113` with one of:

```
kurrentdb://localhost:2113
kurrentdb+discover://node1:2113,node2:2113,node3:2113
```

- `kurrentdb://` connects to specific endpoints; the client queries each node's Gossip API for cluster topology then picks one per the configured node preference.
- `kurrentdb+discover://` uses DNS or gossip seeds for cluster discovery, useful when an A record fronts the cluster.

The Java client also accepts the historical `esdb://` and `esdb+discover://` schemes; prefer `kurrentdb://` for new configuration.

> **Credentials handling.** The parser accepts `user:pass@` in the URI, but **never** embed real credentials in source or in samples copied from this reference. Migration agents read these examples as templates; a literal `admin:changeit@` from a sample ends up in committed code. Pass credentials through `ConnectionSettingsBuilder#defaultCredentials(UserCredentials)` populated from configuration or a secret manager, or via the SDK's per-call overload that takes `UserCredentials`. Treat these snippets as **structural** examples only.

### Common query parameters

| Parameter                                | Default     | Notes                                                           |
|------------------------------------------|-------------|-----------------------------------------------------------------|
| `tls`                                    | `true`      | Set `tls=false` for local insecure development only             |
| `nodePreference`                         | `leader`    | `leader` / `follower` / `random` / `readOnlyReplica`            |
| `defaultDeadline`                        | none        | Client-wide operation deadline (ms); overridable per call       |
| `keepAliveInterval` / `keepAliveTimeout` | `10s` / `10s` | Both expressed in milliseconds                                |
| `discoveryInterval`                      | `100ms`     | Gossip refresh interval                                         |
| `gossipTimeout`                          | `3s`        | Per-node gossip timeout                                         |

Prefer connection strings on both sides of the migration: a single configuration entry centralises the eventual swap.

### No more reconnect knobs

Legacy `Settings` exposed `connectionTimeout`, `maxReconnections`, `reconnectionDelayMin/Max`, `operationTimeout`, `operationMaxRetries`. gRPC manages reconnection internally and does **not** retry failed operations. If retry behaviour is needed, see "Wire a Resilience4j retry policy" below.

## 5. Enforce TLS and externalize credentials

KurrentDB is secure by default since 20.6 and the Java client follows that posture.

```
# ✅ Secure (production). Credentials come from configuration / secret manager,
#    NOT from a literal user:pass@ in source. The connection string just specifies the host.
kurrentdb://cluster.example.com:2113

# ⚠️ Insecure, local dev only. ACLs are NOT enforced over insecure connections.
kurrentdb://localhost:2113?tls=false
```

**Insecure mode disables ACL checks entirely.** Never deploy with `tls=false`.

Per-call credential overrides flow through the options builders:

```java
UserCredentials credentials = new UserCredentials(user, pass); // from configuration

AppendToStreamOptions options = AppendToStreamOptions.get()
    .authenticated(credentials);

client.appendToStream("some-stream", options, eventData).get();
```

> Code samples in this reference are read by migration agents as templates. Examples deliberately omit `user:pass@` from connection strings so an agent does not copy a hard-coded default credential into the migrated project. Wire credentials through `ConnectionSettingsBuilder#defaultCredentials` populated from configuration, never from source.

## 6. Rewrite appends with `EventData.builderAsJson` and `StreamState`

### `EventData` changes

| Field        | TCP (`eventstore.j.EventDataBuilder`) | gRPC (`io.kurrent.dbclient.EventData`)                |
|--------------|---------------------------------------|-------------------------------------------------------|
| Event id     | `.eventId(UUID)`                      | First positional `UUID` arg to `builderAsJson`        |
| Content type | `.jsonData(...)` vs `.data(byte[])`   | `builderAsJson` vs `builderAsBinary` (explicit pair)  |
| Data payload | `String` or `byte[]`                  | `byte[]` only                                         |
| Builder      | `EventDataBuilder("type").build()`    | `EventData.builderAsJson(uuid, type, bytes).build()`  |
| Package      | `eventstore.j.EventDataBuilder`       | `io.kurrent.dbclient.EventData`                       |

**JSON payload, TCP:**

```java
import eventstore.j.EventDataBuilder;
import eventstore.core.EventData;

EventData event = new EventDataBuilder("user-registered")
    .eventId(UUID.randomUUID())
    .jsonData(objectMapper.writeValueAsString(payload))
    .jsonMetadata(objectMapper.writeValueAsString(metadata))
    .build();
```

**JSON payload, gRPC:**

```java
import io.kurrent.dbclient.EventData;

EventData event = EventData
    .builderAsJson(
        UUID.randomUUID(),
        "user-registered",
        objectMapper.writeValueAsBytes(payload)
    )
    .metadataAsBytes(objectMapper.writeValueAsBytes(metadata))
    .build();
```

**Binary payload, gRPC:**

```java
EventData event = EventData
    .builderAsBinary(
        UUID.randomUUID(),
        "user-registered",
        serialize(payload)
    )
    .build();
```

**Supported content types today: `application/json` and `application/octet-stream`.** Other values are reserved for future use.

### Optimistic concurrency: `ExpectedVersion` becomes `StreamState`

| TCP (`WriteEventsBuilder`)               | gRPC (`StreamState` / `AppendToStreamOptions`)             | Meaning                             |
|------------------------------------------|------------------------------------------------------------|-------------------------------------|
| `.expectAnyVersion()`                    | `StreamState.any()`                                        | No optimistic check                 |
| `.expectNoStream()`                      | `StreamState.noStream()`                                   | Stream must not exist               |
| `.expectVersion(long)`                   | `StreamState.streamRevision(long)` or `.streamRevision(long)` on the options | Specific revision                   |

**`StreamState.streamExists()`** is new; the legacy client had no equivalent.

`AppendToStreamOptions` exposes two equivalent setters: `.streamState(StreamState)` accepts any of the sentinels, while `.streamRevision(long)` is shorthand for the numeric case.

### Append the events

**TCP, actor-based:**

```java
ActorSystem system    = ActorSystem.create();
ActorRef connection   = system.actorOf(ConnectionActor.getProps());

EventData event = new EventDataBuilder("user-registered")
    .eventId(UUID.randomUUID())
    .jsonData("{\"id\":42}")
    .build();

WriteEvents writeEvents = new WriteEventsBuilder("user-42")
    .addEvent(event)
    .expectAnyVersion()
    .build();

// fire-and-forget the message; a reply actor handles WriteEventsCompleted / Failure
connection.tell(writeEvents, replyActor);
```

**gRPC, direct call:**

```java
import io.kurrent.dbclient.*;

EventData event = EventData
    .builderAsJson(UUID.randomUUID(), "user-registered", objectMapper.writeValueAsBytes(payload))
    .build();

AppendToStreamOptions options = AppendToStreamOptions.get()
    .streamState(StreamState.any());

WriteResult result = client.appendToStream("user-42", options, event).get();
```

`WriteResult#getNextExpectedRevision` replaces `WriteEventsCompleted#numbersRange`. Success and failure both flow through `CompletableFuture<WriteResult>`; no reply actor.

### Breaking: transactions are removed

Transactions (`TransactionActor` with `Start` / `Write` / `Commit` / `GetTransactionId` messages, plus the `EsTransactionImpl` Future facade) are **removed** in gRPC. The replacement is a single `appendToStream` call with the full event batch, which is atomic at the stream level. Legacy transactions were always single-stream (`TransactionStart` takes one stream id), so this is a mechanical swap, not an architectural change.

#### Before (TCP)

```java
ActorRef connection  = system.actorOf(ConnectionActor.props(), "connection");
ActorRef transaction = system.actorOf(
    TransactionActor.props(connection, new Start(new TransactionStart(EventStream.Id("order-7")))),
    "transaction"
);

transaction.tell(new Write(orderPlacedEvent), replyActor);     // → WriteCompleted
transaction.tell(new Write(paymentReceivedEvent), replyActor); // → WriteCompleted
transaction.tell(new Write(shipmentRequestedEvent), replyActor); // → WriteCompleted
transaction.tell(Commit$.MODULE$, replyActor);                 // → CommitCompleted
```

#### After (gRPC)

```java
client.appendToStream(
    "order-7",
    AppendToStreamOptions.get().streamState(StreamState.any()),
    orderPlacedEvent,
    paymentReceivedEvent,
    shipmentRequestedEvent
).get();
```

If concurrency control matters, pass `.streamRevision(currentRevision)` instead of `StreamState.any()` and re-read on `WrongExpectedVersionException`.

Any remaining `TransactionActor`, `TransactionStart`, `EsTransaction`, or `TransactionActor.Start` reference is a BLOCKER: the call site will not compile against `io.kurrent.dbclient.*` because the API is gone.

## 7. Rewrite reads with `ReadStreamOptions` / `ReadAllOptions`

### Direction is a builder method, not a message type

| TCP                                                                                              | gRPC                                              |
|--------------------------------------------------------------------------------------------------|---------------------------------------------------|
| `new ReadStreamEventsBuilder(stream).forward()` / `.backward()`                                  | `ReadStreamOptions.get().forwards()` / `.backwards()` |
| `new ReadAllEventsBuilder().forward()` / `.backward()`                                            | `ReadAllOptions.get().forwards()` / `.backwards()`  |
| Per-call `ReadDirection.Forward` / `ReadDirection.Backward` in the underlying message            | (folded into the options)                          |

```java
import io.kurrent.dbclient.*;

// Stream, forwards from the start
ReadStreamOptions forwards = ReadStreamOptions.get()
    .forwards()
    .fromStart()
    .maxCount(4096);

ReadResult result = client.readStream("user-42", forwards).get();

// Stream, backwards from the end
ReadResult tail = client.readStream(
    "user-42",
    ReadStreamOptions.get().backwards().fromEnd().maxCount(1)
).get();

// $all, forwards
ReadResult all = client.readAll(ReadAllOptions.get().forwards().fromStart()).get();
```

### Positions are typed helpers, not raw `long`

| TCP                                       | gRPC                                                |
|-------------------------------------------|-----------------------------------------------------|
| `new EventNumber.Exact(n)`                | `.fromRevision(n)` on `ReadStreamOptions`           |
| `EventNumber.First` / `EventNumber.Last`  | `.fromStart()` / `.fromEnd()`                       |
| `new Position(commit, prepare)`           | `new Position(commit, prepare)` (still present)     |
| `Position.First` / `Position.Last`        | `.fromStart()` / `.fromEnd()` on `ReadAllOptions`   |

### Results: list iteration or Reactive Streams

The legacy client paged events via a reply actor; the Java client returns the whole page in a `ReadResult` and exposes a `Publisher<ReadMessage>` for very large reads.

**TCP shape (for recognition):** the legacy client sent `new ReadStreamEventsBuilder(stream).fromNumber(next).maxCount(N).forward().build()` to the connection actor and matched `ReadStreamEventsCompleted` in an `AbstractActor`, re-sending with `m.nextEventNumber().value()` until `m.endOfStream()`. Replace the whole actor loop with one of the gRPC variants below.

**gRPC, list iteration:**

```java
ReadStreamOptions options = ReadStreamOptions.get().forwards().fromStart();
ReadResult result = client.readStream("user-42", options).get();

for (ResolvedEvent resolvedEvent : result.getEvents()) {
    RecordedEvent recordedEvent = resolvedEvent.getOriginalEvent();
    Object event = objectMapper.readValue(
        recordedEvent.getEventData(),
        typeRegistry.lookup(recordedEvent.getEventType())
    );
    handle(event);
}
```

**gRPC, Reactive Streams for unbounded reads:**

```java
import org.reactivestreams.Publisher;

Publisher<ReadMessage> publisher = client.readStreamReactive("user-42", options);
publisher.subscribe(new Subscriber<ReadMessage>() {
    @Override public void onSubscribe(org.reactivestreams.Subscription s) { s.request(Long.MAX_VALUE); }
    @Override public void onNext(ReadMessage message)                     { handle(message.getEvent()); }
    @Override public void onError(Throwable t)                            { /* … */ }
    @Override public void onComplete()                                    { /* … */ }
});
```

Use `readStreamReactive` when the stream exceeds ~10k events or when downstream needs backpressure. Otherwise use `readStream` with `getEvents()`.

### Stream-not-found is an exception, not a `Status` enum

The TCP client wrapped status into a `Failure(StreamNotFoundException)` message. The Java client throws when you call `.get()`:

```java
try {
    ReadResult result = client.readStream("user-42", options).get();
} catch (ExecutionException e) {
    if (e.getCause() instanceof StreamNotFoundException) {
        // stream does not exist
    } else {
        throw e;
    }
}
```

### Event payloads are `byte[]`, not `ByteString`

`RecordedEvent#getEventData()` returns a plain `byte[]` ready for `ObjectMapper#readValue(byte[], Class)`; no Scala `ByteString` indirection.

## 8. Wire a Resilience4j retry policy

The legacy client retried inside the Akka actor (`operationMaxRetries`, `maxReconnections`, supervised restart). **gRPC has no built-in retries.** Every transient failure surfaces to the caller; absence of a retry layer is a reliability regression, not a style choice.

Wire [Resilience4j](https://resilience4j.readme.io/) around every `appendToStream` and `readStream` call. Retry on `StatusRuntimeException` codes `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `ABORTED` with exponential backoff plus jitter. Make appends idempotent by setting a deterministic event id and a specific `streamRevision` (not `StreamState.any()`); idempotency is a precondition to set up, not a property to evaluate.

**Subscriptions belong in a reconnect loop with persisted checkpoints, not in the retry pipeline.** Wrapping a subscription in a retry policy will replay the stream from scratch on every transient failure.

Retry policy is a hard requirement in "Required outcomes" at the top of this file; do not skip. The language-neutral contract lives at [`../grpc-retry-policy.md`](../grpc-retry-policy.md).

## 9. Rewrite catch-up subscriptions with `SubscriptionListener`

### One API per scope

The legacy client exposed `connection.subscribeToStream`, `subscribeToStreamFrom`, `subscribeToAll`, `subscribeToAllFrom` plus separate `SubscriptionActor` / `StreamSubscriptionActor` props. The Java client collapses subscriptions to two methods:

| Scope         | TCP                                                                                     | gRPC                          |
|---------------|-----------------------------------------------------------------------------------------|-------------------------------|
| Single stream | `connection.subscribeToStream` / `.subscribeToStreamFrom`                               | `client.subscribeToStream`    |
| `$all`        | `connection.subscribeToAll` / `.subscribeToAllFrom`                                     | `client.subscribeToAll`       |

### Callbacks: `SubscriptionObserver` becomes `SubscriptionListener`

| `SubscriptionObserver` (TCP)                | `SubscriptionListener` (gRPC)                            |
|---------------------------------------------|----------------------------------------------------------|
| `onEvent(IndexedEvent, Closeable)`          | `onEvent(Subscription, ResolvedEvent)`                   |
| `onLiveProcessingStart(Closeable)`          | `onCaughtUp(Subscription, Instant, Long, Position)`      |
| (none)                                      | `onFellBehind(Subscription, Instant, Long, Position)`    |
| `onError(Throwable)`                        | `onCancelled(Subscription, Throwable)`                   |
| `onClose()`                                 | `onCancelled(Subscription, null)`                        |
| (none)                                      | `onConfirmation(Subscription)`                           |

`onFellBehind` has no TCP equivalent; persist live/catch-up state from this callback if the application acts on it.

**TCP, `subscribeToAll` from the README:**

```java
import eventstore.j.EsConnectionFactory;
import eventstore.core.IndexedEvent;
import eventstore.akka.SubscriptionObserver;

EsConnection connection = EsConnectionFactory.create(system);
Closeable closeable = connection.subscribeToAll(new SubscriptionObserver<IndexedEvent>() {
    @Override public void onLiveProcessingStart(Closeable s)     { /* now live */ }
    @Override public void onEvent(IndexedEvent e, Closeable s)   { handle(e); }
    @Override public void onError(Throwable t)                   { /* … */ }
    @Override public void onClose()                              { /* shutdown */ }
}, false, null);
```

**gRPC, `subscribeToAll`:**

```java
import io.kurrent.dbclient.*;

CompletableFuture<Subscription> handle = client.subscribeToAll(
    new SubscriptionListener() {
        @Override
        public void onEvent(Subscription subscription, ResolvedEvent event) {
            handle(event);
        }

        @Override
        public void onCaughtUp(Subscription subscription, Instant ts, Long rev, Position pos) {
            // subscription is now live
        }

        @Override
        public void onFellBehind(Subscription subscription, Instant ts, Long rev, Position pos) {
            // subscription has fallen back into catch-up
        }

        @Override
        public void onCancelled(Subscription subscription, Throwable exception) {
            if (exception != null) reconnect();
        }
    },
    SubscribeToAllOptions.get().fromStart()
);
```

### Checkpoints

Where the TCP client took `Some(long)` / `None` for the last-known position, the Java client uses position helpers on the options:

```java
// $all subscription from a persisted position
Position checkpoint = loadCheckpoint();
client.subscribeToAll(
    listener,
    SubscribeToAllOptions.get().fromPosition(checkpoint)
);

// Stream subscription from a persisted revision
long revision = loadRevision();
client.subscribeToStream(
    "user-42",
    listener,
    SubscribeToStreamOptions.get().fromRevision(revision)
);
```

Persist the checkpoint inside `onEvent` **after** handling the event, not before, or a crash mid-handler will skip events on restart.

### Server-side filtering on `$all`

Legacy filtering required a custom `SubscriptionActor.Settings` plus a server-side regex. The Java client exposes a builder:

```java
SubscriptionFilter filter = SubscriptionFilter.newBuilder()
    .addEventTypePrefix("user-")
    .build();

client.subscribeToAll(
    listener,
    SubscribeToAllOptions.get().filter(filter)
);
```

`SubscriptionFilter#withEventTypeRegularExpression`, `addStreamNamePrefix`, and `withStreamNameRegularExpression` are also available.

### Link-tos: default is `false`

The legacy client's `subscribeToAll(observer, resolveLinkTos, credentials)` had `resolveLinkTos` as a required parameter, so it was hard to miss. The Java client defaults to `false`:

```java
// Required for $ce-*, $et-*, and other projection streams
SubscribeToStreamOptions options = SubscribeToStreamOptions.get()
    .fromStart()
    .resolveLinkTos();
```

**Audit every subscription** that consumed from `$ce-`, `$et-`, or any other system projection stream. If it does not call `.resolveLinkTos()`, it will receive empty link events instead of the original event data.

## 10. Move persistent subscriptions to `KurrentDBPersistentSubscriptionsClient`

Persistent subscriptions move to a **separate client**, fetched from the main client:

```java
KurrentDBPersistentSubscriptionsClient persistent =
    client.getPersistentSubscriptionsClient();
```

| TCP                                                                                  | gRPC                                                                          |
|--------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| `PersistentSubscriptionActor` props + `ConnectTo` message                            | `persistent.subscribeToStream(stream, group, listener)`                       |
| Create via `CreatePersistentSubscription` admin message                              | `persistent.createToStream(stream, group, CreatePersistentSubscriptionToStreamOptions.get().fromStart())` |
| Ack via `OperationData` reply                                                        | `subscription.ack(event)` inside the listener                                 |
| Nack via `Nak` message                                                               | `subscription.nack(NackAction.Park, message, event)`                          |

```java
persistent.createToStream(
    "user-42",
    "billing-workers",
    CreatePersistentSubscriptionToStreamOptions.get().fromStart()
);

persistent.subscribeToStream(
    "user-42",
    "billing-workers",
    new PersistentSubscriptionListener() {
        @Override
        public void onEvent(PersistentSubscription subscription, int retryCount, ResolvedEvent event) {
            try {
                handle(event);
                subscription.ack(event);
            } catch (Exception ex) {
                subscription.nack(NackAction.Park, ex.getMessage(), event);
            }
        }

        @Override
        public void onCancelled(PersistentSubscription subscription, Throwable exception) {
            if (exception != null) reconnect();
        }
    }
);
```

`createToAll` / `subscribeToAll` exist on the persistent client for `$all` subscriptions (a feature the legacy client did not support at all).
