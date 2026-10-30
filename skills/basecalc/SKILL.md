---
name: basecalc
description: Use when computing arithmetic or bitwise operations on numbers in mixed bases, or converting between bases — hex (0x), decimal, octal (0o, leading-0), binary (0b, trailing-b) — e.g. register offsets, address math, bit masks, firmware addresses, "what is 0x1E5 minus 0x20".
---

# basecalc

Deterministic arithmetic, bitwise ops, and base conversion for mixed-radix
operands. Do not do hex/bit math in your head.

## Get calc.py (once per host)

`calc.py` is NOT on disk next to this SKILL.md — never glob/find for it.
The `skill_file(basecalc, calc.py)` MCP tool returns the script content as
text. Make it runnable:

1. call `skill_file(basecalc, calc.py)`;
2. save its output VERBATIM to `/tmp/opencode/calc.py` with the write tool
   (the whole file, byte-for-byte, no edits);
3. verify: `python3 /tmp/opencode/calc.py --selftest` — must print
   `selftest: N ok` and no `FAIL` lines.

## Run

```sh
python3 /tmp/opencode/calc.py [-w N] [-f BASE] ...
```

- `-w N` — mask the result to N bits (bin is zero-padded to N); makes
  `not` a register-width complement.
- `-f hex|dec|oct|bin` — print one base only.
- `--selftest` — verify the script (positive + negative cases).

## Operand notation (checked in this order)

| Looks like | Base |
|---|---|
| `0x…` / `0X…` | hex |
| `0o…` | oct |
| `0b…` | bin |
| ends in `b`, rest is 0/1 (`100101010b`) | bin |
| starts with `0`, length > 1 (`007`) | oct |
| otherwise | dec |

`-` sign prefix and `_` separators are allowed: `-0x100`, `0xFF_FF`.

## Ops

| Word | Symbol | | Word | Symbol |
|---|---|---|---|---|
| sum, add | `+` | | and | `&` |
| sub, minus, diff | `-` | | or | `\|` |
| mul, mult | `*` | | xor | `^` |
| div (floor) | `/` `//` | | shl, lsh | `<<` |
| mod | `%` | | shr, rsh | `>>` |
| pow, power | `**` | | not (unary) | |
| conv, base, show (unary) | | | divmod (q + r) | |

Both syntaxes work: `calc sum 0xFF 230` and `calc 0xff - 0x10`.
One operation per invocation — chain calls for longer expressions.

## Output

Result in all four bases, space-separated: hex dec oct bin.
Hex is printed lowercase. `divmod` prints two lines: `q:` quotient,
`r:` remainder.

```console
$ calc.py sum 0xFF 230
0x1e5  485  0o745  0b111100101
$ calc.py or 100101010b 007
0x12f  303  0o457  0b100101111
$ calc.py -w 8 not 0x0F
0xf0  240  0o360  0b11110000
$ calc.py divmod 100 8
q: 0xc  12  0o14  0b1100
r: 0x4  4  0o4  0b100
```

## Traps

- `div`/`/` is FLOOR division; take the remainder with `mod`.
- `not` without `-w` is Python `~` and goes negative; use `-w N` for
  register width. One's complement = `not`; two's complement = `sub 0 A`
  (both with `-w N`).
- `007` is OCTAL (7), not decimal 7.
- Trailing `b` means binary only when the rest is all 0/1.
- Negative exponents are rejected (integer-only arithmetic).
