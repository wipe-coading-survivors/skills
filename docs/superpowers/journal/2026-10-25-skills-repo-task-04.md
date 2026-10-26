# Журнал: Task 4 — Рендер, Makefile, containerfile, smoke

План: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 4.
Бриф: `.superpowers/sdd/2026-10-25-skills-repo/task-4-brief.md` (совпадает с
планом дословно, сверено). Рабочая ветка: `plan/skills-repo`.

Окружение: node v22.22.2, GNU Make 4.4.1, `/run/.containerenv` существует →
CRE=podman-remote (клиент 5.8.2 / сервер 5.8.9, `which podman` — нет, только
`/usr/bin/podman-remote`).

Решения контроллера: (1) семантика render.sh закреплена в Interfaces;
(2) test-render.sh — TAP, стиль test-no-sensitive.sh; (3) smoke — JSON-RPC
initialize + tools/list через `$(CRE) run --rm -i`, grep по трём маркерам;
(4) журнал коммитится вместе с задачей; (5) окруженческий сбой → BLOCKED
с точным эрром, без обходных путей; (6) закреплённая строка,
неудовлетворимая как написана → STOP + NEEDS_CONTEXT, не ослаблять.

## Окружение (read-only проверки)

- `podman-remote image exists node:22-alpine` → 1 (образа нет);
  `podman-remote pull node:22-alpine` → OK, digest
  `ae59e999…` (сеть к docker.io работает, базовый образ закэширован).

## Шаг 1: RED

Фикстура `test/fixtures-render/skills/alpha/SKILL.md` (frontmatter +
`host: @FOO@` + `bmc: @BAR@`). `scripts/test-render.sh` (TAP: set -eu,
ok/ko-счётчики, `# pass=N fail=M`, `[ "$fail" -eq 0 ]`; локальные
local.mk в `mktemp -d`; фикстура с `@NOPE@` строится в tmp на лету — в
Files брифа закреплён только alpha).

```sh
sh scripts/test-render.sh   # exit=1
```

```
not ok - substitutes := and = forms, no placeholders left
  expected: render.sh exit 0
  actual:   exit 127; stderr: scripts/render.sh: No such file or directory
not ok - unset placeholder -> exit != 0
  expected: non-zero exit, stderr names NOPE
  actual:   exit 127; stderr: scripts/render.sh: No such file or directory
not ok - empty value -> exit != 0
  expected: non-zero exit, stderr contains 'empty value: FOO'
  actual:   exit 127; stderr: scripts/render.sh: No such file or directory
# pass=0 fail=3
```

Ожидаемо: render.sh ещё нет (exit 127 по всем трём).

## Шаг 2: render.sh → GREEN

`scripts/render.sh` (POSIX sh, `set -eu`, `LC_ALL=C`):
- аргументы `<src> <dst> [local.mk]`; local.mk по умолчанию —
  `<repo>/local.mk` (repo_root из `dirname $0`/.., как в
  test-no-sensitive.sh);
- гварды: src — каталог; dst не существует (иначе exit 1
  `dst already exists`); local.mk — файл;
- разбор local.mk: `VAR := v` / `VAR = v`, пропуск комментариев/пустых,
  имена только `[A-Z][A-Z0-9_]*`, пустое значение → exit 1
  `empty value: VAR`;
- sed-скрипт в `mktemp -d` (значения экранированы под sed: `\`, `&`, `/`);
  `cp -a src→dst`; `sed -f` по всем файлам (tmp + `mv`, без rm);
- финальный `grep -RnE '@[A-Z][A-Z0-9_]*@'` по dst → остаток → exit 1 со
  списком distinct-токенов в stderr.

Помимо того: `chmod +x scripts/render.sh scripts/test-render.sh` — тест
вызывает `scripts/render.sh` напрямую (без exec-бита — Permission denied,
exit 126).

Первый прогон GREEN упал по тесту 1 — моя же ошибка в тесте: ждал
`$out/skills/alpha/SKILL.md`, а `cp -a src dst` при несуществующем dst
создаёт dst как КОПИЮ src → реально `$out/alpha/SKILL.md`. Именнование
исправил в тесте, не в реализации: семантика «dst = отрендеренное дерево»
— ровно то, что нужно рецепту `render.sh skills $$CTX/skills`
(`$$CTX/skills/{пять скиллов}`).

```sh
sh scripts/test-render.sh   # exit=0
ok - substitutes := and = forms, no placeholders left
ok - unset placeholder -> exit != 0, stderr names NOPE
ok - empty value -> exit != 0, stderr: empty value: FOO
# pass=3 fail=0
```

Ручные проверки интерфейса (вне TAP-трёшки):
- dst существует → exit 1, `render: dst already exists: …`;
- без 3-го аргумента → local.mk резолвится в `<repo>/local.mk` (6
  IPMI-переменных; @FOO@/@BAR@ фикстуры не подставлены → список остатков,
  exit 1);
- реальное дерево: `scripts/render.sh skills $tmp/skills` → exit 0,
  остатков `@IPMI_*@` — 0, реальные IP подставлены (10.241.x, 10.251.x,
  10.58.x), артефактов `*.rendered` нет.

## Шаги 3+4: containerfile + Makefile

Оба файла — дословно закреплённые блоки брифа (Makefile — с табами;
`node --test "server/test/**/*.test.mjs"` в GLOB-форме). CRE-авто:
`make -n build` → `podman-remote build -f containerfile -t skills-mcp:local $CTX`
(детект `/run/.containerenv` работает).

## Шаг 5: build + smoke + test — ДВЕ дефекта закреплённого контента

**Дефект A (`make test` — no-op).**

```sh
make test
# make: 'test' is up to date.   (exit 0, ни один гейт не прогнан)
```

Причина: цель `test:` без прецедентов, а в репо существует каталог
`test/` — создаётся собственной фикстурой этой же задачи
(`test/fixtures-render/`, закреплён в Files и в commit-листе). Make
считает цель «up to date» и рецепт не исполняет. Закреплённый Expected
«все PASS» недостижим как написано.

Верификация фикса (scratch-копия репо в /tmp/opencode/skills-verify,
`cp -a`; добавлена ОДНА строка `.PHONY: build test smoke run-http` в
начало, все закреплённые строки не тронуты):

```sh
make test   # exit=0
# node --test: 24/24 pass (tests 24, pass 24, fail 0)
# test-no-sensitive.sh: # pass=7 fail=0
# test-render.sh:       # pass=3 fail=0
```

**Дефект B (`make build` — падает на закреплённом COPY).**

```sh
make build
STEP 1/6: FROM node:22-alpine
STEP 2/6: WORKDIR /app
STEP 3/6: COPY server.mjs server/server.mjs
Error: building at STEP "COPY server.mjs server/server.mjs": checking on
sources under "/var/tmp/libpod_builder2967817588/build": copier: stat:
"/server.mjs": no such file or directory
make: *** [Makefile:10: build] Error 125
```

Причина: закреплённый рецепт build кладёт server.mjs в
`$$CTX/server/server.mjs` (в корне контекста `server.mjs` НЕТ), а
закреплённый containerfile требует `COPY server.mjs …` (источник — корень
контекста). Блок containerfile и блок Makefile брифа несовместимы;
закреплённые Expected «образ создан»/`smoke-ok` недостижимы как написано.
Семантика подтверждена отдельным scratch-сборкой (FROM scratch + та же
COPY-строка, контекст с одним `server/server.mjs`) — тот же error.

Отдельно: относительные `.build/ctx-*` пути сработали (сборка дошла до
COPY — контекст ушёл корректно из CWD=корень репо) → отклонение
`$(CURDIR)` в этом окружении НЕ требуется.

## Статус

Шаги 1–4 выполнены, файлы НЕ закоммичены (commit — шаг 6, после
ратификации). Шаг 5 блокирован двумя дефектами закреплённого контента.
По решению контроллера 6 — STOP + NEEDS_CONTEXT. Предлагаемые минимальные
фиксы (на ратификацию):
1. containerfile строка 4: `COPY server.mjs server/server.mjs` →
   `COPY server/server.mjs server/server.mjs` (dest и CMD не меняются,
   раскладка 1:1 с чекаутом сохранена);
2. Makefile: добавить строку `.PHONY: build test smoke run-http`
   (все закреплённые строки остаются дословно).

`make smoke` не прогонялся — образ не собирается (дефект B).

## Возобновление: ратификация + owner-решение

Контроллер верифицировал оба дефекта, ратифицировал оба фикса, добавил
owner-решение. План/спека обновлены (docs-коммит be3f661). Применено в
рабочем дереве:
1. containerfile строка 4: `COPY server/server.mjs server/server.mjs`
   (фикс дефекта B, ратифицирован);
2. Makefile: строка `.PHONY: build test smoke run-http` после
   `IMAGE ?= skills-mcp:local` (фикс дефекта A, ратифицирован);
3. containerfile строка 1: `FROM node:22-alpine` →
   `FROM quay.io/fedora/nodejs-22:latest` (OWNER DECISION; контроллер
   верифицировал образ: Fedora 44, `/usr/bin/node` v22.23.1, `/bin/sh`
   есть; образ уже в podman-remote store — pull не нужен).

### build — OK

`make build` → exit 0, все 6 STEP, `COMMIT skills-mcp:local` →
`5b37bbb9785d`, `Successfully tagged localhost/skills-mcp:local`;
`podman-remote image exists skills-mcp:local` → 0 (yes).

### smoke — ПРОВАЛ: дефект C (закреплённый grep не совпадает с
каноническим именем инструмента)

`make smoke` → build-часть из кэша (OK), затем
`make: *** [Makefile:23: smoke] Error 1` (рецепт `@` — вывод shell
подавлен, падает grep-цепочка).

Ручная репродукция того же пайплайна:

```
printf '{"jsonrpc":"2.0","id":1,...initialize...}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' \
  | podman-remote run --rm -i skills-mcp:local
→ run-exit=0; stdout — чистые JSON-RPC-ответы (4421 байт), stderr пуст
```

Изоляция grep-цепочки по захваченному stdout:
- `grep -q '"name":"skills"'` → PASS (serverInfo.name);
- `grep -q 'list_skills'` → PASS;
- `grep -q 'mellanox_flash_docs'` → **FAIL**;
- фактический инструмент: `mellanox_flash_ops_docs`
  (`grep -o 'mellanox_flash[a-z_]*docs'` → `mellanox_flash_ops_docs`).

Корневая причина: каноническое именование инструментов
(`server/server.mjs:99`: `s.name.replace(/-/g, "_") + "_docs"`,
закреплено и протестировано в Task 2) для каталога скилла
`mellanox-flash-ops` даёт `mellanox_flash_ops_docs`; закреплённая
строка grep `mellanox_flash_docs` (plan строка 295; spec строки 162,
318, 325 — там же сокращённое имя) не совпадает ни с одним
инструментом. Stdio-passthrough сам по себе работает (run-exit=0,
все 5 отрендеренных скиллов в tools/list) — Review Focus 5
фактически покрыт, падает только закреплённый grep-маркер.

### test — OK (после .PHONY)

```
make test → exit 0
node --test "server/test/**/*.test.mjs"  → # tests 24 / pass 24 / fail 0
sh scripts/test-no-sensitive.sh          → # pass=7 fail=0
sh scripts/test-render.sh                → # pass=3 fail=0
```

(строки `warning: skipping non-skill directory … notaskill` — ожидаемый
stderr fixture-теста Task 2.)

## Статус (после возобновления)

Дефекты A, B устранены (ратифицированные фиксы), build и test зелёные.
Дефект C (smoke grep) — закреплённая строка неудовлетворима как
написана → по решению 6 STOP + NEEDS_CONTEXT; предлагаемый фикс —
grep-маркер `mellanox_flash_docs` → `mellanox_flash_ops_docs`
(интент «в образе есть отрендеренный mellanox-flash-ops» сохраняется).
Commit (шаг 6) НЕ сделан — smoke-гейт не зелёный.

## Финальный прогон: ратификация фикса дефекта C

Контроллер верифицировал дефект C и ратифицировал one-token фикс
(plan/spec — docs-коммит 19ced0a). Применено в Makefile (smoke,
строка 3): `grep -q 'mellanox_flash_docs'` →
`grep -q 'mellanox_flash_ops_docs'`; остальное в Makefile не тронуто.

```
make smoke  → exit 0, вывод: smoke-ok
            (build-часть из кэша, образ 5b37bbb9785d; stdio -i
            passthrough через podman-remote — Review Focus 5 покрыт)

make test   → exit 0
node --test "server/test/**/*.test.mjs"  → # tests 24 / pass 24 / fail 0
sh scripts/test-no-sensitive.sh          → # pass=7 fail=0
sh scripts/test-render.sh                → # pass=3 fail=0
```

Перед коммитом — проверка журнала (будет tracked) на чувствительные
значения по тем же правилам, что test-no-sensitive.sh (fixed-string по
значениям local.mk + generic private-IP regex): чист.

Шаг 6: commit — `git add scripts/render.sh scripts/test-render.sh
containerfile Makefile test/fixtures-render` + журнал; сообщение по
брифу.
