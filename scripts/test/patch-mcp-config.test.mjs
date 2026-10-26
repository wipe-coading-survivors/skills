import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "../patch-mcp-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "patch-mcp-config.mjs");
const fixture = join(here, "fixtures/config.jsonc");

const ENTRY_A = '{"type":"local","command":["podman","run","--rm","-i","skills-mcp:local"]}';
const ENTRY_B = '{"type":"remote","url":"https://example.invalid/mcp"}';

function tmpConfig() {
  const dir = mkdtempSync(join(tmpdir(), "patch-mcp-config-"));
  const file = join(dir, "opencode.jsonc");
  copyFileSync(fixture, file);
  return file;
}

function cli(args) {
  return execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("set: creates mcp.servers.skills with the exact entry, preserves the rest, URL intact, output re-parses", () => {
  const file = tmpConfig();
  cli(["set", file, "skills", ENTRY_A]);
  const text = readFileSync(file, "utf8");
  const obj = JSON.parse(text);
  assert.deepEqual(obj.mcp.servers.skills, JSON.parse(ENTRY_A));
  assert.equal(obj.mcp1.url, "https://mcp.context7.com/mcp");
  assert.deepEqual(obj.plugin, []);
  assert.equal(text, JSON.stringify(obj, null, 2) + "\n");
});

test("set twice: entry replaced (idempotent), rest preserved", () => {
  const file = tmpConfig();
  cli(["set", file, "skills", ENTRY_A]);
  cli(["set", file, "skills", ENTRY_B]);
  const obj = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(obj.mcp.servers.skills, JSON.parse(ENTRY_B));
  assert.deepEqual(Object.keys(obj.mcp.servers), ["skills"]);
  assert.equal(obj.mcp1.url, "https://mcp.context7.com/mcp");
  assert.deepEqual(obj.plugin, []);
});

test("remove: top-level key gone, rest intact", () => {
  const file = tmpConfig();
  cli(["set", file, "skills", ENTRY_A]);
  cli(["remove", file, "mcp1"]);
  const obj = JSON.parse(readFileSync(file, "utf8"));
  assert.equal("mcp1" in obj, false);
  assert.deepEqual(obj.mcp.servers.skills, JSON.parse(ENTRY_A));
  assert.deepEqual(obj.plugin, []);
});

test("parseJsonc: comments, URL with //, trailing comma in input parse", () => {
  const text = readFileSync(fixture, "utf8");
  const obj = parseJsonc(text);
  assert.deepEqual(obj, {
    mcp1: { type: "remote", url: "https://mcp.context7.com/mcp" },
    plugin: [],
  });
  assert.deepEqual(parseJsonc('{"a": 1, "b": [2, 3,],}'), { a: 1, b: [2, 3] });
});
