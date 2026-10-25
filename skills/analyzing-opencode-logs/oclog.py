#!/usr/bin/env python3
"""oclog — opencode session log analyzer.

Works on `opencode export` JSON files and the opencode SQLite DB.
Stdlib only. See SKILL.md (analyzing-opencode-logs) for the data model.

Typical flow:
  oclog.py sessions "dell"                 # find the session
  oclog.py export ses_... -o /tmp/ses.json # export it
  oclog.py find /tmp/ses.json "Jackpot"    # locate a finding
  oclog.py msg /tmp/ses.json msg_...       # read one message
  oclog.py compactions /tmp/ses.json --keywords a,b   # what summaries lost
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime

DEFAULT_DB = os.path.expanduser("~/.local/share/opencode/opencode.db")


def ts_fmt(t):
    return datetime.fromtimestamp(t / 1000).strftime("%m-%d %H:%M:%S") if t else "?"


def load_export(path):
    with open(path) as f:
        data = json.load(f)
    if "messages" not in data:
        sys.exit(f"error: {path} does not look like an opencode export (no 'messages')")
    return data


def part_blob(p):
    """Searchable text of a part (text/reasoning body, tool input+output)."""
    t = p.get("type")
    if t in ("text", "reasoning"):
        return p.get("text") or ""
    if t == "tool":
        s = p.get("state") or {}
        bits = []
        if s.get("input") is not None:
            bits.append(json.dumps(s["input"], ensure_ascii=False))
        if s.get("output"):
            bits.append(str(s["output"]))
        return "\n".join(bits)
    if t == "patch":
        return p.get("patch") or ""
    return json.dumps(p, ensure_ascii=False)


def clip(s, n):
    s = s or ""
    if n is None or len(s) <= n:
        return s
    return s[:n] + f" …[+{len(s) - n} chars]"


def msg_tokens(m):
    t = (m.get("info") or {}).get("tokens") or {}
    return t.get("total", 0)


def part_summary(p):
    t = p.get("type")
    if t in ("text", "reasoning"):
        return f"{t}({len(p.get('text') or '')})"
    if t == "tool":
        return f"tool:{p.get('tool') or '?'}"
    if t == "compaction":
        return "COMPACTION"
    return t or "?"


def find_msg_by_id(data, msg_id):
    for i, m in enumerate(data["messages"]):
        if (m.get("info") or {}).get("id") == msg_id:
            return i, m
    return None, None


def idx_by_id(data):
    return { (m.get("info") or {}).get("id"): i
             for i, m in enumerate(data["messages"]) }


# ---------------------------------------------------------------- sessions

def cmd_sessions(args):
    db = sqlite3.connect(args.db)
    q = ("SELECT s.id, s.title, datetime(s.time_created/1000,'unixepoch'), "
         "(SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) "
         "FROM session s")
    params = []
    if args.pattern:
        q += " WHERE s.title LIKE ? OR s.slug LIKE ?"
        params += [f"%{args.pattern}%"] * 2
    q += " ORDER BY s.time_created DESC LIMIT ?"
    params.append(args.limit)
    for sid, title, created, nmsg in db.execute(q, params):
        print(f"{created}  {sid}  msgs={nmsg:<5} {title}")


# ----------------------------------------------------------------- export

def cmd_export(args):
    if not shutil.which("opencode"):
        sys.exit("error: `opencode` CLI not found in PATH")
    out = args.out or f"/tmp/ses_{args.session}.json"
    with open(out, "wb") as f:
        subprocess.run(["opencode", "export", args.session], stdout=f, check=True)
    size = os.path.getsize(out)
    print(f"exported {args.session} -> {out} ({size} bytes)")
    print("note: re-export if the session is still active (the file grows)")


# --------------------------------------------------------------------- msg

def print_parts(m, full=False, out_clip=800):
    for p in m.get("parts", []):
        t = p.get("type")
        if t in ("text", "reasoning"):
            body = p.get("text") or ""
            print(f"--- {t} ---")
            print(body if full else clip(body, 4000))
        elif t == "tool":
            s = p.get("state") or {}
            meta = s.get("metadata") or {}
            inp = json.dumps(s.get("input"), ensure_ascii=False)
            outp = s.get("output") or ""
            print(f"--- tool:{p.get('tool') or '?'} status={s.get('status')} ---")
            print(f"  input: {clip(inp, out_clip if not full else None)}")
            if meta.get("outputPath"):
                print(f"  full output: {meta['outputPath']} (truncated={meta.get('truncated')}, exit={meta.get('exit')})")
                if full and os.path.exists(meta["outputPath"]):
                    with open(meta["outputPath"]) as f:
                        print("  " + f.read().replace("\n", "\n  "))
            else:
                print(f"  output: {clip(outp, out_clip if not full else 100000)}")
        elif t == "patch":
            print(f"--- patch ({len(p.get('patch') or '')} chars) ---")
            if full:
                print(p.get("patch") or "")
        elif t == "compaction":
            print(f"--- COMPACTION auto={p.get('auto')} overflow={p.get('overflow')} tail_start_id={p.get('tail_start_id')} ---")
        else:
            print(f"--- {t} ---")


def cmd_msg(args):
    data = load_export(args.file)
    i, m = find_msg_by_id(data, args.msg_id)
    if m is None:
        sys.exit(f"error: msg_id {args.msg_id} not found in {args.file}")
    info = m.get("info") or {}
    print(f"[{i}] {ts_fmt((info.get('time') or {}).get('created'))} {info.get('role')} {info.get('id')} "
          f"tokens={msg_tokens(m)} finish={info.get('finish')}")
    print_parts(m, full=args.full)


# -------------------------------------------------------------------- find

def cmd_find(args):
    data = load_export(args.file)
    rx = re.compile(args.pattern, re.IGNORECASE) if args.regex else None
    total = 0
    hits = []
    for i, m in enumerate(data["messages"]):
        info = m.get("info") or {}
        ts = ts_fmt((info.get("time") or {}).get("created"))
        for p in m.get("parts", []):
            blob = part_blob(p)
            if not blob:
                continue
            matches = list(rx.finditer(blob)) if rx else [
                m2 for m2 in [re.search(re.escape(args.pattern), blob, re.IGNORECASE)] if m2]
            for m2 in matches:
                s = max(0, m2.start() - 120)
                e = min(len(blob), m2.end() + 280)
                snippet = blob[s:e].replace("\n", " ⏎ ")
                hit = {
                    "idx": i, "ts": ts, "role": info.get("role"),
                    "msg_id": info.get("id"), "part_type": p.get("type"),
                    "snippet": snippet,
                }
                hits.append(hit)
                if not args.json:
                    print(f"[{i}] {ts} {info.get('role')} {info.get('id')} "
                          f"{p.get('type')}:{p.get('tool', '')}")
                    print(f"    …{snippet}…")
                total += 1
                if total >= args.limit:
                    break
            if total >= args.limit:
                break
        if total >= args.limit:
            break
    if args.json:
        print(json.dumps(hits, ensure_ascii=False, indent=1))
    elif total == 0:
        print("(no matches)")


# --------------------------------------------------------------- timeline

def cmd_timeline(args):
    data = load_export(args.file)
    idx = idx_by_id(data)
    for i, m in enumerate(data["messages"]):
        info = m.get("info") or {}
        parts = []
        comp = None
        for p in m.get("parts", []):
            if p.get("type") == "compaction":
                comp = p
                tail = idx.get(p.get("tail_start_id"))
                parts.append(f"COMPACTION(auto={p.get('auto')}, tail=[{tail}])")
            else:
                parts.append(part_summary(p))
        print(f"[{i}] {ts_fmt((info.get('time') or {}).get('created'))} "
              f"{info.get('role'):<9} tok={msg_tokens(m):<7} {' '.join(parts)}")


# ----------------------------------------------------------- compactions

def cmd_compactions(args):
    data = load_export(args.file)
    msgs = data["messages"]
    idx = idx_by_id(data)
    kws = [k for k in (args.keywords or "").split(",") if k]
    for i, m in enumerate(msgs):
        for p in m.get("parts", []):
            if p.get("type") != "compaction":
                continue
            tail_id = p.get("tail_start_id")
            tail = idx.get(tail_id)
            summary = ""
            if i + 1 < len(msgs):
                nxt = msgs[i + 1]
                summary = " ".join(
                    (q.get("text") or "") for q in nxt.get("parts", [])
                    if q.get("type") in ("text", "reasoning"))
            print(f"[{i}] {ts_fmt((m.get('info') or {}).get('time', {}).get('created'))} "
                  f"compaction auto={p.get('auto')} overflow={p.get('overflow')} "
                  f"tail_start={tail_id} -> [{tail}] (summary msg [{i+1}])")
            if not kws:
                continue
            pre = " ".join(part_blob(q) for mm in msgs[:tail or 0]
                           for q in mm.get("parts", []))
            for k in kws:
                in_pre = k in pre
                in_sum = k in summary
                verdict = "PRESERVED" if (in_pre and in_sum) else (
                    "LOST" if in_pre else "absent-pre")
                print(f"    kw {k!r}: pre-tail={'yes' if in_pre else 'no':<4} "
                      f"summary={'yes' if in_sum else 'no':<4} => {verdict}")


# ------------------------------------------------------------------ parts

def cmd_parts(args):
    data = load_export(args.file)
    i, m = find_msg_by_id(data, args.msg_id)
    if m is None:
        sys.exit(f"error: msg_id {args.msg_id} not found in {args.file}")
    info = m.get("info") or {}
    print(f"[{i}] {ts_fmt((info.get('time') or {}).get('created'))} {info.get('role')} "
          f"{info.get('id')} parent={info.get('parentID')}")
    print(json.dumps({k: v for k, v in info.items()
                      if k in ("cost", "modelID", "providerID", "finish", "tokens")},
                     ensure_ascii=False))
    print_parts(m, full=args.full, out_clip=100000 if args.full else 800)


# ------------------------------------------------------------------- range

def cmd_range(args):
    data = load_export(args.file)
    msgs = data["messages"]
    lo, hi = args.first, min(args.second, len(msgs) - 1)
    for i in range(lo, hi + 1):
        m = msgs[i]
        info = m.get("info") or {}
        print(f"===== [{i}] {ts_fmt((info.get('time') or {}).get('created'))} "
              f"{info.get('role')} {info.get('id')} =====")
        for p in m.get("parts", []):
            t = p.get("type")
            if t in ("text", "reasoning"):
                print(f"--- {t} ---")
                print(clip(p.get("text") or "", 3000))
            elif t == "tool":
                s = p.get("state") or {}
                inp = json.dumps(s.get("input"), ensure_ascii=False)
                print(f"--- tool:{p.get('tool') or '?'} ---  input: {clip(inp, 200)}")
            elif t == "compaction":
                print(f"--- COMPACTION tail_start_id={p.get('tail_start_id')} ---")
            elif t == "patch":
                print(f"--- patch ({len(p.get('patch') or '')} chars) ---")


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(prog="oclog", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("sessions", help="find sessions in the opencode DB")
    p.add_argument("pattern", nargs="?", default=None)
    p.add_argument("--limit", type=int, default=25)
    p.add_argument("--db", default=DEFAULT_DB)
    p.set_defaults(fn=cmd_sessions)

    p = sub.add_parser("export", help="opencode export wrapper")
    p.add_argument("session")
    p.add_argument("-o", "--out", default=None)
    p.set_defaults(fn=cmd_export)

    p = sub.add_parser("msg", help="print one message by msg_id")
    p.add_argument("file")
    p.add_argument("msg_id")
    p.add_argument("--full", action="store_true")
    p.set_defaults(fn=cmd_msg)

    p = sub.add_parser("find", help="search a phrase across all parts")
    p.add_argument("file")
    p.add_argument("pattern")
    p.add_argument("--regex", action="store_true")
    p.add_argument("-i", action="store_true", help="(case-insensitive is the default)")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_find)

    p = sub.add_parser("timeline", help="index/ts/role/tokens + compactions")
    p.add_argument("file")
    p.set_defaults(fn=cmd_timeline)

    p = sub.add_parser("compactions", help="compaction events; --keywords checks survival in summaries")
    p.add_argument("file")
    p.add_argument("--keywords", default=None, help="comma-separated")
    p.set_defaults(fn=cmd_compactions)

    p = sub.add_parser("parts", help="deep-dive one message (all parts, tool states)")
    p.add_argument("file")
    p.add_argument("msg_id")
    p.add_argument("--full", action="store_true", help="untruncated; follows outputPath for truncated tool output")
    p.set_defaults(fn=cmd_parts)

    p = sub.add_parser("range", help="print messages by index range (inclusive)")
    p.add_argument("file")
    p.add_argument("first", type=int)
    p.add_argument("second", type=int)
    p.set_defaults(fn=cmd_range)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
