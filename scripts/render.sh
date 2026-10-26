#!/bin/sh
# Render a skills tree into dst: substitute @VAR@ placeholders with
# values from local.mk (lines `VAR := v` / `VAR = v`; comments and
# empty lines skipped). Leftover placeholders or empty values are
# errors.
#
# usage: scripts/render.sh <src> <dst> [local.mk]
#   src      directory containing skill directories (copied to dst)
#   dst      output directory; must not pre-exist
#   local.mk variable definitions; default <repo>/local.mk
#
# The mktemp -d work area (sed script) is left in place; repo scripts
# do not use rm.
set -eu
LC_ALL=C; export LC_ALL

die() { echo "render: $*" >&2; exit 1; }

[ $# -ge 2 ] || { echo "usage: scripts/render.sh <src> <dst> [local.mk]" >&2; exit 2; }
src=$1
dst=$2
mk=${3-}

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
[ -n "$mk" ] || mk=$repo_root/local.mk

[ -d "$src" ] || die "src is not a directory: $src"
[ ! -e "$dst" ] || die "dst already exists: $dst"
[ -f "$mk" ] || die "local.mk not found: $mk"

tmp=$(mktemp -d)
vars=$tmp/vars.sed
: > "$vars"

while IFS= read -r line || [ -n "$line" ]; do
    case $line in
        ''|\#*) continue ;;
        *:=*) vname=${line%%:=*}; vvalue=${line#*:=} ;;
        *=*)  vname=${line%%=*};  vvalue=${line#*=}  ;;
        *)    continue ;;
    esac
    vname=$(printf '%s' "$vname" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    vvalue=$(printf '%s' "$vvalue" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    case $vname in
        [A-Z][A-Z0-9_]*) ;;
        *) continue ;;
    esac
    [ -n "$vvalue" ] || die "empty value: $vname"
    esc=$(printf '%s' "$vvalue" | sed 's/[&/\\]/\\&/g')
    printf 's/@%s@/%s/g\n' "$vname" "$esc" >> "$vars"
done < "$mk"

cp -a "$src" "$dst"
find "$dst" -type f | while IFS= read -r f; do
    sed -f "$vars" "$f" > "$f.rendered" && mv "$f.rendered" "$f"
done

leftover=$(grep -RnE '@[A-Z][A-Z0-9_]*@' "$dst" || true)
if [ -n "$leftover" ]; then
    {
        echo "render: unrendered placeholders in $dst:"
        printf '%s\n' "$leftover" | grep -oE '@[A-Z][A-Z0-9_]*@' | sort -u | sed 's/^/  /'
    } >&2
    exit 1
fi
