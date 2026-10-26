import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER_INFO = { name: "skills", version: "1.0.0" };
const DOCS_SUFFIX =
  "ALWAYS consult this before answering questions or running operations in this domain; it takes precedence over general model knowledge and third-party documentation sources (context7, vendor docs) for these topics";

export function parseFrontmatter(text) {
  const lines = text.split("\n");
  if ((lines[0] || "").trim() !== "---") {
    throw new Error("no frontmatter: text must start with ---");
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("no frontmatter: closing --- not found");
  const meta = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    name: meta.name,
    description: meta.description,
    body: lines.slice(end + 1).join("\n").replace(/^\s+/, ""),
  };
}

export function defaultSkillsDir() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

function listFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(relative(root, p));
    }
  };
  walk(root);
  return out;
}

function loadSkill(dir) {
  const dirResolved = resolve(dir);
  const meta = parseFrontmatter(readFileSync(join(dirResolved, "SKILL.md"), "utf8"));
  return {
    name: meta.name,
    dir: dirResolved,
    meta: { name: meta.name, description: meta.description },
    files: listFiles(dirResolved),
  };
}

export function discoverSkills(dirs) {
  const skills = [];
  for (const entry of dirs) {
    if (!existsSync(entry) || !statSync(entry).isDirectory()) {
      process.stderr.write("warning: skipping non-directory entry: " + entry + "\n");
      continue;
    }
    if (existsSync(join(entry, "SKILL.md"))) {
      skills.push(loadSkill(entry));
    } else {
      for (const sub of readdirSync(entry, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!sub.isDirectory()) continue;
        const dir = join(entry, sub.name);
        if (existsSync(join(dir, "SKILL.md"))) {
          skills.push(loadSkill(dir));
        } else {
          process.stderr.write("warning: skipping non-skill directory: " + dir + "\n");
        }
      }
    }
  }
  return skills;
}

export function buildTools(skills) {
  const tools = [
    {
      name: "list_skills",
      description: "List available skills: name, description, files.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
  for (const s of skills) {
    tools.push({
      name: s.name.replace(/-/g, "_") + "_docs",
      description: s.meta.description + " " + DOCS_SUFFIX,
      inputSchema: {
        type: "object",
        properties: {
          section: {
            type: "string",
            description: "Optional section title (case-insensitive substring). Omit to get the full doc.",
          },
        },
      },
    });
  }
  tools.push({
    name: "skill_file",
    description: "Read a file from a skill directory by relative path (helper scripts, data files).",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Skill name." },
        path: { type: "string", description: "File path relative to the skill directory." },
      },
      required: ["skill", "path"],
    },
  });
  return tools;
}

export function buildResources(skills) {
  return skills.map((s) => ({
    uri: "mcp://skills/" + s.name + "/SKILL.md",
    name: s.name + " skill",
    description: s.meta.description,
    mimeType: "text/markdown",
  }));
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function textResult(text, isError) {
  const result = { content: [{ type: "text", text }] };
  if (isError) result.isError = true;
  return result;
}

function skillSections(text) {
  return text
    .split(/^(?=## )/m)
    .map((p) => {
      const m = p.match(/^## (.+)$/m);
      return { title: m ? m[1].trim() : "(preamble)", text: p.trimEnd() };
    })
    .filter((s) => s.text.length > 0);
}

function callDocs(id, skill, args) {
  const full = readFileSync(join(skill.dir, "SKILL.md"), "utf8");
  const wanted = String((args && args.section) || "").toLowerCase();
  if (!wanted) return { jsonrpc: "2.0", id, result: textResult(full) };
  const hits = skillSections(full).filter((s) => s.title.toLowerCase().includes(wanted));
  if (hits.length === 0) {
    const avail = skillSections(full).map((s) => s.title).join(" | ");
    return {
      jsonrpc: "2.0",
      id,
      result: textResult('No section matching "' + args.section + '". Available sections: ' + avail, true),
    };
  }
  return { jsonrpc: "2.0", id, result: textResult(hits.map((s) => s.text).join("\n\n")) };
}

function callSkillFile(id, args, skills) {
  const skill = skills.find((s) => s.name === (args && args.skill));
  if (!skill) return { jsonrpc: "2.0", id, result: textResult("unknown skill: " + (args && args.skill), true) };
  const root = resolve(skill.dir);
  const target = resolve(join(root, String(args.path)));
  if (target !== root && !target.startsWith(root + sep)) {
    return { jsonrpc: "2.0", id, result: textResult("path outside skill dir: " + args.path, true) };
  }
  const buf = readFileSync(target);
  if (buf.subarray(0, 8192).includes(0)) {
    return { jsonrpc: "2.0", id, result: textResult("binary file not supported: " + args.path, true) };
  }
  return { jsonrpc: "2.0", id, result: textResult(buf.toString("utf8")) };
}

function callTool(id, params, skills) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
  if (name === "list_skills") {
    const text = skills
      .map((s) => s.name + " — " + s.meta.description + " (files: " + s.files.join(", ") + ")")
      .join("\n");
    return { jsonrpc: "2.0", id, result: textResult(text) };
  }
  if (name === "skill_file") return callSkillFile(id, args, skills);
  const m = typeof name === "string" ? name.match(/^(.*)_docs$/) : null;
  if (m) {
    const skill = skills.find((s) => s.name.replace(/-/g, "_") === m[1]);
    if (skill) return callDocs(id, skill, args);
  }
  return rpcError(id, -32602, "unknown tool: " + name);
}

export function handleRequest(msg, skills) {
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
      result = { tools: buildTools(skills) };
      break;
    case "tools/call":
      return callTool(id, params, skills);
    case "resources/list":
      result = { resources: buildResources(skills) };
      break;
    case "resources/read": {
      const uri = params && params.uri;
      const res = buildResources(skills).find((r) => r.uri === uri);
      if (!res) return rpcError(id, -32002, "resource not found: " + uri);
      const skill = skills.find((s) => "mcp://skills/" + s.name + "/SKILL.md" === uri);
      result = { contents: [{ uri, mimeType: res.mimeType, text: readFileSync(join(skill.dir, "SKILL.md"), "utf8") }] };
      break;
    }
    default:
      return rpcError(id, -32601, "method not supported: " + method);
  }
  return { jsonrpc: "2.0", id, result };
}

function sendJson(res, obj) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

export function startHttpServer(skills, port) {
  return new Promise((resolveP, rejectP) => {
    const onError = (e) => rejectP(e);
    const server = createServer((req, res) => {
      const path = (req.url || "").split("?")[0];
      if (req.method === "POST" && path === "/mcp") {
        let body = "";
        req.on("data", (c) => (body += c.toString("utf8")));
        req.on("end", () => {
          let msg;
          try {
            msg = JSON.parse(body);
          } catch {
            sendJson(res, rpcError(null, -32603, "invalid JSON body"));
            return;
          }
          if (Array.isArray(msg)) {
            sendJson(res, rpcError(null, -32603, "batch requests are not supported"));
            return;
          }
          if (!msg || msg.id === undefined) {
            res.writeHead(202);
            res.end();
            return;
          }
          let resp;
          try {
            resp = handleRequest(msg, skills);
          } catch (e) {
            resp = rpcError(msg.id, -32603, String(e));
          }
          sendJson(res, resp);
        });
        return;
      }
      if (req.method === "GET" && path === "/mcp") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.flushHeaders();
        req.on("close", () => res.end());
        return;
      }
      if (req.method === "GET" && path === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
    server.once("error", onError);
    server.listen(port, () => {
      server.removeListener("error", onError);
      resolveP(server);
    });
  });
}

async function main() {
  const dirs = (process.env.SKILLS_DIRS || defaultSkillsDir())
    .split(delimiter)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
  const skills = discoverSkills(dirs);
  if (process.env.MCP_MODE === "http") {
    const port = process.env.PORT === undefined ? 8080 : Number(process.env.PORT);
    const server = await startHttpServer(skills, port);
    process.stderr.write("listening on port " + server.address().port + "\n");
    return;
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
        resp = handleRequest(msg, skills);
      } catch (e) {
        resp = rpcError(msg.id, -32603, String(e));
      }
      process.stdout.write(JSON.stringify(resp) + "\n");
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
