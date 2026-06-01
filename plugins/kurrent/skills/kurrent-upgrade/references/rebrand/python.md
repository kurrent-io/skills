# Rebranding the Python gRPC client from EventStoreDB to KurrentDB

EventStoreDB rebranded to **KurrentDB** in 2025. Python gRPC client: [`kurrentdbclient` v1.0b6](https://github.com/pyeventsourcing/kurrentdbclient/releases/tag/1.0b6). gRPC protocol, event model, and method signatures (`append_to_stream`, `get_stream`, `read_stream`, `subscribe_to_all`, `read_subscription_to_all`, etc.) unchanged. Migration: distribution + import rename, class rename on two top-level clients, exception-class rename across nearly every exception type, connection-scheme switch.

Applies **only** to projects on `esdbclient` (namespace `esdbclient.*`). No legacy TCP Python client exists. HTTP atom or other-language SDK callers: out of scope.

## Source-distribution matrix

Read `pyproject.toml`, `requirements.txt`, `requirements*.in`, `Pipfile`, `poetry.lock`, and constraints files before classifying. PyPI project name determines side of the rename.

| Found in project                                        | Classification     | Action                                              |
|---------------------------------------------------------|--------------------|-----------------------------------------------------|
| `esdbclient` (any version, including 1.1.x)             | EventStoreDB gRPC  | Continue with this reference.                       |
| `kurrentdbclient` present, no `esdbclient` left         | Current gRPC       | Done. Use `kurrent-docs`.                           |
| Neither, but `import esdbclient` in source              | Stale / unresolved | Resolve dependency declaration first; reclassify.   |

Both present: mid-migration. Finish the rebrand, then drop `esdbclient`. The two install side-by-side (different top-level packages) but `from esdbclient import …` keeps resolving to old code until rewritten.

Read every manifest (including transitive declarations in editable / monorepo sub-packages) before any rename. A bulk find-and-replace before the matrix check leaves the project unable to resolve either side.

| Topic                                                                                | When to read                                                                |
|--------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| [Distribution swap](#1-replace-the-distribution)                                     | First step. New PyPI project, new import path.                              |
| [Import and class renames](#2-import-and-class-renames)                              | Mechanical find-and-replace, after the distribution swap.                   |
| [Connection string](#3-connection-string-kdb-kurrentdb-and-esdb)                     | `kdb://` canonical; `kurrentdb://` and `esdb://` accepted synonyms.         |
| [Exception class renames](#4-exception-class-renames)                                | Breaking. Most exceptions gained `Error` suffix; base class renamed. `WrongExpectedVersion` alias removed. |
| [`StreamState`, method names, signatures](#5-streamstate-method-names-signatures)    | Unchanged. Listed so a reader does not "fix" what is not broken.            |
| [System-event regex constants](#6-system-event-regex-constants)                      | Breaking. `ESDB_*_EVENTS_REGEX` → `KDB_*_EVENTS_REGEX`.                     |
| [Asyncio client alias removed](#7-asyncio-client-alias-removed)                      | Breaking. `AsyncioEventStoreDBClient` gone; use `AsyncKurrentDBClient`.     |
| [OpenTelemetry attribute string values](#8-opentelemetry-attribute-string-values)    | Only with `[opentelemetry]` extra. `db.eventstoredb.*` → `db.kurrentdb.*`.  |
| [Checklist](#rebrand-checklist)                                                      | Final verification.                                                         |

## 1. Replace the distribution

New package: [`kurrentdbclient`](https://pypi.org/project/kurrentdbclient/), importable as `kurrentdbclient`.

**`pyproject.toml` (PEP 621):**

```diff
 [project]
 dependencies = [
-    "esdbclient>=1.1,<2",
+    "kurrentdbclient>=1.0,<2",
 ]
```

**Poetry:**

```diff
 [tool.poetry.dependencies]
-esdbclient = "^1.1"
+kurrentdbclient = "^1.0"
```

**`requirements.txt`:**

```diff
-esdbclient==1.1.7
+kurrentdbclient==1.0b6
```

**OpenTelemetry extra:** name **unchanged** (`[opentelemetry]`). Both `esdbclient[opentelemetry]` and `kurrentdbclient[opentelemetry]` pull `opentelemetry-api`, `opentelemetry-instrumentation`, `opentelemetry-semantic-conventions`.

```diff
-esdbclient[opentelemetry]
+kurrentdbclient[opentelemetry]
```

**Pin to latest 1.x.** The 1.0b* line is the rebrand release series. Subsequent 1.x releases carry server-feature coverage and fixes not backported to `esdbclient` 1.1.x. Drop `esdbclient` in the same commit as the rename. Both declared resolves cleanly (different top-level packages) but unconverted `from esdbclient import …` keeps importing old code.

```sh
pip uninstall esdbclient
pip install kurrentdbclient

# or, with Poetry
poetry remove esdbclient
poetry add kurrentdbclient
```

After the swap: `pip show kurrentdbclient` resolves, `pip show esdbclient` fails. If both still resolve, find the lockfile / constraints file still pinning `esdbclient` and remove it.

## 2. Import and class renames

Top-level public names list is narrow. Run a global find-and-replace **after** the distribution swap.

| EventStoreDB gRPC (Python)                                | KurrentDB (Python)                                     |
|-----------------------------------------------------------|--------------------------------------------------------|
| `from esdbclient import …`                                | `from kurrentdbclient import …`                        |
| `import esdbclient`                                       | `import kurrentdbclient`                               |
| `EventStoreDBClient`                                      | `KurrentDBClient`                                      |
| `AsyncEventStoreDBClient`                                 | `AsyncKurrentDBClient`                                 |
| `AsyncioEventStoreDBClient` (alias of `AsyncEventStoreDBClient`) | **removed**, use `AsyncKurrentDBClient`         |
| `ESDB_SYSTEM_EVENTS_REGEX`                                | `KDB_SYSTEM_EVENTS_REGEX`                              |
| `ESDB_PERSISTENT_CONFIG_EVENTS_REGEX`                     | `KDB_PERSISTENT_CONFIG_EVENTS_REGEX`                   |

Unchanged: `NewEvent`, `RecordedEvent`, `Checkpoint`, `CaughtUp`, `ContentType`, `StreamState`, `PersistentSubscription`, `AsyncPersistentSubscription`, `CatchupSubscription`, `AsyncCatchupSubscription`, `ReadResponse`, `AsyncReadResponse`, `DEFAULT_EXCLUDE_FILTER`. Scope the replace to symbols in the table above and to the `esdbclient` package prefix. Do not let it rename `NewEvent`, `RecordedEvent`, or method bodies.

### Client construction

Constructor signature unchanged. `uri=`, `root_certificates=`, `private_key=`, `certificate_chain=`, `user_credentials=` kwargs unchanged.

```python
# EventStoreDB gRPC
- from esdbclient import EventStoreDBClient, NewEvent, StreamState
-
- client = EventStoreDBClient(
-     uri="esdb://localhost:2113?Tls=false",
- )

# KurrentDB
+ from kurrentdbclient import KurrentDBClient, NewEvent, StreamState
+
+ client = KurrentDBClient(
+     uri="kdb://localhost:2113?Tls=false",
+ )
```

### Asyncio client construction

```python
# EventStoreDB gRPC
- from esdbclient import AsyncEventStoreDBClient
-
- client = AsyncEventStoreDBClient(
-     uri="esdb://localhost:2113?Tls=false",
- )

# KurrentDB
+ from kurrentdbclient import AsyncKurrentDBClient
+
+ client = AsyncKurrentDBClient(
+     uri="kdb://localhost:2113?Tls=false",
+ )
```

`await client.append_to_stream(...)`, `async for event in client.subscribe_to_all(...):`, and the persistent-subscription read loop keep the same shapes. Only import and class name move.

## 3. Connection string: `kdb://`, `kurrentdb://`, and `esdb://`

`kurrentdbclient` URI parser accepts three schemes plus matching `+discover` variants:

```
kdb://            kdb+discover://
kurrentdb://      kurrentdb+discover://
esdb://           esdb+discover://
```

Canonical scheme: **`kdb://`**. `kurrentdb://` and `esdb://` kept as synonyms so the distribution swap does not force a config change in the same commit. Parser does **not** emit a deprecation warning for `esdb://`; URL parses silently and the client connects.

**Standardise on `kdb://` at the next configuration touch.** Mixed schemes across environments make grep-based audits noisier. External tooling (`esc` CLI, server logs, dashboards) uses `kurrentdb://`. Either `kdb://` or `kurrentdb://` aligns; `esdb://` does not.

Query-parameter names unchanged and case-insensitive on parse: `Tls`, `TlsVerifyCert`, `TlsCaFile`, `NodePreference`, `DefaultDeadline`, `KeepAliveInterval`, `KeepAliveTimeout`, `ConnectionName`, `MaxDiscoverAttempts`, `DiscoveryInterval`, `GossipTimeout`, `UserCertFile`, `UserKeyFile`. Node-preference values (`leader`, `follower`, `random`, `readonlyreplica`) unchanged.

```python
# All three resolve the same way today.
KurrentDBClient(uri="kdb://node1:2113")
KurrentDBClient(uri="kurrentdb+discover://node1:2113,node2:2113")
KurrentDBClient(uri="esdb://node1:2113")  # still works
```

> **Credentials handling.** Parser accepts `user:password@` user-info, but **never** embed real credentials in source. Migration agents copy these examples verbatim into committed code; literal credentials from a sample end up in production. Read the connection string from configuration or a secret manager, or pass credentials per-call via the `credentials=` kwarg (a `grpc.CallCredentials`) on `append_to_stream`, `get_stream`, `subscribe_to_all`, and persistent-subscription read methods. Treat snippets here as **structural** examples only.

## 4. Exception class renames

Nearly every class in `esdbclient.exceptions` was renamed. Two changes together: base class prefix `EventStoreDB` becomes `KurrentDB`, and most concrete exceptions gain an `Error` suffix to match PEP 8 / stdlib conventions.

Raise sites and conditions unchanged; only the type name moves. Update every `except ` clause and `isinstance(...)` check.

### Renamed

| EventStoreDB gRPC                          | KurrentDB                                                |
|--------------------------------------------|----------------------------------------------------------|
| `EventStoreDBClientException`              | `KurrentDBClientError`                                   |
| `ExceptionThrownByHandler`                 | `ExceptionThrownByHandlerError`                          |
| `ServiceUnavailable`                       | `ServiceUnavailableError`                                |
| `DeadlineExceeded`                         | `DeadlineExceededError`                                  |
| `GrpcDeadlineExceeded`                     | `GrpcDeadlineExceededError`                              |
| `CancelledByClient`                        | `CancelledByClientError`                                 |
| `AbortedByServer`                          | `AbortedByServerError`                                   |
| `ConsumerTooSlow`                          | `ConsumerTooSlowError`                                   |
| `NodeIsNotLeader`                          | `NodeIsNotLeaderError`                                   |
| `NotFound`                                 | `NotFoundError`                                          |
| `AlreadyExists`                            | `AlreadyExistsError`                                     |
| `WrongCurrentVersion`                      | `WrongCurrentVersionError`                               |
| `WrongExpectedVersion` (alias of above)    | **removed**, use `WrongCurrentVersionError`              |
| `StreamIsDeleted`                          | `StreamIsDeletedError`                                   |
| `AppendDeadlineExceeded`                   | `AppendDeadlineExceededError`                            |
| `OperationFailed`                          | `OperationFailedError`                                   |
| `DiscoveryFailed`                          | `DiscoveryFailedError`                                   |
| `LeaderNotFound`                           | `LeaderNotFoundError`                                    |
| `FollowerNotFound`                         | `FollowerNotFoundError`                                  |
| `ReadOnlyReplicaNotFound`                  | `ReadOnlyReplicaNotFoundError`                           |
| `ExceptionIteratingRequests`               | `ExceptionIteratingRequestsError`                        |
| `FailedPrecondition`                       | `FailedPreconditionError`                                |
| `MaximumSubscriptionsReached`              | `MaximumSubscriptionsReachedError`                       |

### Unchanged

`ProgrammingError`, `GrpcError`, `SSLError`, `SubscriptionConfirmationError`, `AccessDeniedError`, `UnknownError`, `InvalidTransactionError`, `MaximumAppendSizeExceededError`, `BadRequestError`, `InternalError`.

### Example: append with optimistic concurrency

```python
# EventStoreDB gRPC
- from esdbclient import EventStoreDBClient, NewEvent, StreamState
- from esdbclient.exceptions import WrongCurrentVersion, NotFound
-
- try:
-     client.append_to_stream(
-         stream_name="order-7",
-         current_version=StreamState.NO_STREAM,
-         events=[event],
-     )
- except WrongCurrentVersion:
-     logger.warning("Concurrent write on order-7")
- except NotFound:
-     logger.warning("Stream order-7 missing")

# KurrentDB
+ from kurrentdbclient import KurrentDBClient, NewEvent, StreamState
+ from kurrentdbclient.exceptions import WrongCurrentVersionError, NotFoundError
+
+ try:
+     client.append_to_stream(
+         stream_name="order-7",
+         current_version=StreamState.NO_STREAM,
+         events=[event],
+     )
+ except WrongCurrentVersionError:
+     logger.warning("Concurrent write on order-7")
+ except NotFoundError:
+     logger.warning("Stream order-7 missing")
```

### `WrongExpectedVersion` is the easiest miss

In `esdbclient`, `WrongExpectedVersion` was a module-level alias for `WrongCurrentVersion`, kept for projects migrating off older snake-case names. Alias is **gone** in `kurrentdbclient`; only `WrongCurrentVersionError` exists. Rewrite every `except WrongExpectedVersion:` to `except WrongCurrentVersionError:`.

### After the rename

Grep for remaining old names:

```bash
grep -rn --include='*.py' \
  -e 'EventStoreDBClientException' \
  -e 'WrongExpectedVersion' \
  -e 'WrongCurrentVersion\b' \
  -e 'NotFound\b' \
  -e 'AlreadyExists\b' \
  -e 'StreamIsDeleted\b' \
  -e 'DiscoveryFailed\b' \
  -e 'LeaderNotFound\b' \
  -e 'FollowerNotFound\b' \
  -e 'ReadOnlyReplicaNotFound\b' \
  -e 'ServiceUnavailable\b' \
  -e 'DeadlineExceeded\b' \
  -e 'GrpcDeadlineExceeded\b' \
  -e 'CancelledByClient\b' \
  -e 'AbortedByServer\b' \
  -e 'ConsumerTooSlow\b' \
  -e 'NodeIsNotLeader\b' \
  -e 'OperationFailed\b' \
  -e 'AppendDeadlineExceeded\b' \
  -e 'ExceptionThrownByHandler\b' \
  -e 'ExceptionIteratingRequests\b' \
  -e 'FailedPrecondition\b' \
  -e 'MaximumSubscriptionsReached\b' \
  src/
```

Each hit on an `except`, `isinstance(...)`, or `raise` site needs the rename. Unrelated identifiers of the same name in your own code (e.g. a domain class called `NotFound`) stay as they are.

## 5. `StreamState`, method names, signatures

Non-changes, listed so a reader does not "fix" what is not broken:

- `StreamState.NO_STREAM`, `StreamState.EXISTS`, `StreamState.ANY` unchanged. Still the values for `current_version=` on `append_to_stream`, `delete_stream`, `tombstone_stream`, `set_stream_metadata`.
- `current_version=` kwarg name unchanged on those methods. (Other SDKs renamed an equivalent option to `streamState`; Python did not.)
- Signatures unchanged for `append_to_stream`, `get_stream`, `read_stream`, `read_all`, `subscribe_to_all`, `subscribe_to_stream`, `delete_stream`, `tombstone_stream`, `get_stream_metadata`, `set_stream_metadata`, `read_subscription_to_all`, `read_subscription_to_stream`, `create_subscription_to_all`, `create_subscription_to_stream`, `replay_parked_events`, and projection-management methods. New projection methods (`abort_projection`, `list_all_projection_statistics`, `list_continuous_projection_statistics`) **added**; nothing removed or signature-broken.
- `NewEvent`, `RecordedEvent`, `Checkpoint`, `CaughtUp`, `ContentType` unchanged.
- Context-manager pattern unchanged (`with KurrentDBClient(...) as client:` and `async with AsyncKurrentDBClient(...) as client:`).
- `client.close()` and `client.reconnect()` unchanged.
- Persistent-subscription `ack(...)` / `nack(action, reason, event)` semantics unchanged.

A diff that touches any of these names is doing more than a rebrand; split it out.

## 6. System-event regex constants

Top-level regex constants renamed to drop the legacy `ESDB_` prefix.

| EventStoreDB gRPC                       | KurrentDB                                  |
|-----------------------------------------|--------------------------------------------|
| `ESDB_SYSTEM_EVENTS_REGEX`              | `KDB_SYSTEM_EVENTS_REGEX`                  |
| `ESDB_PERSISTENT_CONFIG_EVENTS_REGEX`   | `KDB_PERSISTENT_CONFIG_EVENTS_REGEX`       |

Underlying patterns (`^\$.+`, `^\$persistentSubscriptionConfig$`) unchanged. Typically used to build `filter_exclude=` on `subscribe_to_all` / `read_all`.

```python
# EventStoreDB gRPC
- from esdbclient import ESDB_SYSTEM_EVENTS_REGEX, EventStoreDBClient
-
- client.subscribe_to_all(filter_exclude=[ESDB_SYSTEM_EVENTS_REGEX])

# KurrentDB
+ from kurrentdbclient import KDB_SYSTEM_EVENTS_REGEX, KurrentDBClient
+
+ client.subscribe_to_all(filter_exclude=[KDB_SYSTEM_EVENTS_REGEX])
```

`DEFAULT_EXCLUDE_FILTER` keeps its name and still composes the two regexes; if the project already uses `DEFAULT_EXCLUDE_FILTER`, no change here.

## 7. Asyncio client alias removed

`esdbclient` exported two names for the asyncio client: `AsyncEventStoreDBClient` (canonical) and `AsyncioEventStoreDBClient` (alias). Alias is **gone** in `kurrentdbclient`; only `AsyncKurrentDBClient` is exported.

```python
# EventStoreDB gRPC, both imported the same class
- from esdbclient import AsyncEventStoreDBClient
- from esdbclient import AsyncioEventStoreDBClient

# KurrentDB
+ from kurrentdbclient import AsyncKurrentDBClient
```

Grep so the alias does not get missed:

```bash
grep -rn --include='*.py' 'AsyncioEventStoreDBClient' src/
```

## 8. OpenTelemetry attribute string values

With `kurrentdbclient[opentelemetry]`, **string values** of span attributes changed with the rebrand. Python attribute names on the `Attributes` class kept the same identifiers (`EVENTSTOREDB_STREAM`, `EVENTSTOREDB_SUBSCRIPTION_ID`, `EVENTSTOREDB_EVENT_ID`, `EVENTSTOREDB_EVENT_TYPE`), so app code referencing them by name compiles unchanged. Breakage: dashboards, alerts, and log-pipeline filters matching on the **string** value.

| EventStoreDB OTel string         | KurrentDB OTel string             |
|----------------------------------|-----------------------------------|
| `db.eventstoredb.stream`         | `db.kurrentdb.stream`             |
| `db.eventstoredb.subscription.id`| `db.kurrentdb.subscription.id`    |
| `db.eventstoredb.event.id`       | `db.kurrentdb.event.id`           |
| `db.eventstoredb.event.type`     | `db.kurrentdb.event.type`         |

Update dashboards, alerts, and log-pipeline filters matching `db.eventstoredb.*` to the new prefix in the same change. No aliasing layer; old queries return nothing after the upgrade.

Instrumentation entry points (`KurrentDBClientInstrumentor` / `AsyncKurrentDBClientInstrumentor`, formerly `EventStoreDBClientInstrumentor` / `AsyncEventStoreDBClientInstrumentor`) follow the section 2 class-rename rule; update `instrument()` call sites the same way.

## Rebrand checklist

Before declaring done, confirm:

- [ ] `esdbclient` removed from every `pyproject.toml` / `requirements*.txt` / `requirements*.in` / `Pipfile` / `poetry.lock` / constraints file. `kurrentdbclient` referenced at the latest 1.x.
- [ ] `pip show esdbclient` fails in the project's resolved environment.
- [ ] No `from esdbclient` or `import esdbclient` statements remain. All imports use `kurrentdbclient`.
- [ ] `EventStoreDBClient` and `AsyncEventStoreDBClient` symbol names gone from source. `KurrentDBClient` and `AsyncKurrentDBClient` in their place.
- [ ] `AsyncioEventStoreDBClient` alias not referenced anywhere. All async usage is `AsyncKurrentDBClient`.
- [ ] `ESDB_SYSTEM_EVENTS_REGEX` and `ESDB_PERSISTENT_CONFIG_EVENTS_REGEX` replaced with `KDB_SYSTEM_EVENTS_REGEX` / `KDB_PERSISTENT_CONFIG_EVENTS_REGEX`.
- [ ] Every renamed exception (`EventStoreDBClientException`, `WrongCurrentVersion`, `WrongExpectedVersion`, `NotFound`, `AlreadyExists`, `StreamIsDeleted`, `DiscoveryFailed`, `LeaderNotFound`, `FollowerNotFound`, `ReadOnlyReplicaNotFound`, `ServiceUnavailable`, `DeadlineExceeded`, `GrpcDeadlineExceeded`, `CancelledByClient`, `AbortedByServer`, `ConsumerTooSlow`, `NodeIsNotLeader`, `OperationFailed`, `AppendDeadlineExceeded`, `ExceptionThrownByHandler`, `ExceptionIteratingRequests`, `FailedPrecondition`, `MaximumSubscriptionsReached`) replaced at every `except`, `isinstance(...)`, and `raise` site with its `…Error`-suffixed (and `KurrentDBClientError`-rooted) counterpart.
- [ ] `WrongExpectedVersion` references rewritten to `WrongCurrentVersionError`, not `WrongCurrentVersion` (also no longer exists).
- [ ] Connection strings standardised on `kdb://` (or `kdb+discover://`) at the next configuration touch. `kurrentdb://` accepted as equivalent. `esdb://` left only with a deliberate compatibility window.
- [ ] No literal `user:password@` credentials in any connection string in source or in committed configuration. Credentials sourced from configuration / secret manager, or passed per-call via `credentials=`.
- [ ] If using the OTel extra: `kurrentdbclient[opentelemetry]` referenced, instrumentor class renamed, dashboards / alerts moved from `db.eventstoredb.*` to `db.kurrentdb.*`.
- [ ] `pip install` / `poetry install` clean. `pip check` reports no broken dependencies. No `esdbclient` transitive pulls in the resolved environment (besides unrelated, non-Kurrent packages).
- [ ] Integration tests run end-to-end against a real KurrentDB target (the project's own suite).
