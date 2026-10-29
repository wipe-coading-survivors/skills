---
name: mellanox-flash-ops
description: Use when running mstflint flash operations (ri/rb dumps, dc, q, burn, activating the new FW after burn via mstfwreset) on Mellanox/ConnectX cards over ssh — long-running flash ops, "Flash semaphore" errors, flint_oem write-protect, hosts without mst service (root-mellanox, root-bazzite), burn mode selection for modified images (plain burn vs --no_fw_ctrl, "The Digest in the signature is wrong" MCC 0x2, pre-burn digest check, --nofs/-ocr legacy).
---

# Mellanox flash ops (mstflint over ssh)

Building or customizing images offline (ini/config patching, build-ID,
GUID embed) is a separate skill: mellanox-fw-build.

## Environment facts

- No `mst` service on the host — do NOT run `mst start`. Address the card
  directly by PCI BDF: `mstflint -d <BDF> …` (find it: `lspci -nnd 15b3:`).
- Tools are symlinks in `/usr/local/bin` (mstflint, mstconfig, mstfwreset,
  ibstat, …) → AppImage `/usr/local/share/mlxini-mstflint/`; version varies
  per host — check `mstflint --version`.
- `flint_oem`/`flint` live ONLY in a toolbox container (usually `t-mlxflint`;
  check `toolbox list`): `ssh <host> 'toolbox run -c <c> flint_oem -d <BDF> …'`.
  Sole use case — the `Flash0.WriteProtected` flag:
  `flint_oem -d <BDF> -ocr hw query` /
  `flint_oem -d <BDF> -ocr hw set Flash0.WriteProtected=Disabled`.

## Flash size (per silicon)

| Silicon | Flash | Whole-flash `rb` |
|---|---|---|
| CX-4, CX-4Lx, CX-5 | 16MiB (0x1000000) | `rb 0x0 0x1000000 <f>` → 16777216 B |
| CX-6, CX-6Dx | 32MiB (0x2000000) | `rb 0x0 0x2000000 <f>` → 33554432 B |

`ri` (logical) reads the active slot = the image: 16MiB on CX-4/5, 32MiB on
CX-6. Unsure which size? Check the family first (`q` → PSID) — do not guess
(`rb 0x0 0x1000000` on a CX-6 is half the flash).

## Core rule: flash ops are long — background + poll, NEVER kill

`ri`/`rb`/`burn` take minutes (measured CX-6 32MiB: `ri` 136 s,
`rb` 715 s). Killing mstflint mid-op wedges the flash semaphore (`Can not
obtain Flash semaphore`) — only a host reboot clears it. A SILENT dump is
NOT a hang (`ri`/`rb` log nothing until done).

Launch (one ssh call):

```sh
ssh <host> 'nohup mstflint -d <BDF> ri /root/x.bin >/root/x.log 2>&1 & echo "PID: $!"'
```

Wait — ONE tool call, the loop INSIDE the command on the remote side (NOT
20 s polls one by one — dozens of round-trips flood the context). The loop
has its own 600 s timeout; the state check ALWAYS runs after it. Use the
PID captured at launch ($!) — no name matching at all:

```sh
timeout 600 bash -c 'ssh <host> "while ps -p <PID> >/dev/null 2>&1; do sleep 10; done"; echo $?'
ssh <host> 'ps -p <PID> || echo mstflint-exited; tail -c 400 /root/x.log | tr "\r" "\n" | tail -5; stat -c %s /root/x.bin 2>/dev/null || echo no-file'
```

- rc: 0 = mstflint exited, 124 = 600 s passed; re-loop if still running.
- No PID (a process not launched by you)? Bracket trick
  `ps -ef | grep mstflin[t]` (the bracket keeps the wrapper out of the
  match). NEVER pgrep/pkill — `pkill -f` matches your own ssh session's
  command line and kills your shell (live incident: `pkill -9 -f
  mstfwreset` killed the ssh session before `reboot`). Process/host-ops
  canon (launch/$!, wait loops, kill, ssh-reachability waits): skill
  **unix-process-ops**.
- Tool-call timeout ABOVE 600 s (opencode: `timeout: 660000` ms) — the tool
  must not kill the loop before its own `timeout 600`.
- Other work in flight? One-shot probe between your steps instead:
  `sleep 20; ssh <host> 'ps -p <PID> || echo exited; tail -c 400 /root/x.log | tr "\r" "\n" | tail -5'`
- burn writes `\r` progress on one line — `tail -c N | tr '\r' '\n'`, never
  `cat`/`tail -f`. Done ONLY at `Restoring signature - OK` + zero `-E-`
  lines (`grep -cE "^-E-" log`). `Burning FW image without signatures - OK`
  is the `--no_fw_ctrl`-path marker — absent in plain burn; both paths
  must reach `Restoring signature - OK` or the flash is left unfinalized
  (docs/40 §6).
- ri/rb done = process exited + file the expected size (table above).
- New FW becomes active after a CHIP reset — `mstfwreset` (~10–20 s, host
  stays up): the "Activate after burn" section.

## Scope: verify, don't forensics

After a dump verify ONLY: process exited, file size, md5 (burn:
`Restoring signature - OK` + zero `-E-` lines). Do NOT decode dump CONTENTS — why `ri` ≠ `rb`, slot layouts,
FF/zero zones, ITOC sections: every subagent that starts this spends ~20
min and lands on "separate research task". Record the facts (sizes, md5,
"differ from offset N, N bytes") and stop. Same for a FAILED burn: record
the exact `-E-` line + post-failure `q` (liveness) and report — root-causing
(strace, register probes) is a separate research task.

## Burn mode (choose FIRST — from THIS skill, never from journals/precedents)

Card security class first: `mstflint -d <BDF> q` → `Security Attributes:`
— `N/A` = non-secure (this skill's territory). `secure-fw`/`signed-fw` =
secure card — different write-path physics, NO canon in this skill: plain
burn → `Rejected authentication` (0x5), `--no_fw_ctrl` →
`MFE_NO_FLASH_DETECTED` (direct SPI blocked); the write paths (self-signed
vector, FNP) are research territory — docs/20 §14-15.

| Situation | Mode |
|---|---|
| Live card + content-modified image (stock + patches, signatures untouched — every custom lab build), non-secure card | **plain `-y burn`** — canonical; pre-burn digest check below (mandatory) |
| FNP recovery / cross-PSID | legacy flags (`--nofs`, `--ignore_dev_data`, `-ocr`, `-apc`) — docs/40 §6 |

```sh
mstflint -d <BDF> -i <img.bin> -y burn
```

- Plain/MCC burn on a content-modified image with a **stale 0xA0 digest**
  fails deterministically after the full download:
  `-E- Burning FS4 image failed: The Digest in the signature is wrong`
  (MCC 0x2 — the FW content-digest gate, docs/20 §14.5). The pre-burn check
  below exists to prevent exactly this — do NOT retry blind or "escalate"
  to FNP-flags: an extra flash cycle for nothing.
- `--no_fw_ctrl` (direct path) — a valid ALTERNATIVE on non-secure cards:
  skips the digest gate, writes the inactive bank and switches. No longer
  the first choice for content-modified images (plain + fresh digest is
  the canon), still the mode when the MCC path is unavailable (mstflint's
  own recommendation: "Unsupported operation under Controlled FW, please
  retry with --no_fw_ctrl"). NOT for secure cards (see above).
- Flags/precedents from past journals are NOT a mode source — they drift
  from this skill. This skill + docs/40 §6 are the only canon.
- Rule 3 GUID embed (mellanox-fw-build) stays mandatory as standard.

### Pre-burn digest check (non-secure card, plain burn — mandatory)

FW checks the image's 0xA0 SHA-256 digest on plain (MCC) burn; a stale
digest = deterministic 0x2 after the full download (docs/20 §14.5).
`mstflint sign` (no keys = `FwInsertSHA256`) is idempotent — a fresh image
comes back 0 diff. Use the md5 as the check, on the server, right before
the burn (one ssh call):

```sh
ssh <host> 'md5sum /root/<img>.bin; mstflint -i /root/<img>.bin sign; md5sum /root/<img>.bin'
```

Expected: `Updating SIGNATURE section - OK` + `Updating ITOC section - OK`
between the two md5 lines.

- md5 equal → digest fresh → burn.
- md5 differs → the digest was STALE (mstflint just recomputed it) →
  **STOP + report to the coordinator** (hint: «forgotten `mlxini.py sign`
  at build time?»). The file on the server is now signed — whether to
  proceed is the coordinator's call.
- Burn with `--no_fw_ctrl` (alternative path) — no check: the direct path
  skips the digest gate.

## Activate after burn (mandatory second half of every burn)

Cheap chip reset — `mstfwreset` (same AppImage as mstflint; no mst service)
— NOT a host reboot. Proven live (CX-5, `--no_fw_ctrl` burns:
3-step ladder, FW-reload proof, zero host reboots):

```sh
mstfwreset -d <BDF> -t 0 -l 3 -y r
```

(`-l 3` = driver restart + PCI reset, `-t 0` = full chip reset; done at
`FW was loaded successfully`, rc=0, ~10–20 s.)

- **`-l 3` explicit — ALWAYS.** Same-version step (burned image FW version
  == running): `r` without `-l 3` degrades to level-0 live-patch (<1 s,
  driver/PCI untouched), still prints "FW was loaded successfully" but does
  NOT activate caps/advertisement (measured: level 0 → LnkCap 8, explicit
  3 → LnkCap 16 on the same bytes).
- **Prove the image (direct runtime proof):** `mstfwreset -d <BDF> s` →
  `Running FW version` == burned, `Pending: N/A (up to date)`; then `q`
  (version/PSID/GUID), dmesg re-probe (`mlx5_core … firmware version`),
  `dc` (build-ID — flash) as usual. Same-version step: additionally verify
  the changed value at runtime (e.g. `lspci` LnkCap).
- Port re-trains on its own after the reset; the host stays up, neighbors
  untouched (`-d` only your BDF).

### Fallback: host reboot (only if mstfwreset fails / card down / FNP-legacy)

Two calls with a boot-id comparison — never a bare `ssh <host> 'reboot'`,
never `reboot` chained into a larger string (a parse error silently skips
it):

1. `ssh <host> 'uptime -s; (reboot >/dev/null 2>&1 &); true'` — records the
   PRE boot id in the same short string that launches the reboot
   (backgrounded so the call returns cleanly).
2. Wait for the host back and capture the POST boot id — the
   ssh-reachability loop from **unix-process-ops** (boot variant,
   `uptime -s` as the probe instead of `true`; inner `timeout 600`, tool
   timeout 660000 ms).
3. post ≠ pre ⇒ rebooted; post == pre ⇒ host never went down (ssh answers
   it) — re-issue 1. The comparison IS the wait loop's output.
4. **Prove the image:** `q`/`dc`/`ri` all read FLASH (active slot), never
   what runs in RAM — dc/ri proof counts ONLY together with step 3's
   differing boot ids (report: «runtime proof: indirect (verified reboot +
   flash slot)»); a runtime word-gate (a RUNTIME word that differs between
   images, echo-reader-class) when available. Symptom runtime≠flash: next
   burn rejected `FW image was already updated on flash, but not loaded`.

The internal-loop pattern ("loop INSIDE the command") is for WAITING and
STATE CHECKS only — never wrap a state-changing action into it.

## GUID trap: `--nofs` / `--ignore_dev_data`

These flags take GUID/MAC from the image, not the card — an image without
GUIDs **wipes the card's GUIDs**. Before any burn with these flags:

```sh
ssh <host> 'mstflint -i <img.bin> q'    # look at the `Base GUID:` line
```

- `Base GUID: <hex>` → OK to burn. `Base GUID: N/A` → **BLOCKED**: do not
  burn; stop and report to the coordinator. Fix: embed the GUIDs/MAC into
  the image first (mellanox-fw-build, Rule 3).
- Coordinator (spec/plan): a plan that burns with these flags MUST include
  the GUID embed step — do not rely on the card's device data.

## Commands

| Op | Command |
|---|---|
| Identify | `mstflint -d <BDF> q` |
| Logical dump (image — backup/rollback) | `mstflint -d <BDF> ri <file.bin>` |
| Raw dump (size per flash-size table) | `mstflint -d <BDF> rb <0x_start> <0x_len> <file.raw>` |
| Config dump | `mstflint -d <BDF> dc > <file.ini>` |
| Pre-burn digest check (non-secure, plain burn) | `md5sum; mstflint -i <img.bin> sign; md5sum` — equal → OK, differs → STOP (Pre-burn digest check) |
| Burn (non-secure, canonical) | `mstflint -d <BDF> -i <img.bin> -y burn` (Burn mode) |
| Burn (non-secure, alternative — direct path) | `mstflint -d <BDF> -i <img.bin> --no_fw_ctrl -y burn` (Burn mode) |
| Activate (cheap reset) | `mstfwreset -d <BDF> -t 0 -l 3 -y r` (Activate after burn) |
| FW pending/running status | `mstfwreset -d <BDF> s` |

Legacy burn flags (`-apc/--allow_psid_change`, `--nofs`, `--ignore_dev_data`,
`-ocr`) and the full FNP/cross-PSID procedure (PSID step, recovery, verify,
risks, silicon matrix): `docs/40-cross-flash-ops.md` §6 — mode selection
stays in THIS skill.
