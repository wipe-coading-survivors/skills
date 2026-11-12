#!/bin/sh
# Host install, run from the repo root (it cds there itself):
# 1) prechecks: node, git, CRE (auto, same logic as the Makefile),
#    local.mk, $HOME/.config/opencode/opencode.jsonc; then make build
#    (LINKS_ONLY=1 skips node/git/CRE/config prechecks and the build —
#    native deployment needs only local.mk for rendering)
# 2) per skill dir in skills/: every file (SKILL.md and helpers) goes
#    to $HOME/.config/opencode/skills/<name>/<file>:
#    - file WITH @VAR@ placeholders: render into a mktemp -d work area
#      via scripts/render.sh (one work area per skill, rendered on
#      first placeholder file), then stage+rename the rendered file
#      (cp to target/<file>.new, mv over target/<file> — rename
#      replaces a stale symlink itself and never writes through it into
#      the tracked repo file; cp straight into target/ is forbidden),
#      touch target/.rendered, print its md5
#    - file WITHOUT placeholders: ln -sf <repo>/skills/<name>/<file>
#      into target
#    - target/<file> existing as a plain file (not a symlink) without
#      the .rendered marker while the source file has no placeholders =
#      pre-migration state: abort with a one-time migration hint
# 3) patch the config: mcp.servers.skills — local entry
#    {"type":"local","command":["<CRE>","run","--rm","-i","skills-mcp:local"]}
#    or remote {"type":"remote","url":"$SKILLS_MCP_URL"} when the env is set
#    (LINKS_ONLY=1 skips this step — MCP config stays as is)
# 4) make smoke (LINKS_ONLY=1 skips this too)
#
# No rm: mktemp work areas are left in place (repo scripts do not rm).
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$repo_root"

die() { echo "install: $*" >&2; exit 1; }

links_only=${LINKS_ONLY:-0}

if [ "$links_only" -ne 1 ]; then
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

    config=$HOME/.config/opencode/opencode.jsonc
    [ -f "$config" ] || die "opencode config not found: $config"

    make build
fi

[ -f local.mk ] || die "local.mk not found: $repo_root/local.mk — copy local.mk.example and fill in real values"

skills_root=$HOME/.config/opencode/skills
for dir in skills/*/; do
    name=${dir%/}
    name=${name##*/}
    target=$skills_root/$name
    mkdir -p "$target"
    [ -f "skills/$name/SKILL.md" ] || die "skill without SKILL.md: skills/$name"

    tmp=
    for src in skills/$name/*; do
        [ -f "$src" ] || continue
        base=${src##*/}

        if grep -qE '@[A-Z][A-Z0-9_]*@' "$src"; then
            if [ -z "$tmp" ]; then
                tmp=$(mktemp -d)
                mkdir -p "$tmp/skills"
                cp -a "skills/$name" "$tmp/skills/$name"
                scripts/render.sh "$tmp/skills" "$tmp/out"
            fi
            cp "$tmp/out/$name/$base" "$target/$base.new" && mv "$target/$base.new" "$target/$base"
            touch "$target/.rendered"
            md5sum "$target/$base"
        else
            if [ -f "$target/$base" ] && [ ! -L "$target/$base" ] && [ ! -f "$target/.rendered" ]; then
                die "pre-migration state: $target/$base is a plain file without a .rendered marker and '$name/$base' has no placeholders. One-time migration: move it aside (mv $target/$base $target/$base.bak) and re-run scripts/install.sh"
            fi
            ln -sf "$repo_root/$src" "$target/$base"
        fi
    done
done

if [ "$links_only" -ne 1 ]; then
    if [ -n "${SKILLS_MCP_URL:-}" ]; then
        entry="{\"type\":\"remote\",\"url\":\"$SKILLS_MCP_URL\"}"
    else
        entry="{\"type\":\"local\",\"command\":[\"$CRE\",\"run\",\"--rm\",\"-i\",\"skills-mcp:local\"]}"
    fi
    node scripts/patch-mcp-config.mjs set "$config" skills "$entry"

    make smoke
fi

echo "install: done"
