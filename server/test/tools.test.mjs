import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverSkills,
  defaultSkillsDir,
  buildTools,
  buildResources,
  handleRequest,
} from "../server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesSkills = join(here, "fixtures/skills");
const skills = () => discoverSkills([fixturesSkills]);

test("discoverSkills: root entry finds exactly alpha and beta", () => {
  const list = skills();
  assert.deepEqual(list.map((s) => s.name).sort(), ["alpha", "beta"]);
  const alpha = list.find((s) => s.name === "alpha");
  assert.ok(alpha.files.includes("tool.txt"));
});

test("discoverSkills: skill dirs passed as entries", () => {
  const list = discoverSkills([join(fixturesSkills, "alpha"), join(fixturesSkills, "beta")]);
  assert.deepEqual(list.map((s) => s.name).sort(), ["alpha", "beta"]);
});

test("defaultSkillsDir: sibling skills/ next to the server dir (<repo>/skills)", () => {
  const serverDir = join(here, "..");
  assert.equal(defaultSkillsDir(), resolve(join(serverDir, "..", "skills")));
});

test("buildTools: names", () => {
  const tools = buildTools(skills());
  assert.deepEqual(tools.map((t) => t.name), ["list_skills", "alpha_docs", "beta_docs", "skill_file"]);
});

test("initialize: echoes protocolVersion, serverInfo.name is skills", () => {
  const resp = handleRequest({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, skills());
  assert.equal(resp.result.protocolVersion, "2025-03-26");
  assert.equal(resp.result.serverInfo.name, "skills");
});

test("tools/call alpha_docs without args: full file", () => {
  const resp = handleRequest({ id: 2, method: "tools/call", params: { name: "alpha_docs" } }, skills());
  const text = resp.result.content[0].text;
  assert.ok(text.includes("## One"));
  assert.ok(text.includes("name: alpha"));
});

test("tools/call alpha_docs section=two: Two body only", () => {
  const resp = handleRequest({ id: 3, method: "tools/call", params: { name: "alpha_docs", arguments: { section: "two" } } }, skills());
  const text = resp.result.content[0].text;
  assert.ok(text.includes("Two body."));
  assert.ok(!text.includes("One body."));
});

test("tools/call alpha_docs section=zzz: isError with Available sections", () => {
  const resp = handleRequest({ id: 4, method: "tools/call", params: { name: "alpha_docs", arguments: { section: "zzz" } } }, skills());
  assert.equal(resp.result.isError, true);
  const text = resp.result.content[0].text;
  assert.ok(text.includes("One"));
  assert.ok(text.includes("Two"));
  assert.ok(text.includes("Available sections:"));
});

test("tools/call list_skills: <name> — <description> (files: …)", () => {
  const resp = handleRequest({ id: 5, method: "tools/call", params: { name: "list_skills" } }, skills());
  const text = resp.result.content[0].text;
  assert.ok(text.includes("alpha — Alpha test skill"));
});

test("tools/call skill_file tool.txt", () => {
  const resp = handleRequest({ id: 6, method: "tools/call", params: { name: "skill_file", arguments: { skill: "alpha", path: "tool.txt" } } }, skills());
  assert.equal(resp.result.content[0].text, "hello tool");
});

test("tools/call skill_file path escape: outside skill dir", () => {
  const resp = handleRequest({ id: 7, method: "tools/call", params: { name: "skill_file", arguments: { skill: "alpha", path: "../notaskill/readme.txt" } } }, skills());
  assert.equal(resp.result.isError, true);
  assert.ok(resp.result.content[0].text.includes("outside skill dir"));
});

test("tools/call skill_file unknown skill", () => {
  const resp = handleRequest({ id: 8, method: "tools/call", params: { name: "skill_file", arguments: { skill: "gamma", path: "x" } } }, skills());
  assert.equal(resp.result.isError, true);
  assert.ok(resp.result.content[0].text.includes("unknown skill"));
});

test("tools/call skill_file binary file", () => {
  const resp = handleRequest({ id: 9, method: "tools/call", params: { name: "skill_file", arguments: { skill: "alpha", path: "blob.bin" } } }, skills());
  assert.equal(resp.result.isError, true);
  assert.ok(resp.result.content[0].text.includes("binary"));
});

test("resources/list: one SKILL.md resource per skill", () => {
  const resp = handleRequest({ id: 10, method: "resources/list" }, skills());
  assert.deepEqual(resp.result.resources.map((r) => r.uri), [
    "mcp://skills/alpha/SKILL.md",
    "mcp://skills/beta/SKILL.md",
  ]);
  for (const r of resp.result.resources) {
    assert.equal(typeof r.name, "string");
    assert.equal(typeof r.description, "string");
    assert.equal(r.mimeType, "text/markdown");
  }
});

test("buildResources matches resources/list", () => {
  const list = skills();
  const resp = handleRequest({ id: 11, method: "resources/list" }, list);
  assert.deepEqual(resp.result.resources, buildResources(list));
});

test("resources/read: full alpha SKILL.md", () => {
  const resp = handleRequest({ id: 12, method: "resources/read", params: { uri: "mcp://skills/alpha/SKILL.md" } }, skills());
  const full = readFileSync(join(fixturesSkills, "alpha/SKILL.md"), "utf8");
  assert.equal(resp.result.contents[0].text, full);
});

test("tools/call unknown tool: -32602", () => {
  const resp = handleRequest({ id: 13, method: "tools/call", params: { name: "nope" } }, skills());
  assert.equal(resp.error.code, -32602);
});

test("unknown method: -32601", () => {
  const resp = handleRequest({ id: 14, method: "bogus" }, skills());
  assert.equal(resp.error.code, -32601);
});
