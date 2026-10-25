#!/usr/bin/env python3
"""Arithmetic and bitwise ops on hex/dec/oct/bin operands + base conversion.

Usage (one operation per invocation; chain calls for longer expressions):
  calc.py [-w N] [-f BASE] OP A B      word op:  calc.py sum 0xFF 230
  calc.py [-w N] [-f BASE] A SYM B     infix:    calc.py 0xff - 0x10
  calc.py [-w N] [-f BASE] not A       bitwise NOT (pair with -w N)
  calc.py [-w N] [-f BASE] conv A      show A in all four bases
  calc.py [-w N] [-f BASE] divmod A B  quotient + remainder (q:/r: lines)
  calc.py --selftest

Operand bases (checked in order): 0x.. hex, 0o.. oct, 0b.. bin,
..b with rest 0/1 (100101010b) bin, leading 0 and len>1 (007) oct,
otherwise dec. '-' prefix and '_' separators allowed.
"""
import contextlib
import io
import sys

def _pow(a, b):
    if b < 0:
        raise ValueError("negative exponent not supported (integers only)")
    return a ** b


OPS = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": lambda a, b: a // b,
    "//": lambda a, b: a // b,
    "%": lambda a, b: a % b,
    "**": _pow,
    "&": lambda a, b: a & b,
    "|": lambda a, b: a | b,
    "^": lambda a, b: a ^ b,
    "<<": lambda a, b: a << b,
    ">>": lambda a, b: a >> b,
}

WORDS = {
    "sum": "+",
    "add": "+",
    "sub": "-",
    "minus": "-",
    "diff": "-",
    "mul": "*",
    "mult": "*",
    "div": "/",
    "mod": "%",
    "pow": "**",
    "power": "**",
    "and": "&",
    "or": "|",
    "xor": "^",
    "shl": "<<",
    "lsh": "<<",
    "shr": ">>",
    "rsh": ">>",
}

CONV_WORDS = {"conv", "base", "show"}

USAGE = __doc__


def die(msg, rc=1):
    print("calc: %s" % msg, file=sys.stderr)
    sys.exit(rc)


def parse(s):
    s = s.strip()
    neg = False
    if s and s[0] in "+-":
        neg = s[0] == "-"
        s = s[1:]
    if not s:
        raise ValueError("empty operand")
    low = s.lower()
    if low.startswith("0x"):
        v = int(s, 16)
    elif low.startswith("0o"):
        v = int(s, 8)
    elif low.startswith("0b"):
        v = int(s, 2)
    elif len(s) > 1 and low.endswith("b") and all(c in "01" for c in s[:-1]):
        v = int(s[:-1], 2)
    elif len(s) > 1 and s[0] == "0":
        v = int(s, 8)
    else:
        v = int(s, 10)
    return -v if neg else v


def pos(v, base, bits):
    if base == "hex":
        return hex(v)
    if base == "dec":
        return str(v)
    if base == "oct":
        return "0o" + format(v, "o")
    if bits is not None:
        return "0b" + format(v, "0%db" % bits)
    return bin(v)


def render(v, bits, one):
    if bits is not None:
        v &= (1 << bits) - 1
    if one is not None:
        if one not in ("hex", "dec", "oct", "bin"):
            die("bad -f base: %s (hex|dec|oct|bin)" % one, 2)
        order = (one,)
    else:
        order = ("hex", "dec", "oct", "bin")
    parts = []
    for base in order:
        parts.append("-" + pos(-v, base, bits) if v < 0 else pos(v, base, bits))
    return "  ".join(parts)


def compute(args):
    if not args:
        die("nothing to do\n\n" + USAGE, 2)
    head = args[0].lower()
    if head in WORDS:
        if len(args) != 3:
            die("usage: calc %s A B" % head, 2)
        return OPS[WORDS[head]](parse(args[1]), parse(args[2]))
    if head in CONV_WORDS:
        if len(args) != 2:
            die("usage: calc %s A" % head, 2)
        return parse(args[1])
    if head == "not":
        if len(args) != 2:
            die("usage: calc not A", 2)
        return ~parse(args[1])
    if head == "divmod":
        if len(args) != 3:
            die("usage: calc divmod A B", 2)
        a, b = parse(args[1]), parse(args[2])
        return ("divmod", a // b, a % b)
    if len(args) != 3:
        die(
            "usage: calc OP A B | calc A SYM B | calc not A | calc conv A "
            "| calc divmod A B\n"
            "ops: symbols %s, words %s, plus: not, conv, divmod\n\n%s"
            % (" ".join(OPS), " ".join(sorted(set(WORDS))), USAGE),
            2,
        )
    sym = args[1]
    if sym not in OPS:
        die(
            "unknown op: %s\nsymbols: %s\nwords: %s, plus: not, conv, divmod"
            % (sym, " ".join(OPS), " ".join(sorted(set(WORDS))))
        )
    return OPS[sym](parse(args[0]), parse(args[2]))


def evaluate(args, bits, one):
    try:
        v = compute(args)
    except ZeroDivisionError:
        die("division by zero")
    except ValueError as e:
        die("bad operand or value: %s" % e)
    if isinstance(v, tuple):
        _, q, r = v
        return "q: %s\nr: %s" % (render(q, bits, one), render(r, bits, one))
    return render(v, bits, one)


def split_flags(argv):
    bits = None
    one = None
    args = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--selftest":
            return None, None, ["--selftest"]
        if a == "-w":
            if i + 1 >= len(argv):
                die("-w needs a value", 2)
            try:
                bits = int(argv[i + 1])
            except ValueError:
                die("bad -w value: %s" % argv[i + 1], 2)
            i += 2
            continue
        if a.startswith("-w") and len(a) > 2:
            try:
                bits = int(a[2:])
            except ValueError:
                die("bad -w value: %s" % a, 2)
            i += 1
            continue
        if a in ("-f", "--format"):
            if i + 1 >= len(argv):
                die("-f needs a value", 2)
            one = argv[i + 1].lower()
            i += 2
            continue
        if a.startswith("-f="):
            one = a[3:].lower()
            i += 1
            continue
        args.append(a)
        i += 1
    if bits is not None and bits <= 0:
        die("-w must be positive", 2)
    return bits, one, args


def main(argv):
    bits, one, args = split_flags(argv)
    if args == ["--selftest"]:
        return selftest()
    print(evaluate(args, bits, one))
    return 0


CASES = [
    ([], ["sum", "0xFF", "230"], "0x1e5  485  0o745  0b111100101"),
    ([], ["0xff", "-", "0x10"], "0xef  239  0o357  0b11101111"),
    ([], ["and", "100", "200"], "0x40  64  0o100  0b1000000"),
    ([], ["or", "100101010b", "007"], "0x12f  303  0o457  0b100101111"),
    ([], ["conv", "0xFF"], "0xff  255  0o377  0b11111111"),
    ([], ["div", "485", "16"], "0x1e  30  0o36  0b11110"),
    ([], ["mod", "0xFF", "16"], "0xf  15  0o17  0b1111"),
    ([], ["pow", "2", "8"], "0x100  256  0o400  0b100000000"),
    (["-w", "8"], ["not", "0x0F"], "0xf0  240  0o360  0b11110000"),
    ([], ["not", "5"], "-0x6  -6  -0o6  -0b110"),
    ([], ["shl", "1", "4"], "0x10  16  0o20  0b10000"),
    ([], ["shr", "0xFF", "4"], "0xf  15  0o17  0b1111"),
    ([], ["xor", "0xFF", "0x0F"], "0xf0  240  0o360  0b11110000"),
    ([], ["sub", "0x10", "0x20"], "-0x10  -16  -0o20  -0b10000"),
    ([], ["0x100", "-", "255"], "0x1  1  0o1  0b1"),
    ([], ["0x1F", "*", "16"], "0x1f0  496  0o760  0b111110000"),
    ([], ["101", "&", "0b10000000"], "0x0  0  0o0  0b0"),
    ([], ["sum", "0xFF_FF", "1"], "0x10000  65536  0o200000  0b10000000000000000"),
    (["-f", "hex"], ["sum", "0xFF", "1"], "0x100"),
    (["-w", "16"], ["conv", "0xFF"], "0xff  255  0o377  0b0000000011111111"),
    (["-w", "4"], ["mod", "250", "15"], "0xa  10  0o12  0b1010"),
    (["-w", "32"], ["sub", "0", "1"], "0xffffffff  4294967295  0o37777777777  0b11111111111111111111111111111111"),
    ([], ["divmod", "100", "8"], "q: 0xc  12  0o14  0b1100\nr: 0x4  4  0o4  0b100"),
    (["-f", "hex"], ["divmod", "0x100", "16"], "q: 0x10\nr: 0x0"),
    (["-w", "8"], ["divmod", "255", "8"], "q: 0x1f  31  0o37  0b00011111\nr: 0x7  7  0o7  0b00000111"),
]

BAD = [
    ["sum", "0x", "1"],
    ["sum", "12x", "1"],
    ["sum", "0xG1", "1"],
    ["div", "1", "0"],
    ["sum", "1", "2", "3"],
    ["pow", "0x10", "-1"],
    ["divmod", "1", "0"],
]


def selftest():
    fails = 0
    for extra, args, expected in CASES:
        bits, one, _ = split_flags(extra)
        try:
            got = evaluate(args, bits, one)
        except BaseException as e:
            fails += 1
            print("FAIL %s %s: %r" % (" ".join(extra), " ".join(args), e))
            continue
        if got != expected:
            fails += 1
            print(
                "FAIL %s %s\n  got      %s\n  expected %s"
                % (" ".join(extra), " ".join(args), got, expected)
            )
    for args in BAD:
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                evaluate(args, None, None)
        except SystemExit as e:
            if e.code in (1, 2):
                continue
        fails += 1
        print("FAIL (should error): %s" % " ".join(args))
    if fails:
        print("selftest: %d FAILED" % fails)
        return 1
    print("selftest: %d ok" % (len(CASES) + len(BAD)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
