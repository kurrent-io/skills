# Per-SDK client construction

The connection string is identical across every supported SDK. The settings builder is not. These snippets show the minimal one-client-per-process construction; load the parent `SKILL.md` first for what to put in the connection string.

Package versions and settings-builder signatures drift between releases. Before using a snippet, verify the package name, version, and construction API against the current docs by invoking the `kurrent-docs` skill and reading `client-sdks/<lang>/getting-started.md`; treat the docs as the source of truth over the pinned versions below.

Throughout these examples, credentials and host names are placeholders. Pull real values from environment variables or a secrets store; never commit `admin:changeit@` style defaults to production code.

## .NET (`KurrentDB.Client`)

```bash
dotnet add package KurrentDB.Client --version "1.1.*"
```

```csharp
using KurrentDB.Client;

var connStr = Environment.GetEnvironmentVariable("KURRENTDB_CONNECTION_STRING")
    ?? throw new InvalidOperationException("KURRENTDB_CONNECTION_STRING not set");

var settings = KurrentDBClientSettings.Create(connStr);
settings.ConnectionName = "orders-api";

var client = new KurrentDBClient(settings);
```

- Construct once at process start (DI singleton in ASP.NET Core: `services.AddSingleton(client)`).
- Settings exposes typed properties (`ConnectionivityType`, `DefaultDeadline`, etc.) if you prefer building outside the connection string. Stick to one source of truth per setting; don't set the same option in both places.
- For per-call deadlines, pass `deadline:` on the operation rather than relying on `DefaultDeadline`.

## Java (`com.kurrent:kurrentdb-client-java`)

```xml
<dependency>
  <groupId>io.kurrent</groupId>
  <artifactId>kurrentdb-client</artifactId>
  <version>...</version>
</dependency>
```

```java
import io.kurrent.dbclient.KurrentDBClient;
import io.kurrent.dbclient.KurrentDBClientSettings;
import io.kurrent.dbclient.KurrentDBConnectionString;

String connStr = System.getenv("KURRENTDB_CONNECTION_STRING");
KurrentDBClientSettings settings = KurrentDBConnectionString.parseOrThrow(connStr);
KurrentDBClient client = KurrentDBClient.create(settings);
```

- Thread-safe; share across the application. Spring users register it as a `@Bean` with default scope.
- Use the builder fluently for non-connection-string options when needed.

## Node.js (`@kurrent/kurrentdb-client`)

```bash
npm install @kurrent/kurrentdb-client
```

```ts
import { KurrentDBClient } from "@kurrent/kurrentdb-client";

const connStr = process.env.KURRENTDB_CONNECTION_STRING;
if (!connStr) throw new Error("KURRENTDB_CONNECTION_STRING not set");

export const client = KurrentDBClient.connectionString(connStr);
```

- Tag-template form (`KurrentDBClient.connectionString\`...\``) interpolates safely and is the idiomatic constructor.
- In serverless (Vercel, Lambda, Cloud Functions), export the client from a module loaded outside the handler so warm invocations reuse it.

## Python (`kurrentdbclient`)

```bash
pip install kurrentdbclient
```

```python
import os
from kurrentdbclient import KurrentDBClient, AsyncKurrentDBClient

conn_str = os.environ["KURRENTDB_CONNECTION_STRING"]

# Sync
client = KurrentDBClient(conn_str)

# Async (asyncio applications)
async_client = AsyncKurrentDBClient(conn_str)
```

- Pick one of `KurrentDBClient` or `AsyncKurrentDBClient`; don't mix in the same code path.
- The sync client is thread-safe and intended as a module-level singleton.

## Go (`github.com/kurrent-io/KurrentDB-Client-Go`)

```bash
go get github.com/kurrent-io/KurrentDB-Client-Go
```

```go
import (
    "os"
    "github.com/kurrent-io/KurrentDB-Client-Go/kurrentdb"
)

connStr := os.Getenv("KURRENTDB_CONNECTION_STRING")
settings, err := kurrentdb.ParseConnectionString(connStr)
if err != nil {
    panic(err)
}

db, err := kurrentdb.NewClient(settings)
if err != nil {
    panic(err)
}
```

- Store `db` in a package-level variable initialised in `main` / `init`. The client is safe for concurrent use.
- Pass `context.Context` with `WithDeadline` for per-call timeouts; do not rely on `defaultDeadline` for the long-lived subscription RPCs.

## Rust (`kurrentdb` crate)

```toml
kurrentdb = "..."
```

```rust
use kurrentdb::{Client, ClientSettings};

let conn_str = std::env::var("KURRENTDB_CONNECTION_STRING")?;
let settings: ClientSettings = conn_str.parse()?;
let client = Client::new(settings)?;
```

- `Client` is `Clone`-cheap (internal `Arc`); share it across tasks rather than constructing per task.
- Per-call deadlines come from the operation options builder, not from a global setting.

## Cross-SDK gotchas

- **Two clients for two `nodePreference` values.** Every SDK couples node preference to the client. If you need both leader-pinned and follower-pinned access, build two separate clients with two separate connection strings.
- **Insecure vs secure.** Every SDK requires `tls=false` in the connection string for insecure-mode local clusters; there is no separate "insecure mode" toggle on the settings builder in most SDKs.
- **Per-call credentials.** All six SDKs support passing per-call user credentials that override the connection-string ones. Use this for impersonation-style calls rather than building a second client per user.
