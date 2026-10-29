---
name: unix-process-ops
description: Use when running or waiting for long-running processes on remote (ssh) hosts — launching with nohup, capturing the PID with $!, waiting/polling for process exit, killing a stuck process, waiting for host ssh availability after reboot or power cycle, "pkill -f killed my ssh session" / pgrep self-match incidents.
---

# Unix process ops over ssh (launch, wait, kill, host reachability)

Canon for host-side process operations around long-running commands. The
domain skills (mellanox-flash-ops, ipmi-ops) reference this skill for the
mechanics; domain semantics (what to do when a process dies, what a log
line means, flash-semaphore consequences) stay there.

## Rule 1 — NEVER pgrep/pkill (especially -f)

`pkill -f <pattern>` / `pgrep -f <pattern>` match your OWN ssh session's
command line — the pattern text is literally in it — and kill your own
shell before the rest of the command runs. Live incident (burn-digest
cycle): `pkill -9 -f mstfwreset` killed the ssh session before `reboot`;
the reboot never ran, the target processes were dead anyway.

- First choice: work by PID (Rule 2) — no process matching at all.
- No PID (someone else's process)? Match by name with the BRACKET trick:
  `ps -ef | grep mstfwrese[t]` — the bracket keeps the grep's own command
  line out of the match.

## Rule 2 — Capture the PID at launch ($!)

Every long-running process is launched detached, with the PID echoed:

```sh
ssh <host> 'nohup <cmd> >/root/x.log 2>&1 & echo "PID: $!"'
```

From then on — everything by PID: wait (Rule 3), probe, kill (Rule 5).
Your own process never needs pgrep/grep.

## Rule 3 — Wait: ONE tool call, the loop INSIDE the command

Per-poll tool calls (20–30 round trips) flood the context. One command,
the loop inside, its own `timeout`; the tool-call timeout must be HIGHER
than the inner `timeout` (inner 600 s → tool timeout 660000 ms), or the
tool kills the loop. The state check ALWAYS runs after the loop.

By PID (first choice):

```sh
timeout 600 bash -c 'ssh <host> "while ps -p <PID> >/dev/null 2>&1; do sleep 10; done"; echo $?'
ssh <host> 'ps -p <PID> || echo exited; tail -c 400 /root/x.log | tr "\r" "\n" | tail -5'
```

By name (no PID — bracket trick, Rule 1):

```sh
timeout 600 bash -c 'ssh <host> "until ! ps -ef | grep mstfwrese[t] >/dev/null; do sleep 10; done"; echo $?'
```

rc: 0 = exited, 124 = inner timeout passed → re-loop if still running.
Logs: fixed window `tail -c N | tr '\r' '\n'` — never `cat`/`tail -f`
(`\r`-progress floods the context).

## Rule 4 — Wait for host ssh reachability (after reboot / power cycle)

Same shape: ONE command, loop inside, tool timeout above the inner one.

Boot (rc 0 = up, rc 124 = still down):

```sh
timeout 300 bash -c 'while ! ssh -o BatchMode=yes -o ConnectTimeout=5 <host> true 2>/dev/null; do sleep 10; done'; echo rc=$?
```

rc 0 → final check `ssh <host> uptime`. rc 124 → diagnose WHERE it stuck
(BMC `power status` / SOL tail if a bridge is available) and report — do
not re-loop blindly.

Shutdown (rc 0 = down, rc 124 = still up):

```sh
timeout 120 bash -c 'while ssh -o BatchMode=yes -o ConnectTimeout=5 <host> true 2>/dev/null; do sleep 5; done'; echo rc=$?
```

Reboot proof (did the host really cycle): compare `uptime -s` before vs
after — the comparison IS the result; equal boot ids ⇒ never went down.

## Rule 5 — Kill by PID

```sh
ssh <host> 'kill <PID>'        # then, if it persists:
ssh <host> 'kill -9 <PID>'
ssh <host> 'ps -p <PID> || echo dead'
```

NEVER pkill (Rule 1). Domain caveat: killing a FLASH tool mid-op wedges
the flash semaphore (mellanox-flash-ops) — there "kill" is a decision with
a host reboot behind it, not a reflex.

## Quick reference

| Need | Command |
|---|---|
| Launch long op | `ssh <host> 'nohup <cmd> >/root/x.log 2>&1 & echo "PID: $!"'` |
| Process alive? (own) | `ssh <host> 'ps -p <PID> \|\| echo exited'` |
| Process alive? (by name, no PID) | `ssh <host> 'ps -ef \| grep mstfwrese[t] \|\| echo exited'` |
| Wait for exit (own) | Rule 3, PID variant (inner `timeout 600`) |
| Wait for host up | Rule 4, boot variant (inner `timeout 300`) |
| Wait for host down | Rule 4, shutdown variant (inner `timeout 120`) |
| Kill | `kill <PID>` / `kill -9 <PID>` — by PID only |

## Common mistakes

- `pkill -f <pattern>` / `pgrep -f` — self-match kills your own ssh
  session (use the PID, or the bracket trick).
- Per-poll tool calls instead of one inner-loop command — context flood.
- Tool-call timeout lower than the inner `timeout` — the loop dies, state
  unknown.
- Skipping the post-loop state check — "the loop said rc 0" is not "the
  job succeeded"; the remote process's result is in the log.
- `cat`/`tail -f` on a progress log — `\r` flood.
- Re-looping a 124 boot-wait blindly — diagnose where it stuck first.
