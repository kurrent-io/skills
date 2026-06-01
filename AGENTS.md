# AGENTS.md - Guidelines for AI Agents

This repository contains Agent Skills for working with KurrentDB and its ecosystem — server operations, client SDKs, connectors, Kurrent Cloud, the `esc` CLI, upgrades and migrations, and event-sourcing best practices. These guidelines help AI coding agents edit and maintain these skills effectively.

## Repository Structure

This repo ships a single plugin, `kurrent`, under `plugins/kurrent/` (not at the repo root). The plugin directory holds the skills, the migration orchestration agents, the plugin-level assets, and the per-ecosystem plugin manifests (`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `plugin.json` for Copilot). The marketplace catalogs stay at the repo root and point their `source` at `./plugins/kurrent`. The plugin lives in a subdirectory rather than the repo root because Codex (`codex` issue #17066) rejects a plugin whose `source.path` resolves to the marketplace root; a subdirectory keeps every harness on a non-root source.

```
kurrent-skills/
├── plugins/
│   └── kurrent/                        # the single plugin
│       ├── skills/
│       │   └── <skill>/                # canonical skill content
│       │       ├── SKILL.md            # frontmatter + when-to-use + routing
│       │       ├── references/         # focused topic files (synced from upstream or authored)
│       │       ├── assets/             # optional static assets (e.g. compose files)
│       │       └── scripts/            # optional helpers
│       ├── agents/                     # migration orchestration agents (*.agent.md)
│       ├── assets/                     # plugin-level assets (logos, etc.)
│       ├── .claude-plugin/plugin.json
│       ├── .cursor-plugin/plugin.json
│       ├── .codex-plugin/plugin.json
│       └── plugin.json                 # GitHub Copilot CLI manifest
├── .claude-plugin/marketplace.json     # source -> ./plugins/kurrent
├── .cursor-plugin/marketplace.json     # source -> ./plugins/kurrent
├── .agents/plugins/marketplace.json    # Codex catalog (reads here, not .codex-plugin/); path -> ./plugins/kurrent
├── .github/plugin/marketplace.json     # Copilot catalog; source -> ./plugins/kurrent
├── evals/                              # eval harness, see Evals section
├── manifest.json / manifest.lock.json  # upstream sync mappings + pinned SHAs
└── .github/scripts/sync-docs.js
```

Current skill inventory (run `ls plugins/kurrent/skills/` to confirm):

- `kurrent-docs` — the everyday router for SDKs, server operations, Kurrent Cloud, and the `esc` CLI.
- `kurrentdb-client-detection` / `kurrentdb-server-detection` — inventory the app's client surface and the deployed server before a migration.
- `kurrent-upgrade` — onboard onto the KurrentDB gRPC client. Ships two flavours under `references/`: `tcp-to-grpc/` (port off the legacy EventStoreDB TCP client) and `rebrand/` (rebrand the EventStoreDB gRPC client to `KurrentDB.Client`).

Three agents under `agents/` cover the KurrentDB application lifecycle:

- `migration-specialist` drives client-SDK migrations (legacy TCP to gRPC, EventStoreDB to KurrentDB rebrand, esdb:// to kurrentdb:// switch) and hands off to `code-reviewer` once the work lands.
- `code-reviewer` runs in two modes: a standard idiomatic-usage review for pre-PR checks on any KurrentDB code, and a post-migration mode that additionally enumerates the legacy surface, checks git history for silent concurrency downgrades, and runs the project's build and tests as a gate.
- `troubleshooter` diagnoses runtime failures (connection errors, TLS issues, `WrongExpectedVersion`, subscription lag, cluster leader-election problems, scavenge hangs, projection divergence). Walks decision trees per failure mode and dispatches the detection skills to gather state.

Behavioural runtime verification belongs to the project's own test suite. The plugin ships no harness or smoke-runner skill; if the `troubleshooter` recommends runtime reproduction, the user spins up KurrentDB locally with the official Docker recipes.

Each skill is a directory containing:

- `SKILL.md` — frontmatter + when-to-use guidance + routing into `references/`
- `references/` — focused reference material the agent loads on demand
- `assets/` / `scripts/` — optional static assets and helper scripts the skill instructs the agent to use

## Agent Skills Specification

Follow the official [Agent Skills specification](https://agentskills.io/specification) for file formats, naming conventions, and content structure.

## Editing Guidelines

### File Size & Organization

- **Keep `SKILL.md` under 500 lines** — this is a hard limit for readability and token efficiency
- Put detailed content under `references/` as focused, single-topic files
- Use `SKILL.md` for routing: "When the user asks X, read `references/x.md`"
- Reference files larger than a few screens should be split

### YAML Frontmatter

Always include complete YAML frontmatter. Only `name` and `description` are required; Claude Code ignores any `version:` field, so versioning stays at the plugin level (`plugin.json`) rather than per-skill:

```yaml
---
name: skill-name
description: Complete, keyword-rich description of what this skill does, the exact terms/commands/error messages that should trigger it, and what NOT to use it for.
---
```

**The description field is critical** — it's how agents decide whether to load the skill. Make it:

- **Action-oriented**: use verbs like "configures", "migrates", "operates", "investigates"
- **Keyword-rich**: include API names, CLI flags, error strings, connection prefixes (`esdb://`, `kurrentdb://`), endpoints (`/admin/logs`, `/metrics`), config keys
- **Bounded**: if sibling skills exist, include a "Do NOT use for…" clause pointing to the correct one so routing stays unambiguous
- **Complete but concise**: one dense paragraph, not a list

### Skill Names Must Be Globally Unique

`name:` is the identifier downstream marketplaces (skills.sh, `npx skills`, plugin managers) use to address the skill — **the plugin folder does not namespace it**. Two skills with the same `name:` collide even when they live under different plugins.

Before merging a new skill, grep across the repo to confirm no other skill claims the same `name:`. Every current skill carries the `kurrent-` prefix to stay unambiguous downstream; any new skill should do the same. Reserve the bare name `kurrentdb` for a future server-operations skill if one is ever split out.

### Writing Style

- **Be prescriptive, not descriptive**: write "always use the gRPC client" not "consider the gRPC client"
- **Show don't tell**: include complete, copy-pasteable code with full imports / using statements
- **Bold critical information**: use **bold** for gotchas, breaking changes, ordering constraints
- **Structure for scanning**: headers, bullets, and tables — agents lift snippets, they don't read prose

### Code Examples

- **Include full imports / using statements** — never assume context
- **Make examples complete** — agents should be able to copy-paste and run
- **Match the SDK the skill covers** — if the skill is the .NET client, use C#; for the Node client, use TypeScript
- **Show working examples first**, then explain variations

Example snippet (`.NET` SDK):

```csharp
// ✅ Complete working example
using KurrentDB.Client;

var settings = KurrentDBClientSettings.Create("esdb://localhost:2113?tls=false");
await using var client = new KurrentDBClient(settings);

var data = JsonSerializer.SerializeToUtf8Bytes(new { name = "Alice" });
var evt  = new EventData(Uuid.NewUuid(), "user-registered", data);

await client.AppendToStreamAsync(
    "user-42",
    StreamState.Any,
    new[] { evt }
);
```

### DO/DON'T Patterns

Always show both what to do and what to avoid:

```csharp
// ✅ DO: Pass expected revision for optimistic concurrency
await client.AppendToStreamAsync(
    "order-7",
    StreamRevision.FromInt64(currentRevision),
    new[] { evt }
);

// ❌ DON'T: StreamState.Any silently overwrites concurrent writes
await client.AppendToStreamAsync("order-7", StreamState.Any, new[] { evt });
```

```text
✅ DO: Stream name = "<category>-<aggregateId>"    (account-42, order-7)
❌ DON'T: Stream name = "<event-type>"             (UserCreated, OrderPlaced)
```

### Cross-References

- Link to related references when concepts overlap; if a second skill is ever added, link to it the same way
- Reference specific sections: `See [persistent subscriptions](references/client-sdks/dotnet/persistent-subscriptions.md)`
- If sibling skills exist, make routing explicit in `SKILL.md` "Do NOT use for…" clauses so each skill knows which sibling to defer to

### Headers & Structure

Use consistent header patterns inside `SKILL.md`:

- `## Overview` — one paragraph on what the skill covers, followed by a `**Key ...:**` bullet list of the main levers/concepts (matches Claude Code's official skill layout)
- `## Routing` (or a domain-picker table, as in `kurrent-docs`) — when to use this skill vs siblings, or which reference file to load for a given user need
- `## Quick Reference` — common patterns / commands
- `## Additional Resources` — closes the skill; under a `### Reference Files` sub-heading, a bullet list of `**`references/x.md`** - one-line description` entries pointing into `references/`. Follow Claude Code's convention here; do not use a `## Files` table.

## Reference Docs Are Synced From Upstream

Most files under `plugins/kurrent/skills/*/references/` are pulled from upstream Kurrent repositories (KurrentDB, the client SDKs, documentation). They carry a `synced from <repo>@<sha>` header comment.

- **Do not hand-edit synced files** — changes are overwritten on the next sync
- Fix content upstream first (e.g. `kurrent-io/KurrentDB`), then re-sync here
- The mapping lives in [`manifest.json`](./manifest.json); the pinned SHAs live in `manifest.lock.json`

```sh
bun run sync           # Sync at pinned revisions from manifest.lock.json
bun run sync:update    # Re-resolve to latest refs, update the lock file
```

## Evals (`evals/`)

A separate, repo-root harness validates each skill on two independent axes:

1. **Quality (A/B)** — with the skill loaded, does the output beat baseline (no skill)?
2. **Trigger** — does Claude pick the right skill for a query, and defer to siblings otherwise?

Current coverage: `kurrent-docs` only. Add other skills by dropping in new test files, no config changes required.

The two axes use two different runners, so the tree keeps them apart: `quality/` is self-contained promptfoo (config, prompts, providers, cases), and `trigger/` is just the JSON eval-sets that Anthropic's `run_eval.py` consumes. Nothing in `trigger/` is touched by promptfoo.

```
evals/
├── quality/                      # promptfoo A/B
│   ├── promptfooconfig.yaml
│   ├── prompts/baseline.cjs      # baseline provider's prompt (user message only)
│   ├── providers/skill-agent.cjs # with-skill provider (agentic tool loop)
│   └── cases/<skill>.yaml        # promptfoo cases, globbed by the config
└── trigger/<skill>.json          # routing eval-sets for run_eval.py
```

The quality eval is a two-provider A/B keyed on `vars.skill`. The `baseline` provider answers from the model alone (paired with `evals/quality/prompts/baseline.cjs`, which sends only the user message). The `with-skill` provider is the custom agent at `evals/quality/providers/skill-agent.cjs`: it mounts `plugins/kurrent/skills/<skill>/SKILL.md` as the system prompt and exposes `list_skill_files` / `read_skill_file` tools jailed to the skill directory, then runs a tool-execution loop so the model performs progressive disclosure for real (router → pick a `references/` file → read it → answer). Keep both providers on the same model so lift measures the skill, not a model gap.

The skill-agent is provider-agnostic via `config`:

- `api`: `anthropic` (Messages API) or `openai` (chat-completions, which covers OpenAI, DeepSeek, Together, Groq, Mistral, and any OpenAI-compatible endpoint). Default `anthropic`.
- `model`: required, the raw API model id (e.g. `deepseek-v4-pro`, `claude-haiku-4-5-20251001`).
- `baseUrl`: defaults per `api` (`https://api.anthropic.com`, `https://api.openai.com/v1`); override for DeepSeek (`https://api.deepseek.com`) or a local endpoint.
- `apiKeyEnv`: env var holding the key; defaults to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, override to `DEEPSEEK_API_KEY` etc.
- `max_tokens` (default 2048), `max_turns` (default 8 tool-loop iterations).

The chosen model must support tool calling; a model that can't call tools can't do progressive disclosure and the eval is meaningless for it. `evals/quality/cases/<skill>.yaml` holds promptfoo cases (globbed by `promptfooconfig.yaml`); `evals/trigger/<skill>.json` holds routing cases for Anthropic's `run_eval.py`.

### Prerequisites

```bash
npm i -g promptfoo
export ANTHROPIC_API_KEY=sk-ant-...
# Trigger evals + description optimization:
git clone https://github.com/anthropics/skills.git ~/anthropic-skills
```

### Quality eval (A/B)

From `evals/quality/`:

```bash
npx promptfoo@latest eval
npx promptfoo@latest view
```

Each test runs against both providers (`baseline` and `with-skill`); the report shows side-by-side pass rates.

- **with-skill ✅ / baseline ❌** — skill earns its place
- **both ✅** — Claude already knew it; no lift from this case
- **with-skill ❌ / baseline ✅** — regression

`lift = (with-skill pass rate) − (baseline pass rate)`. Use `--repeat 3+` for stability.

### Trigger eval

From `evals/`:

```bash
python ~/anthropic-skills/skill-creator/scripts/run_eval.py \
  --eval-set ./trigger/kurrent-docs.json \
  --skill-path ../plugins/kurrent/skills/kurrent-docs \
  --runs-per-query 3 --verbose
```

Run once per skill, pairing `trigger/<skill>.json` with `--skill-path ../plugins/kurrent/skills/<skill>`. A query that's positive in one file is intentionally negative in the others — each file is independently runnable.

### Description optimization

From `evals/`:

```bash
python ~/anthropic-skills/skill-creator/scripts/run_loop.py \
  --eval-set ./trigger/kurrent-docs.json \
  --skill-path ../plugins/kurrent/skills/kurrent-docs \
  --max-iterations 5 --holdout 0.4 --model claude-opus-4-5 --verbose
```

Review the proposed `description:` diff before committing.

### Add a new skill

Two files, no config changes:

1. `evals/quality/cases/<skill>.yaml` — promptfoo cases, each with `vars.skill: <skill>`
2. `evals/trigger/<skill>.json` — routing cases labeled from this skill's perspective

Adding a new skill needs no eval-config changes; the config globs `cases/*.yaml`, and the skill-agent's `SKILLS_ROOT` resolves to `plugins/kurrent/skills/`.

### When to re-run

| Change | Re-run |
| --- | --- |
| `SKILL.md` body or `references/*` | Quality |
| `description:` frontmatter | Trigger |
| Add/rename a sibling skill | Trigger (update negatives) |
| Upstream SDK release synced into `references/` | Quality |
| Before merge | Both |

## Testing Guidelines

There is no runtime test suite — skills are content, not code. Validation runs through the two sync checks.

### Code Verification

- **All code examples must compile/run** — test with the SDK's compiler or runtime
- **Verify against official docs** — cross-reference with the upstream Kurrent documentation
- **Test complete examples** — ensure imports, types, connection strings, and syntax are correct

### Documentation Accuracy

- Check links to KurrentDB and Kurrent Cloud documentation
- Verify API signatures match the current SDK version
- Confirm `esdb://` / `kurrentdb://` connection strings, ports, and TLS flags are correct

### Cross-Reference Validation

- Confirm links to other skills resolve to existing files
- Check that referenced `references/` sections exist
- Ensure "Do NOT use for…" clauses point at real, current skill names

### Sync Validation

- `bun run sync` reproduces `references/` cleanly from `manifest.lock.json`
- CI runs the same check on every PR (`.github/workflows/check.yml`)

## Naming Conventions

### Skill Directories

- Use lowercase with hyphens: `kurrent-docs`, `kurrent-upgrade`, `kurrentdb-connection`, `kurrentdb-client-detection`, `kurrentdb-server-detection`
- Prefix product-specific skills with `kurrentdb-` and ecosystem-wide skills with `kurrent-`; both stay unambiguous in flat marketplaces
- The directory name must match the frontmatter `name:`

### Plugin Manifests

The single plugin lives at `plugins/kurrent/`; the marketplace catalogs sit at the repo root and point their `source` at `./plugins/kurrent`. Per-ecosystem manifests live at:

- `plugins/kurrent/.claude-plugin/plugin.json` (Claude Code plugin manifest) and `.claude-plugin/marketplace.json` at the repo root (marketplace entry, `source: "./plugins/kurrent"`)
- `plugins/kurrent/.cursor-plugin/plugin.json` (Cursor — only `name` is strictly required, but mirror the Claude manifest's `description`, `version`, `author` for parity) and `.cursor-plugin/marketplace.json` at the repo root
- `plugins/kurrent/.codex-plugin/plugin.json` (Codex plugin manifest) and `.agents/plugins/marketplace.json` at the repo root (Codex marketplace catalog — Codex reads the catalog from `.agents/plugins/`, not `.codex-plugin/`; each entry's `source.path` is `./plugins/kurrent`, which must resolve to a subdirectory and not the marketplace root, per `codex` issue #17066)
- `plugins/kurrent/plugin.json` (GitHub Copilot CLI manifest — references `agents/` and `skills/` paths relative to the plugin directory)
- `.github/plugin/marketplace.json` at the repo root (Copilot marketplace listing, points `source` at `./plugins/kurrent`)

Keep `name`, `description`, and `version` consistent across all manifests and the marketplace entries. To add a second plugin, create `plugins/<plugin>/` with its own per-ecosystem plugin manifests and add a matching entry to each root marketplace catalog.

### Reference Files

- Use descriptive names: `from-tcp-dotnet.md`, `upgrade-to-v26-0.md`, `private-access/aws.md`
- Group related concepts in a single file; nest by topic when a skill has many references (`references/<topic>/<file>.md`)
- Keep filenames short but unambiguous

### Code Examples

- Use realistic stream and event names: `order-7`, `user-registered`, `payment-completed`
- Match KurrentDB conventions: streams are `<category>-<aggregateId>`, event types are past-tense verbs
- Show practical use cases (optimistic concurrency, catch-up subscriptions, persistent subscriptions), not abstract examples

## Content Guidelines

### What to Include

- **Practical patterns** agents will actually use (append with expected revision, subscribe to `$all`, configure ACLs)
- **Complete working examples** for every major concept
- **Routing rules** — for a router skill like `kurrent-docs`, a domain-picker table that maps user needs to specific reference files; for any future multi-skill split, "when to use this skill vs siblings" baked into the description and a routing table
- **Error handling and retry guidance** — gRPC deadline, `WrongExpectedVersion`, leader election, gossip
- **Operational considerations** — IOPS, disk, gossip, TLS, license keys, support windows

### What to Avoid

- **Incomplete examples** that won't compile or connect
- **Abstract concepts** without a copy-pasteable snippet
- **Outdated patterns** — the TCP client, the old `EventStoreConnection` API, `eventstore`-prefixed metric names. The current SDK references cover the gRPC client only; if legacy-TCP guidance is ever needed, put it in its own reference file (or skill) rather than mixing it into the gRPC SDK material
- **Overly verbose explanations** — agents skim; lead with the answer
- **Hand-edited content under `references/` that's actually synced from upstream** — fix the source instead

## Maintenance

### Regular Updates

- After adding or changing a skill or agent, document it in the [`README.md`](./README.md) tables. Keep each row short and relaxed: a noun phrase plus a "Covers ..." sentence, no inline code or em dashes. This is deliberately lighter than the frontmatter `description:`, so don't sync it back to the verbose version.
- Resync references on KurrentDB / client-SDK / documentation releases (`bun run sync:update`)
- Update examples when SDK APIs change
- Remove deprecated patterns. Guidance for the legacy TCP client (`EventStoreConnection`) should never appear alongside the gRPC SDK references
- Keep reference links and version paths current

### Quality Checks

Before opening a PR:

```sh
bun run sync                 # references/ matches the lockfile
git status                   # should be clean
```

CI runs the sync check on every PR and will fail on any drift.

Remember: these skills are tools for AI agents building and operating on KurrentDB. Prioritise clarity, completeness, and correctness over cleverness.
