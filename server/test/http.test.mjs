import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "server.mjs");
const fixturesSkills = join(here, "fixtures/skills");

let proc;

after(() => {
  if (proc) proc.kill();
});

function waitForPort(proc, timeoutMs) {
  return new Promise((resolveP, rejectP) => {
    let buf = "";
    let done = false;
    const finish = (fn, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(val);
    };
    const timer = setTimeout(
      () => finish(rejectP, new Error("timeout waiting for 'listening on port <n>' in stderr; stderr so far: " + buf)),
      timeoutMs
    );
    proc.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/listening on port (\d+)/);
      if (m) finish(resolveP, Number(m[1]));
    });
    proc.on("close", (code) => {
      finish(rejectP, new Error("process exited with code " + code + " before listening; stderr so far: " + buf));
    });
  });
}

test("http transport: POST /mcp, GET /mcp SSE, GET /healthz", async () => {
  proc = spawn(process.execPath, [serverPath], {
    env: { ...process.env, MCP_MODE: "http", PORT: "0", SKILLS_DIRS: fixturesSkills },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const port = await waitForPort(proc, 5000);
  const base = "http://127.0.0.1:" + port;
  const post = (body) =>
    fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const initRes = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(initRes.status, 200);
  assert.ok(initRes.headers.get("content-type").startsWith("application/json"));
  const init = await initRes.json();
  assert.equal(init.result.serverInfo.name, "skills");

  const callRes = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_skills" } });
  assert.equal(callRes.status, 200);
  const call = await callRes.json();
  assert.ok(call.result.content[0].text.includes("alpha"));

  const notifRes = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notifRes.status, 202);
  assert.equal(await notifRes.text(), "");

  const healthRes = await fetch(base + "/healthz");
  assert.equal(healthRes.status, 200);
  assert.equal(await healthRes.text(), "ok");

  const sseRes = await fetch(base + "/mcp");
  assert.equal(sseRes.status, 200);
  assert.ok(sseRes.headers.get("content-type").startsWith("text/event-stream"));
  await sseRes.body.cancel();
});
