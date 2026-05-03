# CLAUDE.md

You are an AI agent (Claude Code) working on this project. Follow these instructions strictly.

## Project: my-project

Stack: not detected
Framework: [TAUSIK](https://github.com/Kibertum/tausik-core) — AI agent governance implementing [SENAR v1.3](https://senar.tech)

## Hard Constraints (non-negotiable)

Quality gates (`.tausik/tausik gates status`) enforce these automatically.

- **No code without a task.** Run `task start <slug>` before any Write/Edit. No exceptions. (SENAR Rule 9.1)
- **QG-0 Context Gate.** `task start` requires goal + acceptance_criteria with at least one negative scenario. Set both before starting.
- **QG-2 Implementation Gate.** `task done --ac-verified` requires evidence in task logs and passing quality gates (pytest, ruff/lint). Log AC verification via `task log` before closing.
- **No commit without gates.** Gates run automatically — fix blocking failures before committing.
- **No direct DB access.** Use MCP tools or CLI. Never raw SQLite.
- **Don't guess CLI arguments.** Run `.tausik/tausik <cmd> --help` or read the CLI reference.
- **MCP-first.** Prefer MCP tools (`tausik_*`) over CLI when equivalent.
- **Git: ask before commit/push.** Always request user confirmation.
- **Max 400 lines per file.** Filesize gate warns. Exceptions: tests, generated code.
- **Continuous logging.** Run `task log <slug> "message"` after every meaningful step. (SENAR Rule 9.4)
- **Document dead ends.** Run `.tausik/tausik dead-end "approach" "reason"` on failed approaches. (SENAR Rule 9.4)
- **Checkpoint every 30-50 tool calls.** Save context periodically. (SENAR Rule 9.3)
- **Session limit: 180 min.** `.tausik/tausik status` warns on overrun. Close the session before starting a new one. (SENAR Rule 9.2)

## Workflow

```
start → plan → task → [review | test] → commit → end
```

- `start` — load session state, active tasks, handoff from previous session
- `plan` — create task with complexity scoring + stack detection
- `task <slug>` — pick up or continue a task
- `review` — code review with parallel sub-agents (bugs, fake tests, drift)
- `test` — run or write tests
- `commit` — standardized commit with SENAR metadata
- `end` — close session with handoff for next agent

**Cost-aware model selection:** `tausik suggest-model <complexity>` prints a recommended Claude model (Haiku for simple 1 SP tasks, Sonnet for medium 3 SP, Opus for complex 8 SP). Claude Code doesn't switch models programmatically — apply the suggestion via `/fast` or settings.

## Tool Routing — when to use which

Don't reach for `Grep`/`Glob` first. TAUSIK ships dedicated retrieval MCP servers; using them keeps context lean and surfaces project-specific knowledge that raw text search cannot.

| Need | Primary | Fallback |
|---|---|---|
| Find a function/symbol/usage in code | `mcp__codebase-rag__search_code` | `Grep` (only if RAG returns no hits or index is stale) |
| Recall a past project decision | `tausik_decisions_list` / `tausik_memory_search` (`type=convention/pattern`) | — |
| Cross-project pattern or gotcha | `mcp__tausik-brain__brain_search` | — |
| Web lookup (docs, API, errors) | `mcp__tausik-brain__brain_get` against the cached web result first | `WebFetch` (auto-cached on success) |
| Understand the project structure | `tausik_status` + `tausik_roadmap` | `Glob` for raw file listing |

Run `mcp__codebase-rag__rag_status` once per session to confirm the index is fresh. If `chunks=0`, run `mcp__codebase-rag__reindex` before any `search_code` call.

## Memory (two systems — use the right one)

| System | Where | When |
|---|---|---|
| **TAUSIK memory** (`memory add`) | `.tausik/tausik.db` | Patterns, dead ends, conventions specific to THIS project |
| **Agent auto-memory** | agent-specific (e.g. `~/.claude/...`) | User preferences, cross-project habits |

Memory types: `pattern`, `gotcha`, `convention`, `context`, `dead_end`.

Skills that need persistent data respect the `CLAUDE_PLUGIN_DATA` env var when set; otherwise fall back to `.tausik/plugin_data/`.

## SENAR Rules Compliance

TAUSIK enforces these rules. Violating them triggers warnings or hard blocks.

| Rule | Purpose | Enforcement |
|---|---|---|
| QG-0 Context Gate | Goal + AC + negative scenario before starting | Hard (blocks task_start) |
| QG-2 Implementation Gate | Evidence + AC verified + gates pass before done | Hard (blocks task_done) |
| Rule 1 Task before code | No Write/Edit without active task | Hard (PreToolUse hook) |
| Rule 2 Scope Boundaries | Declare scope + scope_exclude per task | Warning |
| Rule 3 Verify Against Criteria | Per-criterion evidence | Warning |
| Rule 7 Root Cause | Defect tasks require root cause | Warning |
| Rule 9.2 Session limit | 180 min per session | Hard (blocks task_start) |
| Rule 9.3 Checkpoint | Every 30-50 tool calls | Instruction |
| Rule 9.4 Dead Ends + Logging | Document failed approaches, log progress | Instruction |

Full rule set: [SENAR v1.3](https://senar.tech).

## Commands Quick Reference

```bash
.tausik/tausik status                          # project overview + warnings
.tausik/tausik task list                       # list tasks
.tausik/tausik task start <slug>               # activate (QG-0 enforced)
.tausik/tausik task done <slug> --ac-verified  # complete (QG-2 enforced)
.tausik/tausik task log <slug> "message"       # log progress
.tausik/tausik dead-end "approach" "reason"    # document failure
.tausik/tausik metrics                         # SENAR metrics
.tausik/tausik search "<query>"                # FTS5 search
```

## Quality Gates

Gates auto-run on commits, task done, and explicit checks. Stack-specific lint/test gates auto-enable by detected stack. Filesize gate warns on files >400 lines.

Check status: `.tausik/tausik gates status`. Fix blocking failures before committing.

## Skills

After bootstrap, **13 core skills** ship from `agents/skills/` and are always available: `/start`, `/end`, `/checkpoint`, `/plan`, `/task`, `/ship`, `/commit`, `/review`, `/test`, `/debug`, `/explore`, `/interview`, `/brain`.

**25+ official/vendor skills** install on demand via `tausik skill install <name>` from the `tausik-skills` repo or `skills-official/`: `/audit`, `/zero-defect`, `/markitdown`, `/excel`, `/pdf`, `/docs`, `/security`, `/onboard`, `/retro`, `/ultra`, `/jira`, `/bitrix24`, `/sentry`, ... See `.claude/references/skill-catalog.md`.

When a user request matches a trigger keyword for a not-installed skill, proactively suggest installing it.

## Roles

Role field is free text. Common: `developer`, `architect`, `qa`, `tech-writer`, `ui-ux`.
Role profiles live in `.claude/roles/<role>.md`.

## Response Language

Always respond in the user's language.

<!-- DYNAMIC:START -->
## Current State
Session: #3 (active) | Branch: main | Version: 1.3.5
Tasks: 14/17 done, 1 active, 0 blocked
Active: fix-rembg-destroying-handwriting-signatures
<!-- DYNAMIC:END -->
