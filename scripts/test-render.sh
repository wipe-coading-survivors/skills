#!/bin/sh
# Check: scripts/render.sh placeholder substitution (TAP).
# render.sh <src> <dst> [local.mk]: @VAR@ -> value; leftover
# placeholders and empty values are errors. Temp local.mk files live
# in a mktemp -d work area (left in place; no rm in repo scripts).
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$repo_root"
pass=0
fail=0

ok() { pass=$((pass + 1)); echo "ok - $1"; }
ko() { fail=$((fail + 1)); echo "not ok - $1"; echo "  expected: $2"; echo "  actual:   $3"; }

tmp=$(mktemp -d)
fixture=test/fixtures-render/skills

# 1) := and = forms are substituted; placeholders disappear
mk=$tmp/local-1.mk
printf 'FOO := 192.0.2.101\nBAR = 192.0.2.102\n' > "$mk"
out=$tmp/out-1
if scripts/render.sh "$fixture" "$out" "$mk" 2> "$tmp/err-1"; then
    rendered=$out/alpha/SKILL.md
    if grep -q '192.0.2.101' "$rendered" \
        && grep -q '192.0.2.102' "$rendered" \
        && ! grep -q '@FOO@' "$rendered" \
        && ! grep -q '@BAR@' "$rendered"; then
        ok "substitutes := and = forms, no placeholders left"
    else
        ko "substitutes := and = forms, no placeholders left" \
            "both values present; @FOO@/@BAR@ absent" \
            "$(sed 's/^/    /' "$rendered")"
    fi
else
    rc=$?
    ko "substitutes := and = forms, no placeholders left" \
        "render.sh exit 0" \
        "exit $rc; stderr: $(sed 's/^/    /' "$tmp/err-1")"
fi

# 2) placeholder without a value -> exit != 0, stderr names it
src=$tmp/src-2
mkdir -p "$src/skills/alpha"
printf -- '---\nname: alpha\ndescription: fixture with an unset placeholder\n---\n\nvalue: @NOPE@\n' > "$src/skills/alpha/SKILL.md"
printf 'FOO := 192.0.2.101\n' > "$tmp/local-2.mk"
if scripts/render.sh "$src" "$tmp/out-2" "$tmp/local-2.mk" 2> "$tmp/err-2"; then
    ko "unset placeholder -> exit != 0" "non-zero exit" "exit 0"
else
    rc=$?
    if grep -q 'NOPE' "$tmp/err-2"; then
        ok "unset placeholder -> exit != 0, stderr names NOPE"
    else
        ko "unset placeholder -> exit != 0" \
            "non-zero exit, stderr names NOPE" \
            "exit $rc; stderr: $(sed 's/^/    /' "$tmp/err-2")"
    fi
fi

# 3) empty value -> exit != 0, stderr says so
printf 'FOO :=\nBAR = 192.0.2.102\n' > "$tmp/local-3.mk"
if scripts/render.sh "$fixture" "$tmp/out-3" "$tmp/local-3.mk" 2> "$tmp/err-3"; then
    ko "empty value -> exit != 0" "non-zero exit" "exit 0"
else
    rc=$?
    if grep -q 'empty value: FOO' "$tmp/err-3"; then
        ok "empty value -> exit != 0, stderr: empty value: FOO"
    else
        ko "empty value -> exit != 0" \
            "non-zero exit, stderr contains 'empty value: FOO'" \
            "exit $rc; stderr: $(sed 's/^/    /' "$tmp/err-3")"
    fi
fi

echo "# pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
