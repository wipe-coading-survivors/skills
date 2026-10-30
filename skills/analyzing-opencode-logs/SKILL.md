---
name: analyzing-opencode-logs
description: Use when finding, extracting, or verifying content from opencode session logs or transcripts — a finding or conclusion is missing from a report, an investigation seems "lost" after compaction, a message must be recovered by msg_id, or auditing what a session actually concluded
---

# Analyzing opencode logs

## Overview

The context window is lossy: auto-compaction replaces session history with a
summary. The session log is complete. Treat the log as the source of truth for
what a session found, concluded, and excluded — never the compaction summary.

Helper: `oclog.py` (works on `opencode export` JSON and the opencode SQLite
DB, stdlib only; `--help` for subcommands). Download it without routing the
content through the model context. Use the origin of the configured `skills`
MCP HTTP server (default `http://127.0.0.1:8080`):

```sh
mkdir -p /tmp/opencode
curl --noproxy '127.0.0.1,localhost' --fail --silent --show-error \
  http://127.0.0.1:8080/skill-file/analyzing-opencode-logs/oclog.py \
  --output /tmp/opencode/oclog.py
python3 /tmp/opencode/oclog.py --help
```

## Sources

| Source | What | Use for |
|---|---|---|
| `opencode session list` / DB table `session` | ids, titles, dates | finding the session |
| `opencode export <sessionID> > /tmp/ses_<id>.json` | full structured transcript | analysis (preferred) |
| `~/.local/share/opencode/opencode.db` (SQLite) | `session`/`message`/`part` (JSON in `data`), `event` | cross-session search |
| `~/.local/share/opencode/tool-output/tool_<partid>` | full text of truncated tool output | when `state.output` starts with `...output truncated...` |

Re-export if the session is still active — the export file grows.

## Export structure

```
{info: {id, title, tokens, version},
 messages: [{info: {role, id, time{created,completed}, tokens, parentID, finish},
             parts: [...]}]}
```

Part types: `text`, `reasoning`, `tool`, `patch`, `compaction`,
`step-start`, `step-finish`.

- Tool parts: `state.input` / `state.output`; truncated output →
  `state.metadata.outputPath` (file under `tool-output/`).
- **Answers to the `question` tool live in the tool part's `state.output`**
  ("User has answered your questions: ...") — they are NOT user messages.
- `compaction`: a user message with part `{auto, overflow, tail_start_id}`;
  the summary is the next assistant message; everything before
  `tail_start_id` was replaced by that summary.

## SQLite (DB)

Meta-info:

```sh
DB=~/.local/share/opencode/opencode.db
sqlite3 $DB ".tables"
sqlite3 $DB ".schema part"          # column list + indexes
sqlite3 $DB "PRAGMA table_info(message);"
```

`message`/`part` store row JSON in the `data` column; both are indexed by
`session_id`. The DB is large (GB) — no full-DB `LIKE` scans; export the
session first and analyze the JSON.

Examples:

```sh
sqlite3 $DB "SELECT id, title, datetime(time_created/1000,'unixepoch')
             FROM session ORDER BY time_created DESC LIMIT 20;"
sqlite3 $DB "SELECT id FROM part WHERE session_id='ses_…'
             AND data LIKE '%Jackpot%';"
sqlite3 $DB "SELECT json_extract(data,'\$.role'), count(*)
             FROM message WHERE session_id='ses_…' GROUP BY 1;"
```

## Recipes (helper)

```sh
oclog.py sessions <pattern>                 # find session in DB
oclog.py export ses_… -o /tmp/ses.json      # opencode export wrapper
oclog.py msg /tmp/ses.json msg_…            # one message, all parts
oclog.py find /tmp/ses.json "calc_hw_crc"   # phrase across all parts
oclog.py timeline /tmp/ses.json             # index/ts/role/tokens + compactions
oclog.py compactions /tmp/ses.json --keywords a,b,c   # what each summary kept/lost
oclog.py parts /tmp/ses.json msg_… --full   # deep-dive; --full follows outputPath
oclog.py range /tmp/ses.json 172 194        # messages by index
```

## Discipline

- Compaction summary ≠ conclusion. Verify any "the session concluded X"
  against the original messages (the LATEST message containing the conclusion,
  plus the ledger/report if one exists).
- Before closing a report: verify every "investigated / excluded" claim
  against the log or the ledger (verify-before-write).
- Record findings in reports/ledgers with `msg_id` references so they are
  re-derivable from the log.

## Common mistakes

- `rg` on pretty-printed export JSON: lines up to ~100 KB →
  `[Omitted long matching line]`. Use `oclog.py` / python3.
- Broad grep → output truncated to a file → read
  `state.metadata.outputPath`, do not re-run the command.
- Looking for user feedback only in user messages (question answers are in
  tool parts).
- Full-DB `LIKE` scans when an export would do.
- Stale export of an active session (re-export, check mtime).
