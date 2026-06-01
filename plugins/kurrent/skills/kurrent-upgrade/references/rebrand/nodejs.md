# Rebrand Node.js gRPC client: EventStoreDB to KurrentDB

EventStoreDB rebranded to **KurrentDB** in 2025. Node.js gRPC client v1.0.0 of `@kurrent/kurrentdb-client` matches. gRPC protocol, event model, and most of the API are unchanged. v1.0.0 also bundles breaking changes piggy-backed on the rebrand: constructor removal, event-emitter removal, Node 14 drop, and `expectedRevision` to `streamState` on `appendToStream`.

Scope: projects already on `@eventstore/db-client` (`EventStoreDBClient`). The legacy `node-eventstore-client` TCP package is a separate migration.

## Source-package matrix

Read `package.json` and the lockfile before classifying. npm scope determines the side of the rename.

| Found in `package.json` / lockfile                          | Classification    | Action                                          |
|-------------------------------------------------------------|-------------------|-------------------------------------------------|
| `node-eventstore-client` (any version)                      | Legacy TCP        | **STOP.** Rewrite onto the gRPC client; not covered here. |
| `@eventstore/db-client` (5.x or 6.x)                        | EventStoreDB gRPC | Continue.                                       |
| `@kurrent/kurrentdb-client` present, no `@eventstore/*` left | Current gRPC      | Nothing to do. Use `kurrent-docs`.              |

Both packages present: mid-migration. Finish the rebrand, then remove `@eventstore/db-client`.

Minimum Node.js: **v20** on v1.x. Node 14 dropped in the same release. Confirm `engines.node` and CI matrix before merge.

| Topic                                                                                | When to read                                                                |
|--------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| [Package swap](#1-replace-the-package-reference)                                     | First step. New scope, new package name.                                    |
| [Symbol renames](#2-symbol-renames)                                                  | Mechanical, after the package swap.                                         |
| [Client construction is now connection-string only](#3-client-construction-is-now-connection-string-only) | Breaking. Class constructor removed; use `connectionString` factory. |
| [Connection string scheme](#4-connection-string-esdb-and-kurrentdb)                  | `kurrentdb://` preferred; `esdb://` still parses but logs deprecation.      |
| [Stream handling: async iterables only](#5-stream-handling-async-iterables-only)     | Breaking. Event-emitter (`.on("data", ...)`) removed.                       |
| [`appendToStream` option: `expectedRevision` to `streamState`](#6-appendtostream-option-expectedrevision--streamstate) | Breaking. Only on `appendToStream`; delete / tombstone / setStreamMetadata keep `expectedRevision`. |
| [`WrongExpectedVersionError` field rename](#7-wrongexpectedversionerror-field-rename) | Breaking. `expectedVersion` / `actualVersion` to `expectedState` / `actualState`. |
| [Node.js 20+ requirement](#8-nodejs-20-requirement)                                  | Verify runtime and CI before merge.                                         |
| [Constructor TLS options removed](#9-constructor-tls-options-removed)                | `certChain` / `privateKey` gone; move to connection-string TLS params.      |
| [OpenTelemetry tag rename](#10-opentelemetry-tag-rename)                             | Only if using `@kurrent/opentelemetry`. Dashboards/alerts on `db.esdb.*` must move to `db.kurrent.*`. |
| [Checklist](#rebrand-checklist)                                                      | Final verification.                                                         |

## 1. Replace the package reference

New package ships under `@kurrent`:

```diff
 {
   "dependencies": {
-    "@eventstore/db-client": "^6.2.1"
+    "@kurrent/kurrentdb-client": "^1.0.0"
   }
 }
```

```sh
npm uninstall @eventstore/db-client
npm install @kurrent/kurrentdb-client
# or
yarn remove @eventstore/db-client
yarn add @kurrent/kurrentdb-client
```

**Pin to latest 1.x minor.** Server-feature coverage and bug fixes (V2 projection engine, `appendRecords`, Rust-backed read path) only ship on `@kurrent/kurrentdb-client`. Leaving both packages bloats `node_modules` and creates two type identities that look identical.

If using `@eventstore/opentelemetry`, swap for `@kurrent/opentelemetry` in the same commit. See [OpenTelemetry tag rename](#10-opentelemetry-tag-rename).

## 2. Symbol renames

Single user-visible class rename: `EventStoreDBClient` to `KurrentDBClient`. All other public names (`jsonEvent`, `START`, `END`, `FORWARDS`, `BACKWARDS`, `NO_STREAM`, `ANY`, `STREAM_EXISTS`, `JSONEventType`, `streamNameFilter`, `eventTypeFilter`, `ResolvedEvent`, etc.) unchanged.

| EventStoreDB gRPC                                  | KurrentDB                                              |
|----------------------------------------------------|--------------------------------------------------------|
| `import { EventStoreDBClient } from "@eventstore/db-client";` | `import { KurrentDBClient } from "@kurrent/kurrentdb-client";` |
| `EventStoreDBClient`                               | `KurrentDBClient`                                      |
| `AppendExpectedRevision` (type)                    | `AppendStreamState` (type)                             |
| `CurrentRevision` (type)                           | `CurrentStreamState` (type)                            |

`WrongExpectedVersionError` keeps its name; two fields rename. See [section 7](#7-wrongexpectedversionerror-field-rename).

Run the package swap (section 1) **before** the symbol rename. Find-and-replace ahead of the swap imports renamed symbols from the wrong scope.

## 3. Client construction is now connection-string only

Object-literal constructor on `EventStoreDBClient` is **removed**. `KurrentDBClient` is created via the static `connectionString` factory: tagged-template or plain function call.

```ts
// EventStoreDB gRPC: legacy constructor
- import { EventStoreDBClient } from "@eventstore/db-client";
-
- const client = new EventStoreDBClient(
-   { endpoint: "localhost:2113" },
-   { insecure: true },
-   { username: "admin", password: "changeit" }
- );

// KurrentDB: tagged-template form, with interpolation
+ import { KurrentDBClient } from "@kurrent/kurrentdb-client";
+
+ const host = process.env.KURRENTDB_HOST ?? "localhost:2113";
+ const client = KurrentDBClient.connectionString`kurrentdb://${host}?tls=false`;

// or, plain function call when the string is already assembled
+ const client = KurrentDBClient.connectionString(
+   process.env.KURRENTDB_CONNECTION_STRING!
+ );
```

Already on `EventStoreDBClient.connectionString(...)`? No-op beyond the class rename.

> **Credentials.** Parser accepts `user:pass@`, but **never** embed real credentials in source. Agents copy these examples verbatim; a literal default from a sample ends up in production. Read from configuration or a secret manager, or pass per-call via `BaseOptions.credentials`. Snippets here are **structural** only.

## 4. Connection string: `esdb://` and `kurrentdb://`

Parser accepts both, but `esdb://` **logs a deprecation warning at construction time**:

```
The 'esdb' protocol is deprecated. Please use 'kurrentdb' instead
```

Accepted protocols on v1.x:

```
kurrentdb://         kurrentdb+discover://
kurrent://           kurrent+discover://
kdb://               kdb+discover://
esdb://              esdb+discover://      # deprecated, warns on every construction
```

**Standardise on `kurrentdb://` at the next configuration touch.** Mixed schemes make grep audits noisier; external tooling (`esc` CLI, server logs, dashboards) all use `kurrentdb://`. `esdb://` also logs the deprecation warning on every client construction.

Query-parameter names (`tls`, `tlsVerifyCert`, `tlsCAFile`, `nodePreference`, `defaultDeadline`, `keepAliveInterval`, `keepAliveTimeout`, `connectionName`, `userCertFile`, `userKeyFile`) unchanged.

```ts
// All three resolve the same way today.
KurrentDBClient.connectionString`kurrentdb://node1:2113`;
KurrentDBClient.connectionString`kurrentdb+discover://node1:2113,node2:2113`;
KurrentDBClient.connectionString`esdb://node1:2113`; // works, but warns
```

## 5. Stream handling: async iterables only

Event-emitter pattern on read / subscribe is **removed**. Every `read*` and `subscribeTo*` returns an async iterable. Consume with `for await`, wrap in `try` / `catch`.

```ts
// ❌ EventStoreDB gRPC: event-emitter pattern (no longer supported)
- client.readAll()
-   .on("data", (event) => handleEvent(event))
-   .on("error", (err) => handleError(err))
-   .on("end", () => done());

// ✅ KurrentDB: async iteration
+ try {
+   for await (const resolvedEvent of client.readAll()) {
+     handleEvent(resolvedEvent);
+   }
+ } catch (err) {
+   handleError(err);
+ }
```

Same shape for `readStream`, `subscribeToStream`, `subscribeToAll`, `subscribeToPersistentSubscriptionToStream`, `subscribeToPersistentSubscriptionToAll`. Subscription control methods (`ack`, `nack`, `unsubscribe`) unchanged.

```ts
// Persistent subscription with ack / nack: shape is unchanged, only the consumption pattern
const subscription = client.subscribeToPersistentSubscriptionToStream(
  "orders",
  "billing"
);

try {
  for await (const event of subscription) {
    try {
      await handleEvent(event);
      await subscription.ack(event);
    } catch (err) {
      await subscription.nack("park", String(err), event);
    }
  }
} catch (err) {
  // subscription terminated
}
```

Grep for the removed pattern:

```bash
grep -rn --include='*.ts' --include='*.js' '\.on("data"\|\.on("error"\|\.on("end"' src/
```

Rewrite any remaining hits on `read*` or `subscribeTo*` results.

## 6. `appendToStream` option: `expectedRevision` to `streamState`

On `appendToStream`, optimistic-concurrency option renamed from `expectedRevision` to `streamState`. Accepted values unchanged: `bigint` revision, or `NO_STREAM` / `ANY` / `STREAM_EXISTS`.

```ts
// EventStoreDB gRPC
- await client.appendToStream("order-7", event, {
-   expectedRevision: NO_STREAM,
- });

// KurrentDB
+ await client.appendToStream("order-7", event, {
+   streamState: NO_STREAM,
+ });
```

```ts
// Concurrent append against a known revision
const events = client.readStream<SomeEvent>("order-7", {
  fromRevision: START,
  direction: FORWARDS,
});

let revision: AppendStreamState = NO_STREAM;
for await (const { event } of events) {
  revision = event?.revision ?? revision;
}

await client.appendToStream("order-7", newEvent, {
  streamState: revision,
});
```

**Only `appendToStream` renamed.** `deleteStream`, `tombstoneStream`, `setStreamMetadata` still take `expectedRevision`. A blanket find-and-replace breaks those. Scope to `appendToStream` arguments only.

```bash
# Find every call site that needs the rename
grep -rn --include='*.ts' --include='*.js' 'appendToStream' src/ | grep -n 'expectedRevision'
```

Type aliases also changed: `AppendExpectedRevision` to `AppendStreamState`, `CurrentRevision` to `CurrentStreamState`. Runtime values (`NO_STREAM`, `ANY`, `STREAM_EXISTS`, `bigint`) unchanged.

## 7. `WrongExpectedVersionError` field rename

Class keeps its name. Two fields and types renamed:

| EventStoreDB gRPC                                       | KurrentDB                                                  |
|---------------------------------------------------------|------------------------------------------------------------|
| `WrongExpectedVersionError.expectedVersion` (`AppendExpectedRevision`) | `WrongExpectedVersionError.expectedState` (`AppendStreamState`) |
| `WrongExpectedVersionError.actualVersion` (`CurrentRevision`)          | `WrongExpectedVersionError.actualState` (`CurrentStreamState`)  |

`streamName` unchanged.

```ts
try {
  await client.appendToStream("order-7", event, { streamState: NO_STREAM });
} catch (err) {
  if (err instanceof WrongExpectedVersionError) {
-   logger.warn(
-     `Conflict on ${err.streamName}: expected ${err.expectedVersion}, actual ${err.actualVersion}`
-   );
+   logger.warn(
+     `Conflict on ${err.streamName}: expected ${err.expectedState}, actual ${err.actualState}`
+   );
  }
}
```

Easy to miss when caught in only one place. Grep after the symbol rename:

```bash
grep -rn --include='*.ts' --include='*.js' 'expectedVersion\|actualVersion' src/
```

Filter to hits reading from `WrongExpectedVersionError`; unrelated local variables stay.

## 8. Node.js 20+ requirement

`@kurrent/kurrentdb-client` v1.x sets `"engines": { "node": ">=20" }`. Node 14 dropped in the same release.

- Bump `engines.node` to `>=20`.
- Update CI matrices: drop Node 14 / 16 / 18, add Node 20 (and 22).
- For `nvm`, update `.nvmrc` to a Node 20 LTS line.
- TypeScript projects on `ES2020` or older compile but should move `lib` / `target` to at least `ES2021` to match client assumptions.

v18 installs but is unsupported. Green tests on v18 are not evidence of production fitness (async-iterable + AbortSignal paths exercise v20-era behaviour).

## 9. Constructor TLS options removed

Previous constructor accepted `{ rootCertificate, certChain, privateKey }` directly. Those are gone. With connection-string-only construction, TLS configures via query parameters or file-path options:

```
kurrentdb://node1:2113?tls=true&tlsCAFile=/etc/kurrentdb/ca.pem
kurrentdb://node1:2113?tls=true&userCertFile=/etc/kurrentdb/user.pem&userKeyFile=/etc/kurrentdb/user.key
```

Previous shape:

```ts
// EventStoreDB gRPC
const client = new EventStoreDBClient(
  { endpoint: "node1:2113" },
  { rootCertificate: fs.readFileSync("/etc/kurrentdb/ca.pem") },
  { username: "admin", password: "changeit" }
);
```

Replace with:

```ts
// KurrentDB
const client = KurrentDBClient.connectionString(
  // credentials sourced from configuration, never literal
  buildKurrentDbConnectionString({
    host: "node1:2113",
    tls: true,
    tlsCAFile: "/etc/kurrentdb/ca.pem",
  })
);
```

`buildKurrentDbConnectionString` is a project-local helper pulling credentials and CA paths from configuration. Inlining the file path is fine; inlining credentials is not.

User-certificate auth (`userCertFile` + `userKeyFile`) still works the same way. Only the constructor-side `certChain` / `privateKey` shortcut is gone.

## 10. OpenTelemetry tag rename

If using OpenTelemetry (`@eventstore/opentelemetry` to `@kurrent/opentelemetry`), span attribute names changed with the package:

| EventStoreDB OTel       | KurrentDB OTel             |
|-------------------------|----------------------------|
| `db.esdb.user`          | `db.kurrent.user`          |
| `db.esdb.system`        | `db.kurrent.system`        |
| `db.esdb.operation`     | `db.kurrent.operation`     |
| `db.esdb.subscription.id` | `db.kurrent.subscription.id` |
| `db.esdb.event`         | `db.kurrent.event`         |
| `db.esdb.event.type`    | `db.kurrent.event.type`    |
| `db.esdb.stream`        | `db.kurrent.stream`        |

Update dashboards, alerts, and log-pipeline filters matching `db.esdb.*` to the new prefix in the same change. No aliasing layer: old queries return nothing after the upgrade.

## Rebrand checklist

Before declaring the rebrand done, confirm:

- [ ] `@eventstore/db-client` removed from `package.json` and lockfile. `@kurrent/kurrentdb-client` at latest 1.x.
- [ ] If the project used OTel: `@eventstore/opentelemetry` removed, `@kurrent/opentelemetry` referenced, dashboards / alerts moved from `db.esdb.*` to `db.kurrent.*`.
- [ ] No `from "@eventstore/db-client"` import specifiers remain. All imports use `@kurrent/kurrentdb-client`.
- [ ] `EventStoreDBClient` symbol gone. `KurrentDBClient` in its place.
- [ ] Every `new EventStoreDBClient(...)` (or `new KurrentDBClient(...)`) replaced with `KurrentDBClient.connectionString(...)`. `new` keyword does not appear on the client anywhere.
- [ ] No `.on("data", ...)` / `.on("error", ...)` / `.on("end", ...)` calls on `readStream`, `readAll`, or any `subscribeTo*` result. All consumption is `for await`.
- [ ] On `appendToStream` call sites, option key is `streamState`, never `expectedRevision`. `deleteStream`, `tombstoneStream`, `setStreamMetadata` deliberately **kept** as `expectedRevision`.
- [ ] `WrongExpectedVersionError.expectedVersion` / `.actualVersion` reads replaced with `.expectedState` / `.actualState`. Logging, metrics, tests updated.
- [ ] Type annotations updated: `AppendExpectedRevision` to `AppendStreamState`, `CurrentRevision` to `CurrentStreamState`.
- [ ] Connection strings standardised on `kurrentdb://` (or `kurrentdb+discover://`) at the next configuration touch. `esdb://` only where a deliberate compatibility window is in effect, deprecation warning on every construction tolerated.
- [ ] No literal `user:pass@` credentials in any connection string in source or in configuration committed to the repo. Credentials sourced from configuration or a secret manager.
- [ ] `engines.node` and every CI workflow matrix updated to Node 20+.
- [ ] If the previous code constructed `EventStoreDBClient` with `{ rootCertificate, certChain, privateKey }`: those values now flow through `tlsCAFile` / `userCertFile` / `userKeyFile` connection-string parameters, or per-call credentials.
- [ ] `npm install` / `yarn install` clean. No `@eventstore/*` transitive dependencies in the lockfile (other than unrelated, non-Kurrent packages).
- [ ] Integration tests run end-to-end against a real KurrentDB target (the project's own suite).
