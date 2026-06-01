# Rebranding the Java gRPC client from EventStoreDB to KurrentDB

EventStoreDB rebranded to **KurrentDB** in 2025. Java gRPC client shipped [v1.0.0 of `io.kurrent:kurrentdb-client`](https://github.com/kurrent-io/KurrentDB-Client-Java/releases/tag/v1.0.0). Wire protocol, event model, and API shape are unchanged. Migration = artifact rename + package rename + class rename + two API breaks (`expectedRevision` → `streamState`, exception fields).

Scope: projects on the EventStoreDB Java gRPC client (`com.eventstore:db-client-java`, namespace `com.eventstore.dbclient.*`). Projects on the legacy Akka/Scala TCP JVM client (`com.geteventstore:eventstore-client_2.13`, namespace `eventstore.*` / `eventstore.j.*`) use [`../tcp-to-grpc/jvm.md`](../tcp-to-grpc/jvm.md) instead.

## Source-artifact matrix

Read build files before classifying. `com.eventstore:db-client-java` (gRPC) and `com.geteventstore:eventstore-client_2.13` (TCP) are unrelated clients; misclassification produces silent compile failures.

| Found in the build                                                                    | Classification    | Action                                                                              |
|---------------------------------------------------------------------------------------|-------------------|-------------------------------------------------------------------------------------|
| `com.geteventstore:eventstore-client_2.13` (or `eventstore-client_2.12`)              | Legacy JVM TCP    | **STOP.** Load [`../tcp-to-grpc/jvm.md`](../tcp-to-grpc/jvm.md).                     |
| `com.eventstore:db-client-java`                                                       | EventStoreDB gRPC | Continue here.                                                                      |
| `io.kurrent:kurrentdb-client` only                                                    | Current gRPC      | Nothing to do. Use `kurrent-docs`.                                                  |

Both `com.eventstore:db-client-java` and `io.kurrent:kurrentdb-client` present = mid-migration: finish rebrand, then remove the old dependency.

Read every `build.gradle` / `build.gradle.kts` / `pom.xml`, every `dependencyManagement` block, and every Gradle version catalog (`libs.versions.toml`) before any rename. Bulk find-and-replace before the matrix check leaves the project unable to resolve either side.

| Topic                                                                                | When to read                                                                |
|--------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| [Artifact swap](#1-replace-the-artifact)                                             | First step. Maven/Gradle coordinates change.                                |
| [Package and class renames](#2-package-and-class-renames)                            | Mechanical, after the artifact swap.                                        |
| [Connection string](#3-connection-string-esdb-and-kurrentdb)                         | `kurrentdb://` preferred; `esdb://` still parses.                           |
| [Expected revision API](#4-expected-revision-expectedrevision-collapses-into-streamstate) | Breaking. `ExpectedRevision` removed; `streamState(...)` replaces `expectedRevision(...)`. |
| [`WrongExpectedVersionException` field rename](#5-wrongexpectedversionexception-field-rename) | Breaking. `getExpectedVersion()` / `getNextExpectedVersion()` → `getExpectedState()` / `getActualState()`. |
| [Spring registration](#6-spring-registration)                                        | If autowired. Type rename only.                                             |
| [Checklist](#rebrand-checklist)                                                      | Final verification.                                                         |

## 1. Replace the artifact

Current client: [`io.kurrent:kurrentdb-client`](https://central.sonatype.com/artifact/io.kurrent/kurrentdb-client). Single artifact: persistent subscriptions and projection management live inside the same jar.

**Gradle (Groovy DSL)**:

```groovy
dependencies {
-   implementation 'com.eventstore:db-client-java:5.+'
+   implementation 'io.kurrent:kurrentdb-client:1.+'
}
```

**Gradle (Kotlin DSL)**:

```kotlin
dependencies {
-   implementation("com.eventstore:db-client-java:5.+")
+   implementation("io.kurrent:kurrentdb-client:1.+")
}
```

**Maven**:

```xml
<dependency>
-   <groupId>com.eventstore</groupId>
-   <artifactId>db-client-java</artifactId>
-   <version>5.4.5</version>
+   <groupId>io.kurrent</groupId>
+   <artifactId>kurrentdb-client</artifactId>
+   <version>1.2.0</version>
</dependency>
```

**Pin to the latest 1.x minor.** Server-feature coverage and bug fixes land faster on the rebranded artifact. Examples: multi-stream append (`multiStreamAppend`) and the new `AppendRecords` operation ship only on `io.kurrent:kurrentdb-client`.

Drop the old dependency in the same commit as the rename. Leaving both compiles because packages differ, but duplicate transitive `grpc-netty-shaded` and `protobuf-java` pulls confuse classpath resolution and emit duplicate gRPC service descriptor warnings at startup.

## 2. Package and class renames

Every class, settings type, and package gains the `io.kurrent.dbclient` root. Run find-and-replace **after** the artifact swap. API shape and method signatures unchanged; only type and package names move.

| EventStoreDB gRPC (Java)                                  | KurrentDB (Java)                                       |
|-----------------------------------------------------------|--------------------------------------------------------|
| `import com.eventstore.dbclient.*;`                       | `import io.kurrent.dbclient.*;`                        |
| `EventStoreDBClient`                                      | `KurrentDBClient`                                      |
| `EventStoreDBClientSettings`                              | `KurrentDBClientSettings`                              |
| `EventStoreDBConnectionString`                            | `KurrentDBConnectionString`                            |
| `EventStoreDBPersistentSubscriptionsClient`               | `KurrentDBPersistentSubscriptionsClient`               |
| `EventStoreDBProjectionManagementClient`                  | `KurrentDBProjectionManagementClient`                  |

**Unchanged**: `EventData`, `EventDataBuilder`, `UserCredentials`, `Position`, `Direction`, `ReadResult`, `ReadStreamOptions`, `ResolvedEvent`, `RecordedEvent`, `SubscriptionListener`, `Checkpointer`, `WrongExpectedVersionException`, `StreamNotFoundException`, and all method names (`appendToStream`, `readStream`, `readAll`, `subscribeToStream`, `subscribeToAll`, etc.). Scope find-and-replace to the symbols in the table and the `com.eventstore.dbclient` package prefix only. Do not rename `EventData` or method bodies.

### Client construction

```java
// EventStoreDB gRPC
- import com.eventstore.dbclient.EventStoreDBClient;
- import com.eventstore.dbclient.EventStoreDBClientSettings;
- import com.eventstore.dbclient.EventStoreDBConnectionString;
-
- EventStoreDBClientSettings settings =
-     EventStoreDBConnectionString.parseOrThrow(connectionString);
- EventStoreDBClient client = EventStoreDBClient.create(settings);

// KurrentDB
+ import io.kurrent.dbclient.KurrentDBClient;
+ import io.kurrent.dbclient.KurrentDBClientSettings;
+ import io.kurrent.dbclient.KurrentDBConnectionString;
+
+ KurrentDBClientSettings settings =
+     KurrentDBConnectionString.parseOrThrow(connectionString);
+ KurrentDBClient client = KurrentDBClient.create(settings);
```

### Persistent subscriptions client

```java
// EventStoreDB gRPC
- EventStoreDBPersistentSubscriptionsClient psc =
-     EventStoreDBPersistentSubscriptionsClient.create(
-         EventStoreDBConnectionString.parseOrThrow(connectionString));

// KurrentDB
+ KurrentDBPersistentSubscriptionsClient psc =
+     KurrentDBPersistentSubscriptionsClient.create(
+         KurrentDBConnectionString.parseOrThrow(connectionString));
```

### Projection management client

```java
// EventStoreDB gRPC
- EventStoreDBProjectionManagementClient pmc =
-     EventStoreDBProjectionManagementClient.create(
-         EventStoreDBConnectionString.parseOrThrow(connectionString));

// KurrentDB
+ KurrentDBProjectionManagementClient pmc =
+     KurrentDBProjectionManagementClient.create(
+         KurrentDBConnectionString.parseOrThrow(connectionString));
```

All three clients share one `KurrentDBClientSettings`. They can also derive from an existing `KurrentDBClientBase` via static `from(...)` to pool a single channel; helper unchanged from the old client.

## 3. Connection string: `esdb://` and `kurrentdb://`

`KurrentDBConnectionString.parseOrThrow(...)` accepts **both** schemes:

```
kurrentdb://node1:2113                                  # preferred
kurrentdb+discover://node1:2113,node2:2113,node3:2113   # preferred (cluster discovery)
esdb://node1:2113                                       # still parses
esdb+discover://node1:2113,node2:2113                   # still parses
```

`esdb://` kept for back-compat so the artifact swap does not force a config change in the same commit. **Standardise on `kurrentdb://` at the next configuration touch.** Mixed schemes muddy grep audits; `esc` CLI, server logs, and dashboards all use `kurrentdb://`.

```java
// All three resolve identically today.
KurrentDBClientSettings a =
    KurrentDBConnectionString.parseOrThrow("kurrentdb://node1:2113");
KurrentDBClientSettings b =
    KurrentDBConnectionString.parseOrThrow("kurrentdb+discover://node1:2113,node2:2113");
KurrentDBClientSettings c =
    KurrentDBConnectionString.parseOrThrow("esdb://node1:2113"); // still works, but rebrand to kurrentdb:// when you can
```

> **Credentials handling.** Parser accepts `user:pass@`, but **never** embed real credentials in source. Agents copy examples verbatim into committed code; a literal sample credential lands in production. Wire credentials via `ConnectionSettingsBuilder#defaultCredentials(new UserCredentials(user, pass))` or per-request `.authenticated("user", "pass")` on the options builder, populated from configuration or a secret manager. Snippets here are **structural** only.

Query-parameter names (`tls`, `tlsVerifyCert`, `nodePreference`, `defaultDeadline`, `keepAliveInterval`, `keepAliveTimeout`, `connectionName`) unchanged.

## 4. Expected revision: `ExpectedRevision` collapses into `StreamState`

`ExpectedRevision` is **removed**. `StreamState` is the sole expected-revision type on every options builder (append, delete, tombstone). Setter renamed from `expectedRevision(...)` to `streamState(...)`.

| EventStoreDB gRPC                                  | KurrentDB                                                                        |
|----------------------------------------------------|----------------------------------------------------------------------------------|
| `ExpectedRevision.any()`                           | `StreamState.any()`                                                              |
| `ExpectedRevision.noStream()`                      | `StreamState.noStream()`                                                         |
| `ExpectedRevision.streamExists()`                  | `StreamState.streamExists()`                                                     |
| `ExpectedRevision.expectedRevision(long)`          | `StreamState.streamRevision(long)`                                               |
| `options.expectedRevision(ExpectedRevision.any())` | `options.streamState(StreamState.any())`                                         |
| `options.expectedRevision(revision)` (`long`)      | `options.streamRevision(revision)` (`long`), convenience for the numeric case   |

`StreamState.fromRawLong(long)` is available for raw wire-format longs (`-1` no-stream, `-2` any, `-4` stream-exists, `>= 0` concrete revision). Prefer the named factories at call sites.

**No `StreamState.none()`.** Old code may use `ExpectedRevision.none()` (intent: "no opinion"). Replacement depends on intent:

- *"Stream must not exist yet"* → `StreamState.noStream()`.
- *"No opinion about current revision"* → `StreamState.any()`. **Be deliberate**: `StreamState.any()` disables optimistic concurrency.

Confirm intent at each call site before bulk-replacing. Blanket replace silently drops optimistic concurrency.

### Append call sites

```java
// EventStoreDB gRPC
- AppendToStreamOptions options = AppendToStreamOptions.get()
-     .expectedRevision(ExpectedRevision.expectedRevision(currentRevision));
-
- client.appendToStream("order-7", options, event).get();

// KurrentDB
+ AppendToStreamOptions options = AppendToStreamOptions.get()
+     .streamState(StreamState.streamRevision(currentRevision));
+
+ client.appendToStream("order-7", options, event).get();
```

```java
// "Stream must not exist yet" — the common rename
- AppendToStreamOptions options = AppendToStreamOptions.get()
-     .expectedRevision(ExpectedRevision.noStream());
+ AppendToStreamOptions options = AppendToStreamOptions.get()
+     .streamState(StreamState.noStream());
```

### Delete call sites

```java
// EventStoreDB gRPC
- DeleteStreamOptions options = DeleteStreamOptions.get()
-     .expectedRevision(ExpectedRevision.streamExists());
-
- client.deleteStream("order-7", options).get();

// KurrentDB
+ DeleteStreamOptions options = DeleteStreamOptions.get()
+     .streamState(StreamState.streamExists());
+
+ client.deleteStream("order-7", options).get();
```

Grep for stragglers after the rename:

```bash
grep -rn 'ExpectedRevision\|\.expectedRevision(' --include='*.java' --include='*.kt' .
```

## 5. `WrongExpectedVersionException` field rename

Exception keeps its name and package-local constructor. Accessors changed type and name:

| EventStoreDB gRPC                                         | KurrentDB                                                  |
|-----------------------------------------------------------|------------------------------------------------------------|
| `getExpectedVersion()` returning `ExpectedRevision`       | `getExpectedState()` returning `StreamState`               |
| `getNextExpectedVersion()` returning `ExpectedRevision`   | `getActualState()` returning `StreamState`                 |

`getStreamName()` unchanged.

```java
try {
    client.appendToStream("order-7", options, events).get();
} catch (ExecutionException ex) {
    Throwable cause = ex.getCause();
    if (cause instanceof WrongExpectedVersionException) {
        WrongExpectedVersionException wev = (WrongExpectedVersionException) cause;
-       logger.warn("Conflict on {}: expected {}, actual {}",
-               wev.getStreamName(), wev.getExpectedVersion(), wev.getNextExpectedVersion());
+       logger.warn("Conflict on {}: expected {}, actual {}",
+               wev.getStreamName(), wev.getExpectedState(), wev.getActualState());
    }
}
```

Easy to miss when caught in only one place. Grep after the symbol rename:

```bash
grep -rn 'getExpectedVersion\|getNextExpectedVersion' --include='*.java' --include='*.kt' .
```

## 6. Spring registration

Bean factory follows the type rename. Behaviour unchanged: register once, share as singleton, no async setup.

```java
// EventStoreDB gRPC
- @Bean
- public EventStoreDBClient eventStoreClient(
-         @Value("${kurrentdb.connection-string}") String connectionString) {
-     return EventStoreDBClient.create(
-         EventStoreDBConnectionString.parseOrThrow(connectionString));
- }

// KurrentDB
+ @Bean(destroyMethod = "shutdown")
+ public KurrentDBClient kurrentDbClient(
+         @Value("${kurrentdb.connection-string}") String connectionString) {
+     return KurrentDBClient.create(
+         KurrentDBConnectionString.parseOrThrow(connectionString));
+ }
```

Micronaut, Quarkus, Guice: same type rename on the factory or `@Provides`. Client manages its own lifecycle (`shutdown()`); wire it into the container's destroy callback so the gRPC channel closes cleanly.

## Rebrand checklist

- [ ] `com.eventstore:db-client-java` removed from every `build.gradle` / `build.gradle.kts` / `pom.xml` / version catalog. `io.kurrent:kurrentdb-client` referenced at the latest 1.x.
- [ ] No `import com.eventstore.dbclient` (or `com.eventstore.dbclient.*`) statements remain.
- [ ] `EventStoreDBClient`, `EventStoreDBClientSettings`, `EventStoreDBConnectionString`, `EventStoreDBPersistentSubscriptionsClient`, and `EventStoreDBProjectionManagementClient` symbol names gone. `KurrentDB`-prefixed equivalents in their place.
- [ ] Spring / Micronaut / Quarkus / Guice bean factories return the `KurrentDB`-prefixed types.
- [ ] `ExpectedRevision` gone. Append, delete, and tombstone call sites use `.streamState(StreamState.any())` / `.streamState(StreamState.noStream())` / `.streamState(StreamState.streamExists())` / `.streamState(StreamState.streamRevision(value))` (or the `.streamRevision(long)` shortcut).
- [ ] Every `ExpectedRevision.none()` reviewed for intent. "Must not exist" → `StreamState.noStream()`; "no opinion" → `StreamState.any()` (only with deliberate sign-off; disables optimistic concurrency).
- [ ] `WrongExpectedVersionException.getExpectedVersion()` / `getNextExpectedVersion()` reads replaced with `getExpectedState()` / `getActualState()`. Logging, metrics, tests updated.
- [ ] Connection strings standardised on `kurrentdb://` (or `kurrentdb+discover://`) at the next configuration touch. `esdb://` left only for a deliberate compatibility window.
- [ ] No literal `user:pass@` credentials in any committed connection string. Credentials wired through `ConnectionSettingsBuilder#defaultCredentials` or per-request `.authenticated(...)` from configuration or a secret manager.
- [ ] `./gradlew build` / `mvn verify` clean. No warnings about duplicate transitive `grpc-netty-shaded` or `protobuf-java` pulls from `com.eventstore:db-client-java`.
- [ ] Integration tests run end-to-end against a real KurrentDB target (the project's own suite).
