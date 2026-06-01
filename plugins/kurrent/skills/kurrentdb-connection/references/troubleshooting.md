# Connection failure decision tree

Use this when the user reports a connection-related symptom. Ask one targeted question at a time, broad to narrow, and confirm the deployment shape before recommending a parameter change. The goal is to separate client-configuration issues (this skill) from infrastructure issues (route elsewhere) before suggesting changes.

## Start here

Get these three facts before anything else:

1. **Topology.** Single-node, multi-node cluster, or Cloud-managed?
2. **What changed.** New deployment, code change, infra change, or "worked yesterday"?
3. **Exact error.** Message, stack frame, RPC status, and whether it fires at startup or under load.

Then route by symptom.

## Symptom: cannot establish the initial connection

### `DiscoveryFailedException` / "all candidates failed" / gossip timeout at startup

- **`kurrentdb://` against a cluster:** wrong scheme. The client connects to one node and gets no failover. Switch to `kurrentdb+discover://`.
- **Wrong port:** the gRPC and HTTP port is typically `2113`. The legacy TCP port (`1113`) does not respond to gRPC.
- **`maxDiscoverAttempts` exhausted on a cross-region link:** raise `maxDiscoverAttempts` and `gossipTimeout` together. Defaults assume a healthy LAN.
- **DNS misconfigured:** if `cluster.example.internal` resolves but does not contain `A` records for every member, gossip cannot converge. Confirm with `dig +short cluster.example.internal`.
- **Advertised address unreachable from the client:** gossip hands the client the address in `AdvertiseHostToClientAs` (the client-facing advertise, distinct from `NodeHostAdvertiseAs` used between nodes). The client dials *that* address, not the seed in your connection string. If it does not resolve or route from the client machine, common on Cloud, NAT, or split-horizon DNS, discovery reads gossip fine and then fails to connect with `ECONNREFUSED` / `UNAVAILABLE` on the advertised host. Confirm every advertised address resolves and is reachable from the client, not just the seed. If the advertised value is an IP it must be in the cert IP SANs; if a hostname, in the DNS SANs, or TLS verification fails too.
- **Firewall / security group:** if the client can resolve but cannot reach any candidate, it is infrastructure, not config. Confirm with `nc -zv host 2113` or equivalent. Route to network team.
- **The exception is ambiguous.** "Failed to discover candidate in N attempts" is raised identically for dead nodes, a wrong `tls` setting, an untrusted cert, *and* unreachable advertised addresses. Do not assume the nodes are down. Wire up the SDK's logger factory (e.g. .NET `LoggerFactory` on the settings builder): TLS and certificate-verification errors only surface in those logs, never in the discovery exception message itself.

### TLS handshake failure: "remote certificate is invalid", "unable to verify the first certificate", `UNAVAILABLE: certificate verify failed`

- **Self-signed cert without CA:** dev workaround is `tlsVerifyCert=false`; production must set `tlsCaFile=/path/to/ca.pem` and trust the CA properly.
- **Hostname mismatch:** the client connects to an IP but the cert is for a DNS name. Connect by the name the cert was issued for, or reissue the cert with SANs covering both.
- **Mixed secure/insecure:** secure client against insecure cluster fails the handshake; insecure client (`tls=false`) against secure cluster fails the protocol negotiation. Confirm the server's mode.
- **CA bundle expired:** check expiry on `tlsCaFile` and the server cert.

### `tls=false` not accepted / "connecting to an insecure server requires tls=false"

The connection string omits `tls=false` for a non-secure node. Append it. There is no per-call insecure override.

## Symptom: connection works at startup, then fails later

### `DeadlineExceeded` on writes or reads

- **Global `defaultDeadline` too low for the workload:** raise it for the affected operation, but **never lower the global default if the same client serves subscriptions**.
- **Server-side slow path:** scavenge running, leader election in progress, or a 99th-percentile-slow stream. Confirm against server metrics (`kurrent-docs` `database/diagnostics/metrics.md`) before tuning the deadline.
- **No deadline set, request hangs forever:** opposite problem. Set `defaultDeadline` (or per-call deadline) so the operation fails rather than blocks the caller.

### Subscriptions die after minutes or hours with no traffic

Almost always idle-connection cleanup by a middlebox. Order of investigation:

1. **`keepAliveInterval` unset or higher than the network's idle timeout.** Set it to at most half the path's idle timeout. AWS NLB defaults to 350 s; many corporate NAT gateways are 60-300 s.
2. **`keepAliveTimeout` too high.** Lower it (5-10 s) so the client tears down silently-broken channels and reconnects faster.
3. **Load balancer with HTTP/2 ping disabled.** Some L7 LBs drop HTTP/2 PINGs; either enable them on the LB or accept reconnects.
4. **Application not re-subscribing on disconnect.** The client surfaces a stream cancellation; the app must catch it and resubscribe from the last checkpoint. This is not a configuration fix.

### `WrongExpectedVersion` after a write retry

Not a connection issue. Route to `kurrent-docs` `client-sdks/<lang>/appending-events.md` for optimistic-concurrency guidance and to `kurrent-upgrade/references/grpc-retry-policy.md` for the safe-retry contract.

### Writes intermittently slow or fail with "not leader" / leader redirect chatter

- **`nodePreference` not set to `leader` on a write client:** even with the default `leader`, confirm it is not overridden elsewhere. Following / random preferences pay a redirect round-trip on every write.
- **Cluster mid-election:** transient. Retry with backoff.
- **Application sharing one client across both read and write paths with `nodePreference=follower`:** split into two clients.
- **Cluster reached through a shared ingress or load balancer (K8s, OpenShift):** on a "not leader" response the client is redirected to the leader's *advertised* `hostname:port` and opens a fresh connection to exactly that address. If that hostname routes through a shared LB rather than to the specific node, the redirected connection can land on a different node and the redirect repeats. Each node must be individually addressable from the client for leader routing to work. KurrentDB has no built-in load balancer; do not put one in front of the gRPC / discovery path.

## Symptom: high latency or pathological behaviour under load

### Latency spikes correlate with new connections, not with queries

- **Multiple clients constructed per request:** the most common KurrentDB performance footgun. Search the codebase for places that build `new KurrentDBClient(...)`, `KurrentDBClient.connectionString` etc. inside request handlers. Move to a singleton.
- **Serverless without warm-instance reuse:** confirm the client is built outside the handler scope.

### Throughput plateaus far below cluster capacity

- **HTTP/2 max-concurrent-streams ceiling:** each channel multiplexes up to (default) 100 concurrent calls. Sustained workloads that hold many long-lived streams (heavy subscription fan-out, per-tenant catch-up jobs) can hit the ceiling on a single client. The fix is multiple clients with the same connection string, not a higher per-client limit (the server enforces 100). Use this lever rarely; query optimization is usually a better target.
- **All reads going to leader:** confirm `nodePreference=follower` on read-only clients to shed load off the primary.

### Connection churn (client connection count climbing on server metrics)

- **Client constructed per request or per job:** see "multiple clients per request" above.
- **Restart loops:** the app crashes and reconnects repeatedly. Connection config can't fix this; look at the app's exit reason.
- **Hot-reload tooling building new clients on every code change:** harmless in dev, alarming in metrics.

## Symptom: connection works in dev but fails in production

Run through this list:

- `tls=false` carried over from local config. Production is secure.
- `tlsVerifyCert=false` carried over from local config. Production must verify.
- `localhost` / `127.0.0.1` hard-coded in the connection string. Pull the connection string from configuration.
- `admin:changeit@` literal credentials. Replace with managed secrets.
- `kurrentdb://` carried over for a production cluster. Switch to `+discover://`.
- `defaultDeadline` defaulted in dev (10 s, plenty for localhost) is too tight for cross-region production.

## When to escalate out of this skill

| Symptom                                                                                       | Route to                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Authentication failures (bad credentials, expired cert, ACL denying access)                   | `kurrent-docs` `<lang>/authentication.md`      |
| Cluster genuinely unable to elect a leader, split-brain, gossip storm                         | `troubleshooter` agent                          |
| Need to design or audit a retry policy                                                        | `kurrent-upgrade/references/grpc-retry-policy.md` |
| Server-side `maxIncomingConnections`, OS file-descriptor limits, container resource pressure  | `kurrent-docs` `database/configuration/`       |
| Moving off the legacy TCP client or the EventStoreDB gRPC client                              | `kurrent-upgrade`                              |
