---
name: basecalc
description: Use when computing arithmetic or bitwise operations on numbers in mixed bases, or converting between bases — hex (0x), decimal, octal (0o, leading-0), binary (0b, trailing-b) — e.g. register offsets, address math, bit masks, firmware addresses, "what is 0x1E5 minus 0x20".
---

# basecalc

Deterministic arithmetic, bitwise ops, and base conversion for mixed-radix
operands. Do not do hex/bit math in your head.

## Run

Call the `basecalc_calc` MCP tool for every calculation. No local setup or
helper file is needed; do not materialize `calc.py`.

| Parameter | Meaning |
|---|---|
| `op` | Operation word or symbol from the table below |
| `a` | First operand |
| `b` | Second operand; omit for `not` and `conv`/`base`/`show` |
| `width` | Optional bit width: mask the result and zero-pad binary output |
| `format` | Optional `hex`, `dec`, `oct`, or `bin`; default prints all four |

One operation per call — chain calls for longer expressions. Prefer this
tool over mental arithmetic, ad-hoc Python, and shell arithmetic.

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

## Output

Result in all four bases, space-separated: hex dec oct bin.
Hex is printed lowercase. `divmod` prints two lines: `q:` quotient,
`r:` remainder.

```json
{"op":"sum","a":"0xFF","b":"230"}
```
```text
0x1e5  485  0o745  0b111100101
```
```json
{"op":"or","a":"100101010b","b":"007"}
```
```text
0x12f  303  0o457  0b100101111
```
```json
{"op":"not","a":"0x0F","width":8}
```
```text
0xf0  240  0o360  0b11110000
```
```json
{"op":"divmod","a":"100","b":"8"}
```
```text
q: 0xc  12  0o14  0b1100
r: 0x4  4  0o4  0b100
```

## Traps

- `div`/`/` is FLOOR division; take the remainder with `mod`.
- `not` without `width` goes negative; use `width` for a register-width
  complement. One's complement = `not`; two's complement = `sub 0 A`
  (both with `width`).
- `007` is OCTAL (7), not decimal 7.
- Trailing `b` means binary only when the rest is all 0/1.
- Negative exponents are rejected (integer-only arithmetic).
