import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../server.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Description strings copied as literals from the real
// ~/.config/opencode/skills/{mellanox-flash-ops,basecalc}/SKILL.md
// frontmatter at test-writing time (verified against the sources then).
// This test never reads files outside the repo at runtime.
const MFX_DESCRIPTION = `Use when running mstflint flash operations (ri/rb dumps, dc, q, burn, activating the new FW after burn via mstfwreset) on Mellanox/ConnectX cards over ssh — long-running flash ops, "Flash semaphore" errors, flint_oem write-protect, hosts without mst service (root-mellanox, root-bazzite), burn flag/mode selection for modified images ("The Digest in the signature is wrong", --no_fw_ctrl vs --nofs/-ocr legacy).`;
const BASECALC_DESCRIPTION = `Use when computing arithmetic or bitwise operations on numbers in mixed bases, or converting between bases — hex (0x), decimal, octal (0o, leading-0), binary (0b, trailing-b) — e.g. register offsets, address math, bit masks, firmware addresses, "what is 0x1E5 minus 0x20".`;

test("parseFrontmatter: alpha fixture", () => {
  const text = readFileSync(join(here, "fixtures/skills/alpha/SKILL.md"), "utf8");
  const fm = parseFrontmatter(text);
  assert.equal(fm.name, "alpha");
  assert.equal(fm.description, "Alpha test skill: with colon — and em dash");
  assert.ok(fm.body.startsWith("# "));
});

test("parseFrontmatter: beta fixture", () => {
  const text = readFileSync(join(here, "fixtures/skills/beta/SKILL.md"), "utf8");
  const fm = parseFrontmatter(text);
  assert.equal(fm.name, "beta");
  assert.equal(fm.description, "Beta skill");
  assert.ok(fm.body.startsWith("# "));
});

test("parseFrontmatter: real sample, mellanox-flash-ops description", () => {
  const text = ["---", "name: mellanox-flash-ops", "description: " + MFX_DESCRIPTION, "---", "", "# Mellanox flash ops (mstflint over ssh)", ""].join("\n");
  const fm = parseFrontmatter(text);
  assert.equal(fm.name, "mellanox-flash-ops");
  assert.equal(fm.description, MFX_DESCRIPTION);
  assert.ok(fm.body.startsWith("# "));
});

test("parseFrontmatter: real sample, basecalc description", () => {
  const text = ["---", "name: basecalc", "description: " + BASECALC_DESCRIPTION, "---", "", "# basecalc", ""].join("\n");
  const fm = parseFrontmatter(text);
  assert.equal(fm.name, "basecalc");
  assert.equal(fm.description, BASECALC_DESCRIPTION);
  assert.ok(fm.body.startsWith("# "));
});
