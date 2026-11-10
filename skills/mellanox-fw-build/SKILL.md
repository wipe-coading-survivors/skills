---
name: mellanox-fw-build
description: Use when building or customizing Mellanox ConnectX firmware images offline — patching ini/config sections of a base .bin, adding a build identifier to 0x30 DBG_FW_INI, embedding GUID/MAC into an image before a burn, recomputing the 0xA0 digest (mlxfwutil.py sign / sign --check) before a plain burn, building self-signed secure-fw images (own key vault 0xA4 + RSA-4096 SignForFwUpdate), or running offline image verify gates (mlxfwutil.py, mstflint -i verify).
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

## Rule 2 — 0x30 ini edits: in-place preferred; relocation is gated-safe

Relocating 0x30 is burn-safe on current mlxini (since the 2026-10-31
repack-burn-safety cycle): the planner relocates to a 64K-aligned tail and
reorders the ITOC entry, the burn-order invariant is gated unconditionally
(`verify` FAIL rc 1; `inject` refuses rc 2 before writing any file), and
0xA0 is auto-signed after any relocation. The historical corruption
(mlxini journal 2026-09-21 §13; reattributed 2026-10-31: INI was
written-then-erased by a sector revisit — burn-order violation of the
pre-cycle allocator, mlxini docs/10 §4.9 + docs/55 §10) is reproducible
today only via the research flag `--unsafe-relocation` (bypasses the
pre-write gate; NEVER for production builds).

Growth awareness (why the size can move even without edits):

- the ini text grows (e.g. the build-ID comment);
- zlib drift: a different zlib build emits a larger stream for identical
  text (+4..+12 B measured on all 18 vendor images with the local zlib-ng).

Checks:

- Over budget → relocate: `mlxfwutil.py inject ... --repack-force`
  (deliberate, reviewed layout change: output layout differs from base —
  relocated entry is the LAST ITOC entry, old place erased 0xFF).
- Optional in-place path (nicer diff): trim vendor doc-comments
  (`;;`-lines, the iniprep banner). The FW does not parse section 0x30 AT
  ALL (debug copy; the live config is the binary sections
  0x08/0x09/0x11/0x12, which the ini only partially mirrors) — trimming
  comments is functionally safe; keep key=value lines intact
  (`dc`-parity). A choice, NOT a requirement.
- After injection verify: round-trip extract == the edited ini text;
  `mlxfwutil.py verify` PASS (includes the burn-order check); 0xA0 fresh
  (autosign already recomputed it on relocation — `sign --check` rc 0).

## Rule 3 — Embed GUID/MAC before burn (FNP risk)

Any burn that may go through FNP recovery or use `--nofs` /
`--ignore_dev_data` (in practice: every custom lab burn) MUST get the
card's identity embedded in the image beforehand:

- Source: `mstflint -d <BDF> q` on THAT card → `Base GUID:` / `Base MAC:`
  (MAC as hex without colons).
- Embed into the image BEFORE the burn (project flow: `mlxfwutil.py guides`,
  writes mDevInfo + MFG_INFO, self-verify).
- Never plan "fix GUIDs with `sg` after reboot": after FNP, `mstflint q`
  can show `Base GUID: N/A` while the identity is physically intact
  (MNVDA desync) — embedding avoids the whole class (docs/41).

## Rule 4 — Offline gates (all must pass before burn)

1. Full CRC verify of the built image (project: `mlxfwutil.py verify --deep`)
   → PASS. (`verify` also prints the info line
   `signature 0xA0: fresh|stale|rsa|empty|missing|v2` — info, does not
   change rc.)
2. Vendor gate: `mstflint -i <img.bin> verify` →
   `FW image verification succeeded. Image is bootable.`
3. Rule-2 checks (0x30 in place, round-trip).
4. Diff vs base: only the intended zones changed (section-wise diff; no
   accidental touches of code/signature sections).
5. 0xA0 digest (Rule 5): `mlxfwutil.py sign --check <img>` → rc 0 (fresh) —
   mandatory when the burn will be plain/MCC on a non-secure card.

## Rule 5 — 0xA0 digest: recompute on every content change (sign)

Plain/MCC burn on a non-secure card checks the image's 0xA0 SHA-256 digest
(FW content-digest gate, unconditional; docs/20 §14.5). A stale digest
fails the burn deterministically after the full download
(`-E- The Digest in the signature is wrong`, MCC 0x2) — a wasted flash
cycle.

- Default: after ANY content change (ini, code, GUID, PSID, …) recompute
  the digest — `mlxfwutil.py sign <img>` (bit-equivalent to
  `mstflint -i <img> sign` with no keys = `FwInsertSHA256`; in-place,
  idempotent — a fresh image comes back 0 diff). Skip only on explicit
  owner/coordinator instruction.
- Check: `mlxfwutil.py sign --check <img>` — rc 0 fresh / 1 stale /
  2 rsa/empty/missing/V2. Gate before handoff to burn (Rule 4.5).
- `--force`: overwrites an RSA-signed 0xA0 (normalizes the section,
  uuid fields → 0; mstflint parity) — a deliberate act, say so in the
  report.
- V2 (Carmel+, secure-boot V2) images: refused (mask not implemented) —
  out of scope.
- `--no_fw_ctrl` burn (direct path) does NOT check the digest — the
  recompute is not needed there (still harmless; keep the default).
- Self-signed (RSA-path, Rule 6) images: do NOT run `mlxfwutil.py sign` /
  `mstflint sign` on them — it would overwrite 0xA0 and zero the uuid
  fields, destroying the RSA signature. `sign --check` rc 2
  (`0xA0: empty`) is the expected, correct state for Rule-6 builds.

## Rule 6 — Self-signed secure-fw build (own vault + RSA-4096)

Live-proven path (2026-10-29, securefw-gates cycle; RE map, recipes and
md5 tables — mlxini `docs/21`, chronicle `docs/20` §14.6). For secure
cards (`q` → `Security Attributes: secure-fw`) the burn-verify gate
resolves the image's 0xA3 `keypair_uuid` against the RUNNING image's key
vault (16 slots: 0xA1×8 + 0xA4×8). A self-signed image therefore passes
only after OUR vault is running: first install via FNP
(mellanox-flash-ops + docs/40 §6/§9.1), then every later own build goes
plain `-y burn` ("FNP once → plain onwards").

Build steps (ORDER MATTERS — the 0xA4 vault is inside the signed data):

1. Key: RSA-4096 PEM (`openssl genrsa 4096`); never commit or quote the
   private key. uuid = 16 random bytes, passed as a 32-hex-digit STRING.
2. Vault file = exactly the 0xA4 section size (CX-5 HPE: 4352B = 8 slots
   × 0x220). Slot layout (BE): auth_cfg @0x0, reserved zeros @0x4..0xC,
   exp (65537) @0xC, keypair_uuid 16B @0x10, modulus 512B @0x20.
   Slot plan: own key = slot0 (vendor auth profile `0xd8000004`; the
   minimal `0x80000004` passes verify too — FW checks only auth_type
   ∈ {3,4}), vendor slots copied byte-identical from the base 0xA4 into
   slot1/slot2 (keeps the path back to vendor-signed images).
3. `mstflint -i <img> set_public_keys <vault.bin>` (the "run sign
   command" warning is expected) — THEN
   `mstflint -i <img> --private_key k.pem --key_uuid <32-hex-string> sign`
   (RSA-4096 → SHA-512, `SignForFwUpdate`). Any vault change after signing
   invalidates the signature — redo both steps.
4. Expected post-state: 0xA0 zeroed (SHA-512 branch of SignForFwUpdate
   zeroes the lower signature section), 0xA3 = own keypair_uuid @0x10 +
   512B signature @0x20. Diff vs base: only {0xA0, 0xA3, 0xA4, 0x30}.
5. Freshness proof = the parity gate (NOT Rule 5): recompute EM =
   sig^65537 mod n → PKCS#1 v1.5 header 00 01 FF…00 + DigestInfo(SHA-512)
   + SHA512(masked image) == embedded hash; masks = boot magic 16B +
   ITOC-entry+data of 0xA0 and 0xA3 → 0xFF, range [0, sizeOfImgData).
   Reference implementation: mlxini `scripts/secfw/parity_gate.py`.
6. Gates before handoff: Rule 4 items 1-4 (`verify --deep` PASS,
   `mstflint -i <img> verify` bootable, 0x30 checks, diff whitelist) +
   the parity gate. Burn handoff: docs/40 §6 (secure) — FNP first
   install, plain afterwards; GUID/MAC embedding (Rule 3) is mandatory
   for the FNP leg (`--ignore_dev_data` takes identity from the image).

## Mini-pipeline (generic)

1. Identify the card; `mstflint -d <BDF> q` — record PSID, FW version,
   Base GUID/MAC.
2. Backup `ri` (mellanox-flash-ops) — known-good in reach.
3. Pick a base image: same chip / PSID family (docs/40 §3, §11).
4. Extract the ini from the base (0x30).
5. Edit the config; add the build-ID comment (Rule 1); if over budget,
   inject with `--repack-force` — relocation is gated-safe (Rule 2);
   trimming `;;` comments is optional for a minimal diff.
6. Inject; run the Rule-2 checks (round-trip, verify PASS, 0xA0 fresh).
7. Embed GUID/MAC of the target card (Rule 3).
8. PSID/name/description if the SKU changes (docs/40 §5).
9. Recompute the 0xA0 digest — `mlxfwutil.py sign <img>` (Rule 5; default
   for every content-modified build).
10. Offline gates (Rule 4), incl. `sign --check` rc 0.
11. Secure card + own signature: Rule 6 instead of step 9 (vault +
    set_public_keys → sign + parity gate); hand off to burn — FNP once
    to install the vault, plain afterwards (docs/40 §6, mlxini docs/21
    §10).
12. Hand off to burn: mellanox-flash-ops + docs/40 §6.

## Common mistakes

- `#` comment syntax — the ini uses `;`.
- `--unsafe-relocation` in a production build — legacy reproducer of the
  burn-order bug class; bypasses the pre-write gate.
- "The text did not change, so the size did not change" — zlib drift.
- Burning an image with zeroed GUIDs under `--ignore_dev_data` — the
  card loses its identity.
- Handing off a content-modified image for a plain burn without
  `mlxfwutil.py sign` — deterministic MCC 0x2 "The Digest in the signature
  is wrong" after the full download (stale 0xA0).
- Trimming key=value lines "because FW does not read 0x30 anyway" —
  kills `dc`-parity and the reference value.
- Skipping the round-trip / address check after injection.
- `--key_uuid <raw-16B-file>` — the option takes a 32-hex-digit STRING
  (extractUUIDFromString, fs3_ops.cpp:3133); a raw file fails with the
  masking errmsg "Failed to insert secured FW signature".
- `mstflint -i <ss-img> sign` (no keys) on a self-signed image —
  overwrites 0xA0 and zeroes the uuid fields, destroying the RSA
  signature (Rule 6 builds: parity gate, not Rule 5).
- set_public_keys AFTER sign, or a vault edit after signing — 0xA4 is
  inside the signed data; always vault first, sign last, redo both on
  any vault change.
