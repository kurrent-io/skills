# Runtime probes

HTTP / gRPC endpoints to probe a running KurrentDB / EventStoreDB node for version, topology, and stats. Pair with the workflow in `../SKILL.md`.

## Connecting

KurrentDB exposes HTTP on the same port as gRPC (default `2113`). The probe URL form is:

- TLS-on: `https://<host>:2113/<endpoint>`
- TLS-off (`--insecure` / `KURRENTDB_INSECURE=true`): `http://<host>:2113/<endpoint>`

Use `curl -sS -k` for ad-hoc probes (`-k` to tolerate self-signed certs that are common in dev / on-prem). For production, prefer the user's existing client cert or token.

If basic auth is enabled, default credentials are `admin:changeit` unless overridden. Never assume defaults work; prompt the user if `401` is returned.

## `/info`

```
GET /info
```

Returns product name, version, edition, and (on commercial builds) license status.

Sample (KurrentDB 25.0.1, OSS):

```json
{
  "esVersion": "25.0.1.0",
  "edition": "Community",
  "features": []
}
```

Sample (commercial):

```json
{
  "esVersion": "24.10.0.0",
  "edition": "Commercial",
  "features": ["Connectors", "Archiver"],
  "licensed": true
}
```

**Use for:** authoritative runtime version, license edition, enabled commercial features.

**Caveats:**

- Older EventStoreDB builds (< 21.x) return only `esVersion`. Absence of `edition` does not imply OSS; check the license env var instead.
- The version field is dotted four-segment (`25.0.1.0`). Strip the trailing `.0` when comparing to a SemVer image tag (`25.0.1`).

## `/gossip`

```
GET /gossip
```

Returns the cluster member list with roles, epochs, and last commit positions.

Sample (3-node cluster):

```json
{
  "members": [
    {
      "instanceId": "9f...",
      "httpEndPointIp": "10.0.0.11",
      "httpEndPointPort": 2113,
      "state": "Leader",
      "isAlive": true,
      "epochNumber": 142,
      "lastCommitPosition": 9382194,
      "writerCheckpoint": 9382194,
      "chaserCheckpoint": 9382194
    },
    { "...": "second member" },
    { "...": "third member" }
  ]
}
```

**Use for:** cluster size, roles (Leader / Follower / ReadOnlyReplica / Manager), liveness, replication lag.

**Caveats:**

- Single-node setups return a one-member list with `state: Leader`. Do not treat that as a cluster failure.
- Probe **every** known node, not just one. A partitioned node may report itself as Leader while the rest of the cluster has elected a different one. Report all responses; flag the disagreement.
- `epochNumber` mismatches across members indicate an election in flight. Do not start an upgrade based on a snapshot taken during an election.

## `/stats`

```
GET /stats
```

Returns process, storage, and subscription stats.

Relevant fields:

- `proc.mem`: process memory.
- `sys.disk.{path}.usedBytes` / `availableBytes`: chunk and index disk usage. Critical for upgrade planning (a v25 server needs the chunk format from the version it is upgrading from to be on disk).
- `es.lastCommitPosition`: write head.
- `es.indexCacheHitRate`: read performance signal.

**Use for:** capacity check before an upgrade, sanity-check that the node is healthy.

**Caveats:**

- `/stats` is expensive; do not hammer it. One probe per node is enough for inventory.

## `/subscriptions` and `/projections/all-non-transient`

```
GET /subscriptions
GET /projections/all-non-transient
```

Return persistent subscription groups and user-defined projections.

**Use for:** confirming whether commercial-only or workload-critical features are in active use before an upgrade.

## What probes do not tell you

- Whether the cluster has a license **that has not yet expired**. The `licensed: true` flag indicates a key is loaded, not that it is current. Cross-check the license expiry from the user's vault or the `EVENTSTORE_LICENSE_KEY` JWT claims.
- Chunk format version. Inferred from the server version; not exposed via HTTP. A major upgrade may require an offline chunk migration; consult the upgrade docs before scheduling.
- Whether replicas are in sync **at the byte level**. `lastCommitPosition` matching across nodes is the closest proxy; for byte-level certainty, the user must compare chunk checksums.

## Authentication and TLS gotchas

- `--insecure` mode disables auth entirely. If `/info` answers without credentials, the cluster is insecure; flag this prominently in the report. An insecure production cluster is itself an incident, separate from any upgrade work.
- Mutual TLS (`KURRENTDB_TRUSTED_ROOT_CERTIFICATES_PATH` + client cert required): probes from a host without the client cert will get `403`. Ask the user for a cert path or have them run the probe locally.
- Certificate expiry is not surfaced on `/info`. Read the cert from `KURRENTDB_CERTIFICATE_FILE` and decode the `Not After` field if the user asks; otherwise skip.
