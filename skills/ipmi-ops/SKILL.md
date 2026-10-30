---
name: ipmi-ops
description: Use when working with a server BMC over IPMI — power status/on/off, mc info, SOL (serial-over-LAN) console capture or key injection, rebooting a hung or live host through the BMC, "SOL session closed by BMC", "SOL payload already active", tcgetattr, lab BMCs with IP/L/P creds files.
---

# IPMI ops (BMC: power + SOL)

## Environment facts

- `ipmitool 1.8.19` is available in the working environment. All commands are one-shot:
  `ipmitool -I lanplus -H "$IP" -U "$L" -P "$P" <cmd>`. Version: `ipmitool -V`
  (`--version` does not exist in 1.8.19).
- Credentials are shell files `~/git/IMPLEMENTATION/IPMI-*.txt`: `source` them →
  variables `IP` (BMC), `L` (login), `P` (password).
  **Never print the values**: no `echo $P`, no `set -x`, no literals in
  reports/files/commits.
- Known machines:

| ssh alias | host | BMC | creds file |
|---|---|---|---|
| root-mellanox | @IPMI_MELLANOX_HOST@ | @IPMI_MELLANOX_BMC@ | `IPMI-creds.txt` |
| root-bazzite | @IPMI_BAZZITE_HOST@ | @IPMI_BAZZITE_BMC@ | `IPMI-rd450x.txt` |
| root-asr1 | @IPMI_ASR1_HOST@ | @IPMI_ASR1_BMC@ | `IPMI-asr1.txt` |

  New machine = new creds file (same `IP=/L=/P=` format) + a row in the table.

## Quick reference

`…` below = `ipmitool -I lanplus -H "$IP" -U "$L" -P "$P"` after sourcing the creds file.

| Op | Command |
|---|---|
| BMC sanity | `… mc info` |
| Power state | `… power status` → `Chassis Power is on/off` |
| SOL enabled? | `… sol info` → `Enabled: true` |
| Power on/off | `… power on` / `… power off` |
| Release SOL payload | `… sol deactivate` |
| Reboot BMC (host untouched, ~1 min) | `… mc reset warm` |

## SOL via the bridge (sol_bridge.py)

Direct `ipmitool sol activate` with pipes/redirects dies on `tcgetattr`
(stdin is not a TTY). The bridge `sol_bridge.py` gives ipmitool a pty: keys
in via fifo, console out to a raw log. `sol_bridge.py` is NOT on disk next
to this SKILL.md — never glob/find for it: the
`skill_file(ipmi-ops, sol_bridge.py)` MCP tool returns the script content
as text; save it VERBATIM to `/tmp/opencode/sol_bridge.py` with the write
tool (the whole file, no edits), verify with
`python3 -m py_compile /tmp/opencode/sol_bridge.py`.
Check `… sol info`
first: `Enabled: false` = SOL is disabled in the BMC/BIOS settings — the
bridge will not help, fix the setting (or skip SOL entirely).

Launch (one command; expect `[SOL Session operational` in the log):

```sh
source ~/git/IMPLEMENTATION/<creds>.txt && export IP L P
mkfifo /tmp/solin.fifo
nohup python3 /tmp/opencode/sol_bridge.py /tmp/solin.fifo /tmp/sol.log >/dev/null 2>&1 &
sleep 3; tail -c 300 /tmp/sol.log | cat -v
```

Only ONE bridge per BMC (single SOL payload). A second BMC → different
names: `/tmp/solin-<name>.fifo`, `/tmp/sol-<name>.log`.

Keys to the console (F-keys over SOL are ESC+N):

```sh
echo -ne '\x1b1' > /tmp/solin.fifo   # F1  ("Press <F1>" prompt = enter Setup)
echo -ne '\x1b9' > /tmp/solin.fifo   # F9
echo -ne '\x1b0' > /tmp/solin.fifo   # F10
echo -ne '\r'    > /tmp/solin.fifo   # Enter
echo -ne '\x13'  > /tmp/solin.fifo   # Ctrl+S
```

Read the log — raw bytes + `\r`; fixed window, never `cat` the whole file,
never `tail -f`:

```sh
tail -c 800 /tmp/sol.log | cat -v | tr '\r' '\n' | tail -15
```

- An idle console prints nothing (no cursor blink) — send Enter to force a
  redraw of the prompt.
- Bridge PID: `/tmp/sol.log.pid`. Shutdown: kill the PID, then `… sol deactivate`
  (otherwise a zombie payload remains and the next launch fails).
- Power off/cycle kills SOL (`SOL session closed by BMC`) — expected; after
  `power on` launch the bridge again. Never reuse a pre-reboot session.
- `SOL payload already active on another session` (dead ipmitool holds the
  payload): find its PID (`ps -ef | grep ipmitoo[l]`) → `kill <PID>` →
  `… sol deactivate`; if it persists — `… mc reset warm` (BMC ~1 min,
  host untouched).
  **Never pgrep/pkill** — `pkill -f <pattern>` matches your own shell's
  command line and kills it; PID + kill (unix-process-ops).
- asr1 (@IPMI_ASR1_BMC@): F2 spam at POST (window ~2–3 s), send arrow keys with
  ≥0.4 s gaps; Console Redirection [Disabled] in the BMC mutes SOL input
  entirely.

## Reboot flow (BMC cold cycle)

**A host that answers ssh is NEVER cut with `power off/cycle`** — first
`systemctl poweroff` over ssh. Hard power only when ssh does not answer or the
120 s timeout expires. The goal is a COLD start: the host must reach power
off and be powered on through the BMC — plain `reboot`/`shutdown -r` (warm,
no BMC power on) is NOT this flow.

Waiting — the ssh-reachability loops from the **unix-process-ops** skill:
ONE command with the loop inside (per-poll tool calls — 20–30 round trips
— flood the context), tool-call timeout HIGHER than the inner `timeout N`.

1. State: `… power status` + ssh probe
   `ssh -o BatchMode=yes -o ConnectTimeout=5 <host> true`.
   - power off → step 5.
   - power on, ssh dead → step 3b.
   - power on, ssh alive → step 2.
2. Graceful: `ssh -o BatchMode=yes <host> 'systemctl poweroff' || true`
   (the ssh error "connection lost" is expected; the call lives as long as the
   shutdown does; if the tool call itself times out, that is NOT a failure —
   the shutdown continues in the background, the loop in step 3 is the gate).
   Then step 3.
3. Wait for shutdown — the unix-process-ops ssh-reachability loop,
   shutdown variant (inner `timeout 120`, 5 s poll): rc 0 = down,
   rc 124 = still up → hard `… power off` → step 4.
3b. ssh dead, power on → hard `… power off` → step 4.
4. Confirm: `… power status` → `off` (after a hard off: sleep 5, re-check).
5. `… power on`.
6. Wait for boot — the unix-process-ops ssh-reachability loop, boot
   variant (inner `timeout 300`, 10 s poll): rc 0 = up → final check
   `ssh <host> uptime`; rc 124 = timeout → diagnose and report WHERE it
   stuck: `… power status` + SOL log tail (if a bridge was launched:
   POST? login prompt? no network?).

## Common mistakes

- Cutting a live host with `power off/cycle`, or a warm `reboot` instead of
  the BMC cold flow — `systemctl poweroff` first; hard only after the 120 s
  timeout.
- Printing credentials: `echo $P`, `set -x`, literal passwords in reports.
- Polling with separate tool calls — one `timeout N` loop + one state check.
- Tool timeout lower than the inner loop — the loop dies, state unknown.
- Foreground `ipmitool sol activate` / redirects — bridge only.
- `cat`/`tail -f` on the SOL log — raw bytes and `\r` flood the context.
- `pkill -f` / `pkill -x ipmitool` — find the PID (`ps -ef | grep
  ipmitoo[l]`) and kill by PID (unix-process-ops).
- Reusing an old SOL session after a power cycle — relaunch the bridge.
- Waiting for output on an idle console — send Enter.
- Skipping `sol deactivate` after killing the bridge — zombie payload later.
- `ipmitool --version` — 1.8.19 only knows `-V`.
