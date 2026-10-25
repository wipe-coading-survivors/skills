---
name: mellanox-fw-build
description: Use when building or customizing Mellanox ConnectX firmware images offline — patching ini/config sections of a base .bin, adding a build identifier to 0x30 DBG_FW_INI, embedding GUID/MAC into an image before a burn, or running offline image verify gates (mlxini, mstflint -i verify).
---

# Mellanox custom FW build (offline, before any burn)

Scope: offline image assembly/patching. The burn itself is out of scope —
use the mellanox-flash-ops skill + `docs/40-cross-flash-ops.md` in the
mlxini repo (read before any burn).

Project tooling (mlxini repo): command table and the canonical pipeline —
`docs/40` §4. This skill carries the rules, tool-agnostic.

## Rule 1 — Build identifier (mandatory)

Every custom image MUST carry a build-ID comment in the 0x30 DBG_FW_INI
section (zlib-compressed ini — what `mstflint dc` prints):

- Syntax: iniprep-style comment `; ...` — NOT `#`.
- Placement: the line right after `;; Mellanox Technologies LTD` (top of
  the ini).
- Format (≤10-20 words total):
  `; <project> <build-name> (<yyyy-mm-dd>, <ref>): <what/why>`
  Precedent:
  `; mlxini iRISC boot-injection PoC (2026-09-21, docs/55): shellcode @ dc 0x38d730 -> host CR 0x23f0 = 0xbadc0001`
- Purpose: on-card discrimination — `mstflint -d <BDF> dc | head` must
  immediately tell a custom image from a vendor one and name the build.

## Rule 2 — 0x30 stays in place (never relocate silently)

Relocating the 0x30 section has corrupted flashes on FNP-burn (INI region
left 0xFF; mlxini journal 2026-09-21 §13). Two independent triggers:

- the ini text grows (e.g. the build-ID comment);
- zlib drift: a different zlib build emits a larger stream for identical
  text (+4..+12 B measured on all 18 vendor images with the local zlib-ng).

Budget and checks:

- Compressed+DW-padded size of the new ini MUST be ≤ the original 0x30
  section size (`e.size` of the ITOC entry); keep ≥32 B headroom
  (patched5 practice).
- If over budget: trim vendor doc-comments (`;;`-lines, the iniprep
  banner). The FW does not parse section 0x30 AT ALL (debug copy; the
  live config is the binary sections 0x08/0x09/0x11/0x12, which the ini
  only partially mirrors) — trimming comments is functionally safe. Keep
  key=value lines intact: `dc`-parity and human/agent reference.
- After injection verify: 0x30 ITOC entry address unchanged, new size ≤
  old, round-trip extract == the edited ini text.
- Tooling: `mlxini.py inject` errors on overflow unless `--repack-force`
  is passed explicitly; relocation is a deliberate, reviewed act.

## Rule 3 — Embed GUID/MAC before burn (FNP risk)

Any burn that may go through FNP recovery or use `--nofs` /
`--ignore_dev_data` (in practice: every custom lab burn) MUST get the
card's identity embedded in the image beforehand:

- Source: `mstflint -d <BDF> q` on THAT card → `Base GUID:` / `Base MAC:`
  (MAC as hex without colons).
- Embed into the image BEFORE the burn (project flow: `mlxini.py guides`,
  writes mDevInfo + MFG_INFO, self-verify).
- Never plan "fix GUIDs with `sg` after reboot": after FNP, `mstflint q`
  can show `Base GUID: N/A` while the identity is physically intact
  (MNVDA desync) — embedding avoids the whole class (docs/41).

## Rule 4 — Offline gates (all must pass before burn)

1. Full CRC verify of the built image (project: `mlxini.py verify --deep`)
   → PASS.
2. Vendor gate: `mstflint -i <img.bin> verify` →
   `FW image verification succeeded. Image is bootable.`
3. Rule-2 checks (0x30 in place, round-trip).
4. Diff vs base: only the intended zones changed (section-wise diff; no
   accidental touches of code/signature sections).

## Mini-pipeline (generic)

1. Identify the card; `mstflint -d <BDF> q` — record PSID, FW version,
   Base GUID/MAC.
2. Backup `ri` (mellanox-flash-ops) — known-good in reach.
3. Pick a base image: same chip / PSID family (docs/40 §3, §11).
4. Extract the ini from the base (0x30).
5. Edit the config; add the build-ID comment (Rule 1); trim vendor
   comments if over budget (Rule 2).
6. Inject; run the in-place checks (Rule 2).
7. Embed GUID/MAC of the target card (Rule 3).
8. PSID/name/description if the SKU changes (docs/40 §5).
9. Offline gates (Rule 4).
10. Hand off to burn: mellanox-flash-ops + docs/40 §6.

## Common mistakes

- `#` comment syntax — the ini uses `;`.
- Oversized build-ID / untrimmed ini → section relocation → corrupted
  FNP-burn (historical incident, mlxini journal 2026-09-21 §13).
- "The text did not change, so the size did not change" — zlib drift.
- Burning an image with zeroed GUIDs under `--ignore_dev_data` — the
  card loses its identity.
- Trimming key=value lines "because FW does not read 0x30 anyway" —
  kills `dc`-parity and the reference value.
- Skipping the round-trip / address check after injection.
