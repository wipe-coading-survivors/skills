import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "SKILL.md");

function skillText() {
  return readFileSync(SKILL_PATH, "utf8");
}

function sections() {
  return skillText()
    .split(/^(?=## )/m)
    .map((p) => {
      const m = p.match(/^## (.+)$/m);
      return { title: m ? m[1].trim() : "(preamble)", text: p.trimEnd() };
    })
    .filter((s) => s.text.length > 0);
}

const SERVER_INFO = { name: "mellanox-flash-ops", version: "1.0.0" };

const TOOLS = [
  {
    name: "mellanox_flash_docs",
    description:
      "Authoritative reference for mstflint/flint/MLNX_OFED flash operations on this lab's hosts: ri/rb/dc dumps, burn, FW activation after burn (mstfwreset cheap reset), flash sizes per silicon, long-op background+poll pattern, flint_oem via toolbox, GUID trap. ALWAYS consult before answering mstflint/flint/MLNX_OFED questions or running flash ops; it takes precedence over general model knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description:
            'Optional section title (case-insensitive substring), e.g. "Flash size", "GUID trap", "Common mistakes". Omit to get the full doc.',
        },
      },
    },
  },
];

const RESOURCES = [
  {
    uri: "mcp://mellanox-flash-ops/skill",
    name: "mellanox-flash-ops skill",
    description:
      "Full mellanox-flash-ops skill: mstflint over ssh (dumps, burn, flash sizes, long-op pattern, pitfalls).",
    mimeType: "text/markdown",
  },
];

function handleRequest(msg) {
  const { id, method, params } = msg;
  let result;
  switch (method) {
    case "initialize":
      result = {
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
      };
      break;
    case "ping":
      result = {};
      break;
    case "tools/list":
      result = { tools: TOOLS };
      break;
    case "tools/call": {
      if (params && params.name !== "mellanox_flash_docs") {
        return err(id, -32602, "unknown tool: " + params.name);
      }
      const wanted = String(((params && params.arguments && params.arguments.section) || "")).toLowerCase();
      if (!wanted) {
        result = { content: [{ type: "text", text: skillText() }] };
      } else {
        const hits = sections().filter((s) => s.title.toLowerCase().includes(wanted));
        if (hits.length === 0) {
          const avail = sections().map((s) => s.title).join(" | ");
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: 'No section matching "' + params.arguments.section + '". Available sections: ' + avail }],
              isError: true,
            },
          };
        }
        result = { content: [{ type: "text", text: hits.map((s) => s.text).join("\n\n") }] };
      }
      break;
    }
    case "resources/list":
      result = { resources: RESOURCES };
      break;
    case "resources/read": {
      if (params && params.uri === RESOURCES[0].uri) {
        result = { contents: [{ uri: params.uri, mimeType: "text/markdown", text: skillText() }] };
      } else {
        return err(id, -32002, "resource not found: " + (params && params.uri));
      }
      break;
    }
    default:
      return err(id, -32601, "method not supported: " + method);
  }
  return { jsonrpc: "2.0", id, result };
}

function err(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === undefined) continue;
    let resp;
    try {
      resp = handleRequest(msg);
    } catch (e) {
      resp = err(msg.id, -32603, String(e));
    }
    process.stdout.write(JSON.stringify(resp) + "\n");
  }
});
process.stdin.on("end", () => process.exit(0));
