---
name: kurrent-docs
description: Use when the user is working with KurrentDB, from writing application code against the client SDKs to operating the self-hosted server or running on Kurrent Cloud.
---

# Kurrent Documentation

Match the user's need to the row, then take the action. Load _only_ the files the action names. Don't pull in a whole section. The actual answers live in the linked file, not in this index.

Route top to bottom: first check whether a sibling skill owns the request, then pick a domain, then load the file. Don't backtrack.

## Does a sibling skill own this?

Some requests belong to a more specialized skill. Check these first; defer if one matches, otherwise route within this skill below.

| User need                                                                                                                                            | Defer to                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"My app can't connect"** triage, or **tuning the client** (connection-string parameters, `nodePreference`, keepalive, deadlines, serverless reuse) | `kurrentdb-connection`. This index has the raw parameter reference; that skill has the opinionated guidance on what to set. If the failure is server-side (cert, ACL, gossip), also load the Database or Cloud files named below. |
| **Querying events with SQL** (ad-hoc in the UI or via Arrow Flight SQL), or **creating a user-defined index** to query/filter by a payload field     | `kurrentdb-index-queries`. It owns the `kdb.records` / `usr."<index>"` SQL surface, Flight SQL client setup, and user-defined index creation.                                                                                     |
| **Migrating or upgrading** a client SDK or server (legacy TCP to gRPC, EventStoreDB to KurrentDB rebrand, version upgrades)                          | `kurrent-upgrade`.                                                                                                                                                                                                                |

## Pick a domain

| User need                                                                                                                                                                                  | Action                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Application code calling KurrentDB from **.NET, Java, Node.js, Python, Go, or Rust**: `AppendToStream`, `SubscribeToAll`, `EventData`, catch-up vs persistent subscriptions, gRPC errors   | Go to [Client SDKs](#client-sdks)                     |
| The **self-hosted KurrentDB server** itself: install/upgrade, config flags, TLS, ACLs, `/admin/logs`, `/metrics`, scavenge, projections, indexes, HTTP API, connectors (Kafka/Mongo/SQL/…) | Go to [Database (self-hosted)](#database-self-hosted) |
| **Kurrent Cloud**: `console.kurrent.cloud`, VPC/VNet peering, Tailscale, K8s connectivity, sizing, backups, Cloud-side Terraform/Pulumi, CloudWatch/Opsgenie/Slack integrations            | Go to [Cloud](#cloud)                                 |

## Client SDKs

Files live at `references/client-sdks/<lang>/<topic>.md`. Pick **one** language (`dotnet`, `java`, `nodejs`, `python`, `go`, `rust`) and load only the topics the question actually touches. Don't load multiple languages for the same topic. For any code answer, follow the rules under [Writing answers](#writing-answers).

| User need                                                                      | Action                                    | Available in                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| First connection, package install, building a `KurrentDBClient`                | Read `<lang>/getting-started.md`          | all 6                                                          |
| `AppendToStream`, expected revision, optimistic concurrency, idempotent writes | Read `<lang>/appending-events.md`         | all 6                                                          |
| Single stream or `$all`, forward/backward, reading from a revision             | Read `<lang>/reading-events.md`           | all 6                                                          |
| Catch-up subscriptions, live tail, checkpointing the last-seen position        | Read `<lang>/subscriptions.md`            | all 6                                                          |
| Server-managed consumer groups, ack/nack, parking                              | Read `<lang>/persistent-subscriptions.md` | all 6                                                          |
| Soft delete vs hard delete (tombstone), truncate-before                        | Read `<lang>/delete-stream.md`            | all 6                                                          |
| Managing/reading projections from the client SDK                               | Read `<lang>/projections.md`              | dotnet, java, nodejs, python, go (not rust)                    |
| Username/password, certificates, per-call user credentials                     | Read `<lang>/authentication.md`           | dotnet, java, nodejs, go, rust                                 |
| OpenTelemetry instrumentation, traces, metrics                                 | Read `<lang>/observability.md`            | dotnet, java, nodejs, python                                   |
| Parsing/building `kurrentdb://` and `esdb://` URIs                             | Read `<lang>/connection-strings.md`       | python (other langs cover this inline in `getting-started.md`) |

## Database (self-hosted)

Files live at `references/database/`. This is everything about the KurrentDB server process: binary, configuration, security, diagnostics, operations, HTTP API, and the server-managed features (projections, indexes, queries, connectors).

### Install, upgrade, release info

| User need                                                         | Action                                       |
| ----------------------------------------------------------------- | -------------------------------------------- |
| Installing the server binary (Docker, package managers, tarballs) | Read `quick-start/installation.md`           |
| Data, log, and config paths by platform                           | Read `quick-start/default-directories.md`    |
| Upgrading between versions, breaking-change pre-flight            | Read `quick-start/upgrade-guide.md`          |
| Recent feature additions                                          | Read `quick-start/whatsnew.md`               |
| Per-version changelog                                             | Read `release-schedule/release-notes.md`     |
| Support windows, EOL dates                                        | Read `release-schedule/previous-versions.md` |
| What the binary phones home, opting out                           | Read `usage-telemetry.md`                    |

### Configuration

| User need                                                   | Action                                |
| ----------------------------------------------------------- | ------------------------------------- |
| How config works: file vs env vars vs CLI, precedence rules | Read `configuration/configuration.md` |
| Storage layout, chunks, indexes/cache, scavenge tuning      | Read `configuration/db-config.md`     |
| Gossip seeds, leader election, cluster sizing               | Read `configuration/cluster.md`       |
| Ports, interface binding, advertise hosts                   | Read `configuration/networking.md`    |

### Security

| User need                                                 | Action                                 |
| --------------------------------------------------------- | -------------------------------------- |
| TLS for client/internal traffic, FIPS, certificate chains | Read `security/protocol-security.md`   |
| Auth provider config, anonymous access toggles            | Read `security/security-options.md`    |
| Built-in user store, internal vs external auth            | Read `security/user-authentication.md` |
| ACLs, `$admins`/`$ops` groups, default ACL                | Read `security/user-authorization.md`  |

### Diagnostics & monitoring

| User need                                          | Action                               |
| -------------------------------------------------- | ------------------------------------ |
| `/admin/logs`, log structure, levels, sinks        | Read `diagnostics/logs.md`           |
| `/metrics` Prometheus endpoint, exact metric names | Read `diagnostics/metrics.md`        |
| Exporters/dashboards (Grafana, Datadog, …)         | Read `diagnostics/integrations.md`   |
| What to alert on, SLI selection                    | Read `diagnostics/best-practices.md` |

### Operations

| User need                                             | Action                             |
| ----------------------------------------------------- | ---------------------------------- |
| Filesystem-level backups and restore procedure        | Read `operations/backup.md`        |
| Manual scavenge, when it's needed and what it does    | Read `operations/scavenge.md`      |
| Scheduling scavenge across the cluster                | Read `operations/auto-scavenge.md` |
| Rotating TLS certs without downtime                   | Read `operations/cert-update.md`   |
| Erasing event payloads (GDPR / right-to-be-forgotten) | Read `operations/redaction.md`     |

### HTTP API

| User need                                               | Action                                   |
| ------------------------------------------------------- | ---------------------------------------- |
| When to use HTTP vs gRPC, supported operations          | Read `http-api/introduction.md`          |
| Endpoints, request/response formats                     | Read `http-api/api.md`                   |
| `ES-` / `Kurrent-` headers: expected version, event IDs | Read `http-api/optional-http-headers.md` |
| Driving persistent subscriptions over HTTP              | Read `http-api/persistent.md`            |
| HTTP auth: Basic, JWT, certs                            | Read `http-api/security.md`              |

### Server features

| User need                                                         | Action                                      |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Embedded Web UI, what each page does                              | Read `features/admin-ui.md`                 |
| Stream semantics: `$all`, system streams, max age/count, metadata | Read `features/streams.md`                  |
| Offloading old chunks to cold storage                             | Read `features/archiving.md`                |
| Server-side view of persistent subs (queue model, settings)       | Read `features/persistent-subscriptions.md` |

### Projections (server-side)

| User need                                          | Action                                   |
| -------------------------------------------------- | ---------------------------------------- |
| What projections are, system vs user               | Read `features/projections/intro.md`     |
| `$by_category`, `$by_event_type`, `$streams`, etc. | Read `features/projections/system.md`    |
| Writing JS projections, partitioning               | Read `features/projections/custom.md`    |
| Enabling, threading, checkpoint behaviour          | Read `features/projections/settings.md`  |
| The new projection engine and migration path       | Read `features/projections/engine-v2.md` |
| End-to-end walkthrough                             | Read `features/projections/tutorial.md`  |

### Indexes & queries

| User need                                                                             | Action                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------- |
| The built-in PTable/MemTable index                                                    | Read `features/indexes/default.md`      |
| Secondary indexes, when and why                                                       | Read `features/indexes/secondary.md`    |
| Defining your own indexes (creating/querying one routes to `kurrentdb-index-queries`) | Read `features/indexes/user-defined.md` |
| Query browser inside the admin UI (SQL workflow routes to `kurrentdb-index-queries`)  | Read `features/queries/ui.md`           |
| Apache Arrow Flight SQL endpoint (client setup routes to `kurrentdb-index-queries`)   | Read `features/queries/flightsql.md`    |

### Connectors

KurrentDB's built-in source/sink connectors, managed by the server itself, configured per stream. Files at `references/database/features/connectors/`. Start with `intro.md` for the model, then load the **one** sink/source file for the system the user is wiring up.

| User need                                              | Action                        |
| ------------------------------------------------------ | ----------------------------- |
| What connectors are, source vs sink model              | Read `intro.md`               |
| Filtering, transformations, retries, DLQ               | Read `features.md`            |
| Creating/starting/stopping connectors via API or UI    | Read `manage.md`              |
| Common config keys: filter, checkpointing, parallelism | Read `settings.md`            |
| Per-connector metrics and health signals               | Read `metrics.md`             |
| Forward events to Kafka                                | Read `sinks/kafka.md`         |
| Write events to MongoDB                                | Read `sinks/mongo.md`         |
| Write events to a SQL database                         | Read `sinks/sql.md`           |
| Write events to Elasticsearch                          | Read `sinks/elasticsearch.md` |
| Generic HTTP / webhook sink                            | Read `sinks/http.md`          |
| Forward events to Apache Pulsar                        | Read `sinks/pulsar.md`        |
| Forward events to RabbitMQ                             | Read `sinks/rabbitmq.md`      |
| Stream events into a Serilog-compatible logger         | Read `sinks/serilog.md`       |
| Ingest from a Kafka topic into a KurrentDB stream      | Read `sources/kafka.md`       |
| Ingest from inbound HTTP webhooks                      | Read `sources/webhook.md`     |

## Cloud

Kurrent Cloud. Files at `references/cloud/`.

### Orientation

| User need                                          | Action                 |
| -------------------------------------------------- | ---------------------- |
| What Cloud is, regions, organization/project model | Read `introduction.md` |
| Common pre-sales / pre-onboarding questions        | Read `faq.md`          |

### Getting started & networking

| User need                                           | Action                                         |
| --------------------------------------------------- | ---------------------------------------------- |
| Standing up a cluster on a public network           | Read `getting-started/public.md`               |
| AWS PrivateLink / VPC peering to a Cloud cluster    | Read `getting-started/private-access/aws.md`   |
| Azure Private Link / VNet peering                   | Read `getting-started/private-access/azure.md` |
| GCP Private Service Connect / VPC peering           | Read `getting-started/private-access/gcp.md`   |
| Public-network connectivity model                   | Read `networking/public-network.md`            |
| Private-network connectivity model                  | Read `networking/private-network.md`           |
| Connecting a Kubernetes workload to a Cloud cluster | Read `guides/kubernetes.md`                    |
| Tailscale-based access                              | Read `guides/tailscale.md`                     |

### Operations

| User need                                            | Action                         |
| ---------------------------------------------------- | ------------------------------ |
| Picking instance class, capacity planning            | Read `ops/sizing.md`           |
| Cloud-managed backups, restore, retention            | Read `ops/backups.md`          |
| The "Jobs" model for long-running cluster operations | Read `ops/jobs.md`             |
| Cluster lifecycle event feed                         | Read `ops/events.md`           |
| SSO, MFA, org/project roles                          | Read `ops/account-security.md` |
| Migrating from self-hosted to Cloud                  | Read `guides/migration.md`     |

### Infrastructure as Code

| User need                                    | Action                         |
| -------------------------------------------- | ------------------------------ |
| `kurrent-io/kurrentcloud` Terraform provider | Read `automation/terraform.md` |
| Pulumi provider                              | Read `automation/pulumi.md`    |

### Cloud-side integrations

| User need                                 | Action                            |
| ----------------------------------------- | --------------------------------- |
| Forwarding metrics/logs to AWS CloudWatch | Read `integrations/cloudwatch.md` |
| Alert routing to Opsgenie                 | Read `integrations/opsgenie.md`   |
| Slack notifications for cluster events    | Read `integrations/slack.md`      |

## Same word, two domains

Some terms map to a client-SDK file or a server/cloud file depending on whether the user is writing app code or operating the cluster. Disambiguate by that, then route.

| User need                      | App code (Client SDKs)                                                                       | Server / operations                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **"Subscribe to events"**      | `<lang>/subscriptions.md` (catch-up), `<lang>/persistent-subscriptions.md` (consumer groups) | As a server-side bridge into Kafka/Mongo/SQL/etc., Database `features/connectors/`                                                  |
| **"Projections"**              | `<lang>/projections.md` (read/create from the client)                                        | Configuring server projections, JS bodies, engine tuning: Database `features/projections/`                                          |
| **"Persistent subscriptions"** | `<lang>/persistent-subscriptions.md` (consume from one)                                      | Operating the server side (groups, parking, settings): Database `features/persistent-subscriptions.md`                              |
| **"Indexes"**                  | (none; see `kurrentdb-index-queries` for user-defined)                                       | What they are server-side (storage, build, config): Database `features/indexes/secondary.md`                                        |
| **"Provision a cluster"**      | (none)                                                                                       | Managed: Cloud `getting-started/` + `automation/`. Self-hosted: Database `quick-start/installation.md` + `configuration/cluster.md` |

A request can genuinely span domains (e.g. a .NET app reading from a peered Cloud cluster). Load files from both in parallel; the tables don't overlap, so it's cheap.

## Writing answers

**Code answers must be runnable.** Topic files show only the operation and assume the setup above them, so for any code request also load `<lang>/getting-started.md` and assemble a self-contained snippet: imports, client construction from a connection string, and an inline definition of any payload type you reference (with the getters/fields serialization needs). Never return a fragment with an undefined `client` or payload class.

**Copy exact names from the reference file**, don't reconstruct them from memory. Kurrent rebranded from EventStore and the names mutated in non-obvious ways:

- `EventStore.Client` → `KurrentDB.Client` (the .NET package; equivalents in every language)
- `EventStoreDB` → `KurrentDB` (server binary, docs, client class names)
- `EventStore/eventstorecloud` → `kurrent-io/kurrentcloud` (Terraform provider)
- `esdb://` → `kurrentdb://` (connection-string scheme on v25+; `esdb://` still works when either side predates the rename)

**A package-manager coordinate is not the import path.** Take the namespace, package, module, or `use` path verbatim from the reference file's own example code; never reconstruct it from the install coordinate. The two routinely differ across every language (e.g. Java installs `io.kurrent:kurrentdb-client` but imports `io.kurrent.dbclient.*`; .NET's `KurrentDB.Client` package and namespace happen to match, others don't). If the reference shows the install line but no import, the import still comes from the example, not the artifact id.
