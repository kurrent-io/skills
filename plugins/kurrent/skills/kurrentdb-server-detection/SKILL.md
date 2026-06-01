---
name: kurrentdb-server-detection
description: Use when inventorying a deployed KurrentDB or EventStoreDB server for its version, cluster topology, license status, and deployment method by reading runtime endpoints, deployment manifests, and on-disk version banners. NOT for client SDK state (use kurrentdb-client-detection), Kurrent Cloud projects, or migration execution.
---

# KurrentDB / EventStoreDB server detection

Inventory a deployed KurrentDB / EventStoreDB cluster's state. Produce a structured report covering version, topology, license, and deployment method. Downstream consumers (a future server-upgrade workflow, or a human asking "what are we running?") use the report to plan an upgrade or answer the question without further probing.

## When to use

- Before any server version-to-version upgrade, to confirm the source and target.
- During incident triage, when the deployed version is unclear.
- Standalone, when answering "what version is our cluster on?" or "is the license still valid?".

## What this skill does not do

- Does not execute an upgrade or restart any node. Read-only.
- Does not inventory client applications. Use `kurrentdb-client-detection`.
- Does not interact with Kurrent Cloud's control plane or the `esc` CLI.

## Authoritative-source ordering

When signals disagree, apply this precedence:

1. **Runtime probe** (`/info`, `/gossip`) is authoritative for what is **actually running**. A 24.6.0 node reporting itself is 24.6.0, regardless of what the manifest says.
2. **Deployment manifest** (compose / k8s / Helm / systemd) is authoritative for what was **intended to run**. Useful when the runtime is unreachable, or when explaining drift.
3. **Image tag** alone is the **weakest** signal. `:latest` resolves to whatever the registry served at pull time; static tags can be re-pushed. Never trust a tag without a probe.

Report drift between (1) and (2) explicitly. Never silently pick one.

> **Critical:** probe **every** node in a cluster, not just the first reachable one. A partitioned node may report itself as Leader while the rest of the cluster has elected a different one. A 3-node `replicas: 3` cluster needs three probes; report any node that refuses to answer as a separate row.

## Workflow

Run the passes in order. Skip a pass when its inputs are unavailable (no live endpoint, no manifests) and note the omission in the report.

### Pass 1: detect the deployment method

Look for these artefacts in the working directory and on the host:

| Found                                                                                           | Deployment method   |
| ----------------------------------------------------------------------------------------------- | ------------------- |
| `docker-compose*.yml` / `compose*.yml` mentioning `eventstore` / `kurrentdb` images             | **Docker Compose**  |
| `Dockerfile` referencing `eventstore/eventstore` or `kurrent/kurrentdb`                         | **Container image** |
| `*.yaml` with `kind: StatefulSet` / `kind: Deployment` and an `eventstore` or `kurrentdb` image | **Kubernetes**      |
| `Chart.yaml` with `kurrentdb` / `eventstoredb` chart name; `values*.yaml` setting cluster size  | **Helm**            |
| `/etc/systemd/system/eventstore.service` or `/etc/systemd/system/kurrentdb.service`             | **systemd**         |
| `/etc/eventstore/eventstore.conf` or `/etc/kurrentdb/kurrentdb.conf`                            | **bare metal / VM** |

Report each instance separately. A single cluster may show up under both a Helm chart and a Kubernetes manifest; that is the chart producing the manifest, not two deployments.

### Pass 2: probe the runtime

If a node is reachable, hit the endpoints in [`references/probes.md`](references/probes.md). Capture:

- Product name and version (`/info`).
- Cluster member list and roles (`/gossip`).
- Storage / projection / subscription stats (`/stats`).
- Whether HTTP is open or TLS-only (which scheme the endpoint answered on).

Do not probe in production without explicit user confirmation. The endpoints are read-only but may be subject to rate limits or audit logging.

If no node is reachable, skip this pass and note it.

### Pass 3: parse deployment manifests

For each artefact found in Pass 1, extract the **declared** version, topology, and config:

- Image tag (e.g. `kurrent/kurrentdb:25.0.1` or `eventstore/eventstore:24.10.0-jammy`). Strip OS suffixes (`-jammy`, `-alpine`).

  > **Important:** the `eventstore/eventstore` repository name does not imply legacy / EventStoreDB-only. Tags `23.x` and `24.x` ship the same server that `kurrent/kurrentdb` ships at the matching version. The repository was kept for backward compatibility during the rebrand. Classify by version, not by image name.

- Replica count or node list. A `replicas: 3` in a Kubernetes StatefulSet implies a 3-node cluster; a `docker-compose.yml` with three `eventstore.node{1,2,3}` services implies the same.
- Cluster-related env vars: `EVENTSTORE_CLUSTER_SIZE`, `EVENTSTORE_DISCOVER_VIA_DNS`, `EVENTSTORE_GOSSIP_SEED`, `KURRENTDB_CLUSTER_SIZE`, etc.
- TLS env vars: `EVENTSTORE_INSECURE`, `EVENTSTORE_CERTIFICATE_FILE`, `KURRENTDB_INSECURE`, etc.
- License env vars: `EVENTSTORE_LICENSE_KEY`, `KURRENTDB_LICENSE_KEY`.

When the declared version (Pass 3) and the runtime version (Pass 2) disagree, report **both** rows and flag the drift. Do not silently prefer one.

### Pass 4: identify license status

A KurrentDB cluster is **commercial** when a license key is present or commercial-only features are enabled. Otherwise it is **OSS**.

Indicators:

- `EVENTSTORE_LICENSE_KEY` / `KURRENTDB_LICENSE_KEY` env var present and non-empty.
- `/info` response includes a `licensed: true` field on commercial builds.
- Connector / archiver / read-replica features configured (commercial-only as of KurrentDB 25.x).

Report **commercial / OSS / unknown**. Do not guess from the image tag alone; the same image runs in both modes depending on the license key.

### Pass 5: produce the inventory report

Emit a structured report:

```
## Kurrent server inventory (<scope>)

### Deployments
| Deployment              | Method          | Declared image           | Runtime version (probe) | Topology         | TLS  | License     |
|-------------------------|-----------------|--------------------------|-------------------------|------------------|------|-------------|
| ops/k8s/eventstore.yaml | Kubernetes      | eventstore/eventstore:24.10.0 | 24.10.0 (probed)   | 3-node cluster   | on   | commercial  |
| docker-compose.yml      | Docker Compose  | kurrent/kurrentdb:25.0.1 | (unreachable)           | single node      | off  | OSS         |

### Drift
- ops/k8s/eventstore.yaml declares 24.10.0, but the running node reports 24.6.0. Investigate before any upgrade plan.

### Cluster details (per probed node)
- node1.example.com:2113: role Leader, epoch 142, last commit 9382194
- node2.example.com:2113: role Follower, epoch 142, last commit 9382194
- node3.example.com:2113: role Follower, epoch 142, last commit 9382194
```

Close with a one-line summary: `Inventory complete. <N> deployments found. <K> with version drift. Highest version: <X>. Lowest version: <Y>.`

## Decision rules

- **Image tag is `:latest`**: report as such, then probe runtime to get the actual version. Do not infer.
- **Image is `eventstore/eventstore` vs `kurrent/kurrentdb`**: both are valid; the rebrand kept the legacy image working. Do not flag the legacy image as a problem; only report.
- **No probe response and no manifests**: report "unknown deployment" and stop. Ask the user to point at the cluster's compose file, k8s namespace, or hostname.
- **Multiple clusters in one workspace** (e.g. dev + staging compose files): report each as a separate deployment row.
- **`/gossip` returns an empty member list** on a single-node setup: that is expected; report as a single-node cluster, not as a probe failure.

## How agents use this skill

A future `server-upgrade` agent will call this skill in its detection phase. The inventory determines whether a rolling upgrade is possible (3-node cluster), whether commercial-only features must be preserved (license: commercial), and whether the cluster is currently consistent (no drift between declared and runtime versions).

This skill ships before the consuming agent so that:

1. Human callers can answer "what version are we on?" today.
2. Detection logic is built and reviewable independently of upgrade logic.
3. The future server-upgrade agent imports a known-good detector instead of bundling its own.
