# Session-scoped commands

These operate on a single recorded session.

## Session-ID resolution

Every command here takes an optional `[sessionId]`. The identifier can be a session GUID or a meta-session slug (find them in the dashboard). When omitted, the current session is resolved automatically from the environment:

- `KCAP_SESSION_ID`, set by the Claude Code SessionStart hook.
- `CODEX_THREAD_ID`, exported by Codex CLI 0.81+.

So inside a recorded agent session, `kcap recap`, `kcap eval`, etc. run with no ID.

## `kcap recap`: session summary

```bash
kcap recap <sessionId>            # concise AI-generated summary (default)
kcap recap --full <sessionId>     # raw transcript instead of the summary
kcap recap --chain <sessionId>    # span the whole continuation chain
kcap recap --chain --full <sessionId>
kcap recap --repo                 # recent session summaries for the current repo
```

The default summary covers why the work was done, key decisions, and anything left unfinished. There is no `kcap summary` / `kcap history` command, it's `recap`.

## `kcap errors`: tool-call error extraction

```bash
kcap errors <sessionId>           # failed bash commands, file read/write errors, agent failures
kcap errors --chain <sessionId>   # across the full continuation chain
```

Useful for post-session review: spot recurring mistakes and update project instructions.

## `kcap eval`: LLM-as-judge scoring

```bash
kcap eval <sessionId>                     # default judge model: sonnet
kcap eval --model opus <sessionId>        # stronger judge (haiku | sonnet | opus)
kcap eval --chain <sessionId>             # include the full continuation chain
kcap eval --questions safety <sessionId>  # run only the 4 safety judges
kcap eval --questions safety,tests_written <sessionId>
kcap eval --skip efficiency <sessionId>   # everything except the efficiency questions
kcap eval --threshold 5000 <sessionId>    # keep more of each tool result before truncation (cap 200_000)
kcap eval --list-questions                # print the question taxonomy and exit
```

**What it does** — when you describe `kcap eval`, cover each of these:

- **13 questions across 4 categories**: safety, plan adherence, quality, efficiency.
- **Each question is asked of Claude in its own headless invocation** (a separate judge per question).
- **The default judge is text-only.** It reasons from the **compacted session trace embedded in its prompt** — the server's eval-context endpoint supplies that trace, and live tools (Read, Bash, Grep, WebFetch, ...) are **blocked**, so the judge works from the evidence in the prompt rather than hitting any service.
- A **few server-tagged questions instead get a read-only MCP tool surface** (`kcap-review`) to fetch context on demand. Mentioning this is correct but optional; describing "every judge has no tools" is an acceptable simplification.

Output is **a score per category plus an overall score** — each on a **1-5 scale with a pass / warn / fail verdict** — plus a finding and supporting evidence per question. The aggregate is persisted back to the session's stream as a `SessionEvalCompleted` event, so trends are queryable from the dashboard. Judges run sequentially; expect ~1-3 minutes total.

`--questions` and `--skip` are mutually exclusive and are the only flags that select which questions run. Both take category names (`safety`, `plan_adherence`, `quality`, `efficiency`) and individual question IDs (e.g. `tests_written`).

## `kcap validate-plan`: plan completion

```bash
kcap validate-plan <sessionId>
```

Verifies that all items in a session's plan were completed and reports what's left.

## `kcap hide` vs `kcap disable`: two different things

```bash
kcap hide [sessionId]       # owner-only visibility
kcap disable [sessionId]    # stop recording AND delete server data
```

- **`kcap hide`** sets the session to owner-only visibility. It **stays recorded**; other users simply stop seeing it in the dashboard. Reversible.
- **`kcap disable`** does three things at once:
  - **stops the watcher**,
  - **silences future hooks** (future hook events stop being sent), and
  - **deletes all server-side data** for the session (streams + read models).

  This is **irreversible on the server side and happens immediately with no confirmation prompt.** The local transcript file on disk is left untouched.

So the two differ on every axis: `hide` is a reversible visibility change that keeps the recording, while `disable` immediately and irreversibly deletes server data with no prompt. Neither touches the local transcript.

## `kcap set-title`

```bash
kcap set-title "<title>"      # set the current session's title
```
