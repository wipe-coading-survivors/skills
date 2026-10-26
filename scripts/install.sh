#!/bin/sh
# Host install, run from the repo root (it cds there itself):
# 1) prechecks: node, git, CRE (auto, same logic as the Makefile),
#    local.mk, $HOME/.config/opencode/opencode.jsonc; then make build
# 2) per skill dir in skills/: target $HOME/.config/opencode/skills/<name>:
#    - skill WITH @VAR@ placeholders: render into a mktemp -d work area
#      via scripts/render.sh, then stage+rename the rendered SKILL.md
#      (cp to target/SKILL.md.new, mv over target/SKILL.md — rename
#      replaces a stale symlink itself and never writes through it into
#      the tracked repo file; cp straight into target/ is forbidden),
#      touch target/.rendered, print its md5
#    - skill WITHOUT placeholders: ln -sf <repo>/skills/<name>/SKILL.md
#      into target
#    - target/SKILL.md existing as a plain file (not a symlink) without
#      the .rendered marker while the skill has no placeholders =
#      pre-migration state: abort with a one-time migration hint
# 3) patch the config: mcp.servers.skills — local entry
#    {"type":"local","command":["<CRE>","run","--rm","-i","skills-mcp:local"]}
#    or remote {"type":"remote","url":"$SKILLS_MCP_URL"} when the env is set
# 4) make smoke
#
# No rm: mktemp work areas are left in place (repo scripts do not rm).
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$repo_root"

die() { echo "install: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node not found in PATH"
command -v git >/dev/null 2>&1 || die "git not found in PATH"

if [ -z "${CRE:-}" ]; then
    if [ -f /run/.containerenv ]; then
        CRE=podman-remote
    else
        CRE=podman
    fi
fi
command -v "$CRE" >/dev/null 2>&1 || die "container tool '$CRE' not found in PATH (CRE: exported value kept, else auto-detected like in the Makefile)"

[ -f local.mk ] || die "local.mk not found: $repo_root/local.mk — copy local.mk.example and fill in real values"

config=$HOME/.config/opencode/opencode.jsonc
[ -f "$config" ] || die "opencode config not found: $config"

make build

skills_root=$HOME/.config/opencode/skills
for dir in skills/*/; do
    name=${dir%/}
    name=${name##*/}
    target=$skills_root/$name
    mkdir -p "$target"
    skill_md=skills/$name/SKILL.md
    [ -f "$skill_md" ] || die "skill without SKILL.md: skills/$name"

    if grep -qE '@[A-Z][A-Z0-9_]*@' "$skill_md"; then
        has_ph=1
    else
        has_ph=0
    fi

    if [ "$has_ph" -eq 0 ] && [ -f "$target/SKILL.md" ] && [ ! -L "$target/SKILL.md" ] && [ ! -f "$target/.rendered" ]; then
        die "pre-migration state: $target/SKILL.md is a plain file without a .rendered marker and skill '$name' has no placeholders. One-time migration: move it aside (mv $target/SKILL.md $target/SKILL.md.bak) and re-run scripts/install.sh"
    fi

    if [ "$has_ph" -eq 1 ]; then
        tmp=$(mktemp -d)
        mkdir -p "$tmp/skills"
        cp -a "skills/$name" "$tmp/skills/$name"
        scripts/render.sh "$tmp/skills" "$tmp/out"
        cp "$tmp/out/$name/SKILL.md" "$target/SKILL.md.new" && mv "$target/SKILL.md.new" "$target/SKILL.md"
        touch "$target/.rendered"
        md5sum "$target/SKILL.md"
    else
        ln -sf "$repo_root/skills/$name/SKILL.md" "$target/SKILL.md"
    fi
done

if [ -n "${SKILLS_MCP_URL:-}" ]; then
    entry="{\"type\":\"remote\",\"url\":\"$SKILLS_MCP_URL\"}"
else
    entry="{\"type\":\"local\",\"command\":[\"$CRE\",\"run\",\"--rm\",\"-i\",\"skills-mcp:local\"]}"
fi
node scripts/patch-mcp-config.mjs set "$config" skills "$entry"

make smoke

echo "install: done"
