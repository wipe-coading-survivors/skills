import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// JSONC config patcher for opencode.jsonc.
//
// usage:
//   node scripts/patch-mcp-config.mjs set <config.jsonc> <server-name> <json-entry>
//   node scripts/patch-mcp-config.mjs remove <config.jsonc> <top-level-key>
//
// set    writes mcp.servers.<server-name> = <json-entry>, creating the
//        mcp/mcp.servers blocks if absent, preserving everything else
// remove deletes the top-level key
// The file is rewritten in place as normalized JSON (indent 2); comments
// are not preserved.

const USAGE = `usage:
  node scripts/patch-mcp-config.mjs set <config.jsonc> <server-name> <json-entry>
  node scripts/patch-mcp-config.mjs remove <config.jsonc> <top-level-key>
`;

function fail(msg) {
  process.stderr.write(`patch-mcp-config: ${msg}\n`);
  process.exit(1);
}

// JSONC -> object. One pass, small state machine:
// - strings are escape-aware: \" does not close the string, and // inside
//   a string (e.g. "https://…") is not a comment;
// - // line and /* */ block comments are stripped (newlines kept, so
//   JSON.parse error positions still map to the input);
// - a comma whose next significant character (past whitespace and
//   comments) is } or ] is dropped (trailing comma).
export function parseJsonc(text) {
  const n = text.length;
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      if (ch === "\\") {
        out += ch + (next === undefined ? "" : next);
        i += 2;
      } else {
        out += ch;
        if (ch === '"') inString = false;
        i += 1;
      }
      continue;
    }
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 2;
      } else {
        if (ch === "\n") out += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      let significant = "";
      while (j < n) {
        const c = text[j];
        if (c === " " || c === "\t" || c === "\n" || c === "\r") {
          j += 1;
        } else if (c === "/" && text[j + 1] === "/") {
          while (j < n && text[j] !== "\n") j += 1;
        } else if (c === "/" && text[j + 1] === "*") {
          j += 2;
          while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j += 1;
          j += 2;
        } else {
          significant = c;
          break;
        }
      }
      if (significant !== "}" && significant !== "]") out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  if (inString) throw new Error("unterminated string");
  if (inLine || inBlock) throw new Error("unterminated comment");
  return JSON.parse(out);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readConfig(configPath) {
  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      fail(`config not found: ${configPath}`);
    }
    fail(`cannot read config ${configPath}: ${e.code ?? e.message}`);
  }
  try {
    return parseJsonc(text);
  } catch (e) {
    fail(`config is not valid JSONC: ${configPath}: ${e.message}`);
  }
}

function writeConfig(configPath, obj) {
  writeFileSync(configPath, JSON.stringify(obj, null, 2) + "\n");
}

function cmdSet(configPath, name, entryText) {
  let entry;
  try {
    entry = JSON.parse(entryText);
  } catch (e) {
    fail(`json-entry is not a JSON value: ${entryText}: ${e.message}`);
  }
  if (!isPlainObject(entry)) {
    fail("json-entry must be a JSON object");
  }
  const obj = readConfig(configPath);
  if (obj.mcp !== undefined && !isPlainObject(obj.mcp)) {
    fail("config key 'mcp' is not an object");
  }
  obj.mcp = obj.mcp ?? {};
  if (obj.mcp.servers !== undefined && !isPlainObject(obj.mcp.servers)) {
    fail("config key 'mcp.servers' is not an object");
  }
  obj.mcp.servers = obj.mcp.servers ?? {};
  obj.mcp.servers[name] = entry;
  writeConfig(configPath, obj);
}

function cmdRemove(configPath, key) {
  const obj = readConfig(configPath);
  if (!(key in obj)) {
    fail(`top-level key not found: ${key}`);
  }
  delete obj[key];
  writeConfig(configPath, obj);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "set" && rest.length === 3) {
    cmdSet(rest[0], rest[1], rest[2]);
    return;
  }
  if (cmd === "remove" && rest.length === 2) {
    cmdRemove(rest[0], rest[1]);
    return;
  }
  process.stderr.write(USAGE);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
