# Kurrent Agent Skills

A plugin marketplace that gives AI coding assistants (Claude Code, Cursor, Codex, and other agent platforms) first-class knowledge of [Kurrent](https://kurrent.io) and its ecosystem.

Each plugin ships focused references that the agent loads on demand, so it can answer your questions and write your code with accurate, up-to-date context instead of guessing.

## What's Included

The repository ships one plugin (`kurrent`) containing six skills and three agents covering everyday SDK and server use, client configuration, migration, code review, runtime diagnosis, and the kcap session-recording CLI.

### Skills

| Skill                                                                             | What it covers                                                                                                                                                                                                                                |
|-----------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [kurrent-docs](./plugins/kurrent/skills/kurrent-docs)                             | The everyday router for SDK and server work. Covers the six client SDKs, the self-hosted KurrentDB server, Kurrent Cloud, and the esc CLI. **Start here.**                                                                                    |
| [kurrentdb-connection](./plugins/kurrent/skills/kurrentdb-connection)             | Opinionated guidance for configuring the gRPC client across all six SDKs. Covers connection strings, node discovery, keepalive, deadlines, serverless reuse, and connection failure triage.                                                   |
| [kurrentdb-client-detection](./plugins/kurrent/skills/kurrentdb-client-detection) | Inventories the client surface in an application codebase. Finds which SDK, which connection scheme, and which call sites need rewriting.                                                                                                     |
| [kurrentdb-server-detection](./plugins/kurrent/skills/kurrentdb-server-detection) | Inventories a deployed server. Finds the version, cluster topology, license status, and deployment method.                                                                                                                                    |
| [kurrent-upgrade](./plugins/kurrent/skills/kurrent-upgrade)                       | Onboarding onto the gRPC client. Covers porting an app off the legacy TCP client and rebranding the EventStoreDB gRPC client to KurrentDB across six languages.                                                                               |
| [kurrent-capacitor-cli](./plugins/kurrent/skills/kurrent-capacitor-cli)                                     | Operating the kcap CLI (Kurrent Capacitor) that records Claude Code, Codex, and Cursor sessions. Covers install and setup, profiles, importing past sessions, recap and eval, the daemon and MCP servers, privacy controls, and plugin hooks. |

### Agents

Three agents cover the KurrentDB application lifecycle: migration, review, and runtime diagnosis.

| Agent                                                                          | What it covers                                                                                                                                                                                  |
|--------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [migration-specialist](./plugins/kurrent/agents/migration-specialist.agent.md) | Orchestrates a client migration. Detects the current client and connection scheme, routes to the right upgrade flavour, and walks through it step by step.                                      |
| [code-reviewer](./plugins/kurrent/agents/code-reviewer.agent.md)               | Reviews application code that uses the client SDKs. Covers idiomatic usage and anti-patterns, with a post-migration mode that audits the legacy surface and runs the build and tests as a gate. |
| [troubleshooter](./plugins/kurrent/agents/troubleshooter.agent.md)             | Diagnoses runtime failures. Covers connection and TLS errors, version conflicts, subscription lag, leader-election and gossip problems, scavenge hangs, and projection divergence.              |

Behavioural runtime verification belongs to the project's own integration tests. If `troubleshooter` recommends runtime reproduction, spin up KurrentDB locally with the official Docker recipes documented at https://docs.kurrent.io/.

## Installation

Pick your agent:

- **Claude Code** — full plugin, all six skills plus the three agents:

  ```bash
  /plugin marketplace add kurrent-io/skills
  /plugin install kurrent@kurrent-skills
  ```

  Then run `/reload-plugins` to activate it.

- **Any other agent** — skills only, via [skills.sh](https://github.com/vercel-labs/skills), which auto-detects Cursor, Cline, opencode, Windsurf, and 70+ others:

  ```bash
  npx skills add kurrent-io/skills --all
  ```

Cursor, Codex, and GitHub Copilot CLI also have native installs below (Copilot's installs the agents too). skills.sh installs skills only, not the three agents.

<details>
<summary><strong>Cursor</strong></summary>

Cursor installs this repo as a team marketplace straight from GitHub (Cursor 2.6+); no public listing required.

1. Open `Dashboard > Settings > Plugins`.

2. Under **Team Marketplaces**, click **Import**, paste the repository URL, and continue:

   ```text
   https://github.com/kurrent-io/skills
   ```

3. Review the parsed plugins, then install `kurrent`. Manage its rules and skills from the Rules section of Cursor Settings.

   > **Note:** On Enterprise plans only admins can add team marketplaces. For a private repo, grant the Cursor GitHub app read access when prompted. For local development, symlink the repo instead: `ln -s "$(pwd)" ~/.cursor/plugins/local/kurrent`.

</details>

<details>
<summary><strong>Codex</strong></summary>

1. Add the kurrent-io/skills marketplace to Codex:

   ```bash
   codex plugin marketplace add kurrent-io/skills
   ```

2. Start Codex and open the plugins browser:

   ```bash
   /plugins
   ```

3. Navigate to the "Kurrent Skills" tab and install the `kurrent` plugin.

   > **Note:** Codex's native plugin spec installs the skills but not the agents. Skills that delegate to them will still work, but Codex handles the orchestration inline instead of spawning specialised subagents. Once Codex's plugin spec supports custom agents, this gap goes away.

</details>

<details>
<summary><strong>GitHub Copilot CLI</strong></summary>

1. Add the marketplace:

   ```bash
   copilot plugin marketplace add kurrent-io/skills
   ```

2. Install the plugin:

   ```bash
   copilot plugin install kurrent
   ```

3. Verify it loaded:

   ```bash
   copilot plugin list
   ```

   From an interactive session, `/plugin list`, `/agent`, and `/skills list` should show the `kurrent` plugin.

</details>

<details>
<summary><strong>Local install from repository</strong></summary>

1. Clone the repository:

   ```bash
   git clone https://github.com/kurrent-io/skills.git
   ```

2. Install the skills for your harness:

   Copy the `skills/` directory (or individual skills under it)
   to the location where your coding agent reads its skills or context files.
   Refer to your agent's documentation for the correct path.

</details>

## Contributing

See [AGENTS.md](./AGENTS.md).

## License

See [LICENSE](./LICENSE) for license information.
