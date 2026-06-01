---
name: kurrentdb-connection
description: Use when working on, updating, or reviewing code that instantiates or configures a KurrentDB gRPC client across the supported SDKs. Covers connection-string parameters, single-node versus gossip discovery for clusters, node preference for read and write splits, HTTP/2 keepalive for long-lived connections behind NAT or load balancers, default deadlines, serverless client reuse, and triage of connection-related failures like discovery timeouts, deadline exceeded, keep-alive resets, and TLS verification errors. Do NOT use for authentication mechanics, certificate provisioning on the server, EventStoreDB to KurrentDB migration, or server-side cluster sizing.
---

# KurrentDB connection configuration

## Overview

You are configuring or reviewing how an application connects to KurrentDB through its gRPC client. The goal is a configuration that fits the deployment shape, not defaults copied blindly.

**Key levers:**
- Topology and discovery: `kurrentdb://` single-node vs `kurrentdb+discover://` gossip
- Node selection: `nodePreference` for read/write splits
- Channel health: `keepAliveInterval` / `keepAliveTimeout` for long-lived connections
- Call duration: `defaultDeadline` (never low on a subscription client)

## Core principle: context before configuration

**Never set connection-string parameters or settings-builder calls without first understanding the deployment shape.** Arbitrary values for `nodePreference`, `keepAliveInterval`, `defaultDeadline`, or the discovery parameters produce silent failures: subscriptions die under NAT, writes pay a redirect to the wrong node, deadlines cut streams mid-flight. Justify every non-default value against something you actually know about the environment.

## The KurrentDB client model

A KurrentDB client is **one long-lived object per process** that owns one HTTP/2 channel per cluster node it knows about. HTTP/2 multiplexes many concurrent calls over each channel, so concurrent operations ride the same connection.

- **One client for the whole app.** Construct it once at startup and keep it for the process lifetime. Never construct or dispose per request. Every SDK's getting-started says the same: "the client can be used as a singleton across the whole application; it does not need to open or close the connection."
- **The connection string is the configuration surface.** It is identical across all six SDKs. The four levers that matter are: how the client finds nodes (`kurrentdb://` vs `kurrentdb+discover://`), which node it prefers (`nodePreference`), how it keeps the HTTP/2 channel alive (`keepAliveInterval` / `keepAliveTimeout`), and how long a single call may run (`defaultDeadline`).
- **Subscriptions are long-lived server-streaming RPCs** on the same channel as everything else. Channel health and keepalive matter far more here than for one-shot reads and writes.
- **No built-in retries.** The client does not retry transient errors. If retries are required, route to the retry-policy guidance in [`kurrent-upgrade/references/grpc-retry-policy.md`](../kurrent-upgrade/references/grpc-retry-policy.md). Do not work around it with extra clients or shorter deadlines.

## Connection string parameters

The settings-builder API differs per language; see [`references/per-language.md`](references/per-language.md) for the per-SDK construction calls.

### Topology

| Scheme                     | When to use                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `kurrentdb://host:2113`    | Single-node deployments. Talks directly to one node. No failover.                                      |
| `kurrentdb+discover://...` | Clusters of any size, including single-node v22.10+. Uses gossip to pick a node and supports failover. |

The legacy `esdb://` and `esdb+discover://` schemes still parse on v25+ for backward compatibility, but new code uses the `kurrentdb` prefixes.

```text
✅ Cluster: kurrentdb+discover://cluster.example.internal:2113
✅ Single node, local: kurrentdb://localhost:2113?tls=false
❌ Cluster pinned to one node: kurrentdb://node1.example.internal:2113   (no failover)
```

### Discovery and node selection

| Parameter             | Default  | When to override                                                                                                                    |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `nodePreference`      | `leader` | `follower` or `readOnlyReplica` for read-only clients; keep `leader` for any client that writes or runs a leader-only subscription. |
| `maxDiscoverAttempts` | `10`     | Raise on unreliable links between client and cluster (cross-region, flaky VPN). Each attempt costs `discoveryInterval`.             |
| `discoveryInterval`   | `100` ms | Raise to back off while a cluster is mid-election. Lower for latency-sensitive workloads on stable networks.                        |
| `gossipTimeout`       | `5` s    | Raise on high-latency cross-region links where a 5 s gossip call legitimately runs long.                                            |

### Channel health for long-lived connections

| Parameter           | Default                  | When to override                                                                                                                                                                                            |
| ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keepAliveInterval` | `10` s                   | Behind NAT, proxies, or load balancers that close idle TCP connections, keep it at or below half the idle timeout. Set to `-1` only when the network never drops idle sockets (you almost never know this). |
| `keepAliveTimeout`  | `10` s                   | Raise if the network has bursty latency that legitimately exceeds 10 s round-trips. Lowering it makes the client tear down silently-broken channels faster.                                                 |
| `defaultDeadline`   | none (10 s on some SDKs) | Set explicitly per workload. **Do not set a low default deadline on a client that also serves subscriptions**; the deadline applies to the whole stream and will cut it.                                    |

### Security

| Parameter       | Default | Notes                                                                                                                                                                               |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tls`           | `true`  | Set to `false` only for insecure-mode local dev. Production clusters always run secure mode.                                                                                        |
| `tlsVerifyCert` | `true`  | Setting to `false` is a development-only convenience. Production must verify against a trusted CA or a `tlsCaFile` you control. Surface this on review: it silences MITM detection. |
| `tlsCaFile`     | None    | Path to the CA bundle when the cluster cert is signed by a private CA.                                                                                                              |

### Observability

| Parameter        | Notes                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionName` | Free-form label that surfaces in server-side connection metrics and the admin UI. Set it to something that identifies the app instance. |

## Configuration scenarios

Pick the scenario that matches the deployment, then justify each non-default value. If two apply (a serverless app behind aggressive NAT, say), combine the recommendations.

### Single-node local development

```text
kurrentdb://localhost:2113?tls=false
```

- Insecure local node, no failover, no NAT, no auth.
- One client built at process start, reused across the test suite or dev server.

### Cluster, mixed read and write workload

```text
kurrentdb+discover://node1.example.internal:2113,node2.example.internal:2113,node3.example.internal:2113?nodePreference=leader&keepAliveInterval=10&keepAliveTimeout=10&connectionName=orders-api
```

- `+discover://` so the client follows leader elections.
- `nodePreference=leader` is the default and correct when the same client writes and subscribes.
- Keepalive at defaults (10 s / 10 s) is fine on a healthy intra-VPC link. Across regions or behind a tight-idle-timeout load balancer, see the NAT scenario below.

### Read-only client (read models, projections consumers, reporting)

```text
kurrentdb+discover://...:2113?nodePreference=follower&keepAliveInterval=10&connectionName=read-model-projector
```

- `nodePreference=follower` offloads reads from the leader. Use `readOnlyReplica` when the cluster has read-only replicas provisioned and the workload should never touch a voting member.
- For separate read and write paths in one app, build **two clients** with different `nodePreference` values rather than sharing one. Node preference is bound to the client; they share nothing internal.

### Subscriptions and persistent consumers

- Reuse the same client as the rest of the app. Do not build a dedicated client just for subscriptions.
- **Do not set a low `defaultDeadline`.** Subscriptions are server-streaming RPCs; a deadline applies to the whole stream and tears it down when it fires. Set per-call deadlines on writes and reads instead, using the SDK's per-call override.
- Keepalive matters more here than anywhere else: a long-lived stream with no application traffic relies on HTTP/2 PINGs to notice a half-open TCP socket. Always set explicit keepalive on subscription-heavy clients.

### Serverless (Lambda, Cloud Functions, Cloud Run, Azure Functions)

```text
kurrentdb+discover://...:2113?keepAliveInterval=10&keepAliveTimeout=10&gossipTimeout=3&defaultDeadline=5000&connectionName=fn-checkout-handler
```

- **Build the client outside the handler.** Module-level construction reuses the channel across warm invocations and avoids paying TCP + TLS + gossip cost per request.
- `gossipTimeout=3` favours fail-fast over the default 5 s when the request budget is small.
- A modest `defaultDeadline` (a few seconds) fits a single-digit-second function timeout, but only if the function does not also subscribe.
- Cold-start cost is the connect + gossip round-trip. There is no warm-up lever; the first invocation on a cold instance pays it.

### High-latency or cross-region links

```text
kurrentdb+discover://...:2113?gossipTimeout=10&maxDiscoverAttempts=20&keepAliveInterval=20&keepAliveTimeout=10
```

- Raise `gossipTimeout` to a multiple of the observed round-trip.
- Raise `maxDiscoverAttempts` so a single packet loss does not collapse discovery.
- Tune `keepAliveInterval` against the network's idle timeout, not against latency.

### Behind aggressive NAT, load balancers, or corporate proxies

```text
kurrentdb+discover://...:2113?keepAliveInterval=20&keepAliveTimeout=10
```

- Set `keepAliveInterval` to at most half the network's idle-connection timeout (AWS NLB default is 350 s, Azure Load Balancer default is 4 min, many corporate NAT gateways are 60-300 s).
- If keepalive cannot be raised and the LB closes the connection anyway, accept it and rely on the SDK reconnecting plus your retry policy.

## Environmental context to gather

Before recommending a value, confirm these. Ask one at a time, broad to narrow:

- **Topology.** Single-node or cluster? How many members? Read-only replicas in use?
- **Deployment shape.** Long-running server, serverless function, or batch job? One process per host or many?
- **Workload mix.** Writes, reads, subscriptions, persistent consumers, or all of them on the same client?
- **Network path.** Same VPC, cross-region, behind a load balancer, behind NAT, over a VPN, over the public internet?
- **Latency.** Approximate round-trip from client to nearest cluster member?
- **TLS posture.** Secure or insecure mode? Cluster cert signed by a public CA, a private CA, or self-signed?
- **SDK and version.** Which language and client version? Older clients lacked some of the parameters above.

If an answer is unavailable, assume the default-defensible shape (cluster + leader + 10 s keepalive + no global deadline) and disclose the assumption inline in comments.

## Validate against the docs before presenting

Before handing the user a connection string or client-construction code, validate it against the current reference by invoking the `kurrent-docs` skill. The connection-string surface, SDK APIs, and package versions drift between releases; do not trust memory for exact names or values. Cross-reference:

- **Connection-string parameters.** Confirm every parameter name, scheme, and value is current for the user's SDK. Read `client-sdks/<lang>/getting-started.md` (for Python, `client-sdks/python/connection-strings.md`, which documents URI parsing on its own page).
- **Client construction.** Verify the package name, install command, version, and settings-builder calls match the current SDK. Check the chosen language's `getting-started.md` and reconcile `references/per-language.md` against it, fixing any drift in favour of the docs.
- **Authentication, TLS, and advertise hosts.** If the config carries credentials, certs, or depends on server-advertised addresses, confirm against `client-sdks/<lang>/authentication.md` and `database/configuration/networking.md`.

If you find discrepancies, fix the config silently and present the corrected version; don't surface the memory-vs-docs diff to the user.

After validating, point the user at the docs skill for anything past connection setup: "Validated against the current KurrentDB SDK docs. For API details beyond connecting (appends, subscriptions, projections), use the `kurrent-docs` skill."

## What this skill does NOT cover

- **Authentication mechanics.** X.509 user certs, username/password, JWT, ACL. Route to `kurrent-docs` `client-sdks/<lang>/authentication.md`.
- **Server-side TLS provisioning.** Issuing certs, rotating them, FIPS. Route to `kurrent-docs` `database/security/`.
- **Retries and resilience.** The gRPC client has no built-in retries. Route to [`kurrent-upgrade/references/grpc-retry-policy.md`](../kurrent-upgrade/references/grpc-retry-policy.md).
- **Migration from legacy EventStoreDB clients.** Route to `kurrent-upgrade`.
- **Server-side `maxIncomingConnections` and OS file-descriptor limits.** Route to `kurrent-docs` `database/configuration/`.
- **A cluster that is actually broken** (leader election stuck, split-brain, gossip storm). Route to the `troubleshooter` agent.

## Additional Resources

### Reference Files

- **`references/per-language.md`** - Per-SDK client construction (.NET, Java, Node.js, Python, Go, Rust)
- **`references/troubleshooting.md`** - Decision tree for common connection failures
