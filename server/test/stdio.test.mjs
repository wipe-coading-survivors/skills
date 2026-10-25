import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "server.mjs");
const fixturesSkills = join(here, "fixtures/skills");

function waitForLines(proc, n, timeoutMs) {
  return new Promise((resolveP, rejectP) => {
    let buf = "";
    const lines = [];
    let done = false;
    const finish = (fn, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(val);
    };
    const timer = setTimeout(
      () => finish(rejectP, new Error("timeout: got " + lines.length + "/" + n + " lines: " + lines.join(" | "))),
      timeoutMs
    );
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        lines.push(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
        if (lines.length >= n) finish(resolveP, lines);
      }
    });
    proc.on("close", (code) => {
      if (lines.length < n) finish(rejectP, new Error("process exited with code " + code + " after " + lines.length + "/" + n + " lines"));
    });
  });
}

test("stdio transport: initialize, tools/list, tools/call", async () => {
  const proc = spawn(process.execPath, [serverPath], {
    env: { ...process.env, SKILLS_DIRS: fixturesSkills },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stderr.resume();
  const linesP = waitForLines(proc, 3, 5000);
  const send = (id, method, params) => {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  };
  send(1, "initialize", { protocolVersion: "2025-03-26" });
  send(2, "tools/list");
  send(3, "tools/call", { name: "alpha_docs" });
  const lines = await linesP;
  proc.stdin.end();
  const code = await new Promise((resolveP) => proc.on("close", (c) => resolveP(c)));
  const [init, tools, call] = lines.map((l) => JSON.parse(l));
  assert.deepEqual([init.id, tools.id, call.id], [1, 2, 3]);
  assert.equal(init.result.serverInfo.name, "skills");
  assert.ok(tools.result.tools.some((t) => t.name === "alpha_docs"));
  assert.ok(call.result.content[0].text.includes("One body."));
  assert.equal(code, 0);
});
