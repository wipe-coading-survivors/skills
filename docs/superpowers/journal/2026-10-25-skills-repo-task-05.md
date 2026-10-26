# Журнал: Task 5 — install.sh и патчер opencode.jsonc

План: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 5.
Бриф: `.superpowers/sdd/2026-10-25-skills-repo/task-5-brief.md` (совпадает с
планом; закреплённые элементы сверены по брифу). Рабочая ветка:
`plan/skills-repo`.

Окружение: node v22.22.2, `/run/.containerenv` существует → CRE=podman-remote
(как в Task 4). В пути к репо символических ссылок нет (проверено `ls -ld`
по компонентам) — main-guard сравнение `pathToFileURL(process.argv[1])`
корректно (та же конструкция в server.mjs, stdio/http-тесты спавнят сервер
так же).

Решения контроллера: (1) install.sh в этой задаче проверяется только `sh -n`
(живой прогон — Task 6); (2) patch-mcp-config.mjs — ESM с main-guard
(`pathToFileURL(process.argv[1])`, как в server.mjs); (3) `set` идемпотентен
(entry перезаписывается); (4) журнал коммитится вместе с задачей; (5)
закреплённое утверждение, неудовлетворимое как написано → STOP +
NEEDS_CONTEXT.

## Шаг 1: Фикстура + failing-тест (RED)

`scripts/test/fixtures/config.jsonc` — закреплённый набор: `//`-комментарий,
`/* */`-комментарий, `"url": "https://mcp.context7.com/mcp"` (URL с `//`),
trailing comma, чужие топовые ключи `mcp1`, `plugin: []`; ключа `mcp` нет.

`scripts/test/patch-mcp-config.test.mjs` — 4 теста на 4 закреплённых
поведения: (1) `set` — `mcp.servers.skills` с точным entry, URL цел, чужие
ключи сохранены, результат ре-парсится (плюс выравнивание на нормализованный
JSON indent 2 — закреплённый формат вывода); (2) `set` дважды → entry
перезаписан; (3) `remove` → топовый ключ убрался, остальное на месте;
(4) `parseJsonc`: фикстура (комментарии + URL + trailing comma) парсится,
плюс явный trailing comma `{"a": 1, "b": [2, 3,],}`. Тесты 1–3 запускают
CLI через `execFileSync(process.execPath, [script, ...])` (проверяется
интерфейс целиком, файл переписывается in place); тест 4 импортит
`parseJsonc` (закреплённое имя экспорта для Task 6). Тmp-копии фикстуры —
`fs.mkdtempSync` (node-тест, не shell-скрипт — правило про mktemp/rm к нему
не прилагается).

```sh
node --test scripts/test/patch-mcp-config.test.mjs   # exit=1
```

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'…/skills/scripts/patch-mcp-config.mjs' imported from
'…/skills/scripts/test/patch-mcp-config.test.mjs'
not ok 1 - scripts/test/patch-mcp-config.test.mjs
1..1
# tests 1
# pass 0
# fail 1
```

Ожидаемо: модуль ещё не создан.

## Шаг 2: patch-mcp-config.mjs → GREEN

`scripts/patch-mcp-config.mjs` (ESM, только `node:` builtins):

- `parseJsonc(text)` — один проход, малая state machine:
  - строки escape-aware: `\"` не закрывает строку, `//` внутри строки
    (URL) — не комментарий;
  - `//` и `/* */` вырезаются (переносы строк сохраняются — позиции в
    ошибках JSON.parse маппятся на вход);
  - запятая, следующий значимый символ которой (мимо пробельных и
    комментариев) — `}`/`]`, вырезается (trailing comma). Запятая
    внутри строки не затрагивается (машина в состоянии inString);
  - в конце: unterminated string/comment → явная ошибка; остальное —
    `JSON.parse`.
- CLI: `set <config.jsonc> <server-name> <json-entry>` — json-entry
  валидируется как JSON-объект; `mcp`/`mcp.servers` создаются при
  отсутствии, существующие не-объекты под этими ключами → ошибка;
  `mcp.servers[name] = entry`; запись in place, `JSON.stringify(…, null, 2)
  + "\n"`. `remove <config.jsonc> <top-level-key>` — ключ отсутствует →
  ошибка `top-level key not found`. Ошибки: `config not found`,
  `config is not valid JSONC: …`, `json-entry is not a JSON value: …`;
  usage → exit 2.
- main-guard: `import.meta.url === pathToFileURL(process.argv[1]).href`
  (как в server.mjs:345).

Отклонение от server.mjs (минимальное, по зафиксированному случаю
использования): перед сравнением добавлен `process.argv[1] &&` — при
`node -e 'import("…")'` argv[1] undefined, и `pathToFileURL(undefined)`
бросает TypeError прямо при оценке гварда (воспроизведено:
ERR_INVALID_ARG_TYPE). Task 6 импортит `parseJsonc` node one-liner'ом —
без гварда модуль было бы невозможно вообще импортить из `node -e`.
Сравнение при этом дословно закреплённое.

```sh
node --test scripts/test/patch-mcp-config.test.mjs   # exit=0
ok 1 - set: creates mcp.servers.skills with the exact entry, …
ok 2 - set twice: entry replaced (idempotent), rest preserved
ok 3 - remove: top-level key gone, rest intact
ok 4 - parseJsonc: comments, URL with //, trailing comma in input parse
1..4
# tests 4 / pass 4 / fail 0
```

Ручные проверки (вне 4 тестов):
- unknown subcommand → usage в stderr, exit 2;
- `set … 'not-json'` → `json-entry is not a JSON value: …`, exit 1;
- `set` на несуществующий файл → `config not found: …`, exit 1;
- `remove` несуществующего ключа → `top-level key not found: nope`, exit 1;
- `node -e` импорт после фикса гварда → ок, `parseJsonc` — function;
  `parseJsonc('{"a": "x \" // y",}')` → `{"a":"x \" // y"}`
  (экранированная кавычка + `//` в строке + trailing comma).

## Шаг 3: install.sh

`scripts/install.sh` (POSIX sh, `set -eu`, `chmod +x`), шаги дословно по
закреплению брифа:

1. prechecks: `command -v node`, `command -v git`, CRE-авто
   (`/run/.containerenv` → podman-remote, иначе podman — логика как в
   Makefile, имя инструмента не хардкодится в одном месте; плюс
   `command -v "$CRE"` с actionable-ошибкой), `[ -f local.mk ]`,
   `[ -f $HOME/.config/opencode/opencode.jsonc ]`; затем `make build`.
2. `for dir in skills/*/`: target `$HOME/.config/opencode/skills/<name>`,
   `mkdir -p`; плейсхолдеры — `grep -qE '@[A-Z][A-Z0-9_]*@'` по SKILL.md
   (тот же паттерн, что финальная проверка render.sh); abort-условие
   (до-миграционное состояние): has_ph=0 и target/SKILL.md — обычный файл
   (`-f` и не `-L`) без `.rendered` → die с подсказкой про одноразовую
   миграцию (mv в .bak + повтор). С плейсхолдерами:
   `tmp=$(mktemp -d); mkdir -p $tmp/skills; cp -a skills/<name>
   $tmp/skills/<name>; scripts/render.sh $tmp/skills $tmp/out` (dst
   render.sh — `$tmp/out`, не существует — ок); `cp $tmp/out/<name>/SKILL.md
   target/`, `touch target/.rendered`, `md5sum target/SKILL.md`.
   Без плейсхолдеров: `ln -sf $repo_root/skills/<name>/SKILL.md
   target/SKILL.md`.
3. entry: `SKILLS_MCP_URL` задан → remote `{"type":"remote","url":"$SKILLS_MCP_URL"}`,
   иначе local `{"type":"local","command":["$CRE","run","--rm","-i","skills-mcp:local"]}`;
   `node scripts/patch-mcp-config.mjs set "$config" skills "$entry"`.
4. `make smoke`.

`rm` отсутствует; mktemp-рабочие области оставляются (правило репо).

```sh
sh -n scripts/install.sh   # syntax OK (exit 0)
```

shellcheck в окружении не установлен. Живой прогон — Task 6 (решение 1).

## Шаг 4: Makefile + make test + commit

Makefile, цель `test`: строка `node --test "server/test/**/*.test.mjs"`
заменена на `node --test "server/test/**/*.test.mjs"
"scripts/test/**/*.test.mjs"` (закреплённая замена, GLOB-форма).

```sh
make test   # exit=0
node --test …  → # tests 28 / pass 28 / fail 0 (24 прежних + 4 новых)
sh scripts/test-no-sensitive.sh  → # pass=7 fail=0
sh scripts/test-render.sh        → # pass=3 fail=0
```

(строки `warning: skipping non-skill directory … notaskill` — ожидаемый
stderr fixture-теста Task 2, как в журнале Task 4.)

Перед коммитом: git status — в staged только `scripts` (patch-mcp-config.mjs,
install.sh, test/patch-mcp-config.test.mjs, test/fixtures/config.jsonc),
`Makefile` и журнал; чувствительных значений в новых tracked-файлах нет
(URL-фикстура — публичный домен, без IP; значения local.mk в журнал не
вносились). Commit по шагу брифа:
`feat: host install — JSONC mcp-config patcher, install.sh (symlink/render/smoke)`.

## Возобновление: фиксы по ревью (3 замечания, контроллером верифицированы)

Бриф регенерирован (docs-коммит 36aac85) — теперь он и есть спека.
Применено:

1. **Clobber через stale symlink (important).** Закреплённая строка
   `cp $tmp/out/<name>/SKILL.md target/` при target/SKILL.md, являющемся
   symlink'ом (скилл раньше ставился без плейсхолдеров, плейсхолдеры
   добавлены позже, install перезапущен), следует по ссылке и переписывает
   tracked-файл репо `skills/<name>/SKILL.md` отрендеренным содержимым.
   Фикс по регенерированному брифу — stage+rename:
   `cp $tmp/out/<name>/SKILL.md target/SKILL.md.new && mv
   target/SKILL.md.new target/SKILL.md` (rename заменяет сам symlink, rm
   не требуется). `mkdir -p $tmp/skills` в render-пути уже был.
2. **CRE `?=`-семантика (minor).** Как в Makefile: экспортированный `CRE`
   уважается, иначе автоопределение (`/run/.containerenv` →
   podman-remote, иначе podman): `if [ -z "${CRE:-}" ]; then … fi`.
3. **readConfig: раздельные ошибки (minor).** ENOENT → `config not found:
   <path>`; прочие коды (EACCES, EISDIR, …) → `cannot read config
   <path>: <e.code ?? e.message>`.

### Scratch-верификация clobber-фикса (/tmp, не в репо)

Первая попытка воспроизведения OLD-поведения НЕ показала clobber — моя
ошибка: источник копировался под именем `rendered.md`, и `cp src target/`
создавал НОВЫЙ файл `target/rendered.md`, не трогая `target/SKILL.md`.
Clobber зависит от basename: в install.sh источник —
`$tmp/out/<name>/SKILL.md`, и dest-путь совпадает со stale symlink.
Повтор с basename `SKILL.md` (изолированные деревья, `mktemp -d`):

```
== OLD: cp $tmp/out/demo/SKILL.md target/ ==
old repo file now: [rendered content]
old target: still-symlink content=[rendered content]
```

→ clobber подтверждён: содержимое «repo-файла» заменено rendered-контентом
(в реальной установке — подставленными значениями local.mk в tracked-файл).

```
== NEW: stage+rename, symlink target ==
A: repo file unchanged (md5 f0e17f81a2b9a363ca9606848f197031  -)
B: target is now a regular file, content=[rendered content]
C: plain-file target replaced, content=[rendered content]
D: skipped (/dev/shm same fs as /tmp)
```

A — repo-файл byte-идентичен (md5 до/после равны); B — target теперь
обычный файл (`test -f` и `! test -L`) с rendered-контентом; C — тот же
stage+rename для обычного файла target. D (cross-device, EXDEV-фолбэк mv)
не прогонялся — в окружении нет второй ФС (/dev/shm и /tmp на одном
fs); семантика rename(2) на пути-symlink заменяет саму ссылку и в
same-device, и в copy+rename-фолбэке (rename временного файла в каталоге
target), т.е. fallback-путь не отличается.

### Проверяющие прогоны

```
sh -n scripts/install.sh   # exit 0
node scripts/patch-mcp-config.mjs set <tmp>/missing.jsonc skills '{}'
  → patch-mcp-config: config not found: …  (exit 1)
node scripts/patch-mcp-config.mjs set <tmp-dir> skills '{}'
  → patch-mcp-config: cannot read config <tmp-dir>: EISDIR  (exit 1)
node --test "scripts/test/**/*.test.mjs"  → # tests 4 / pass 4 / fail 0
make test  → exit 0
  node --test …  → # tests 28 / pass 28 / fail 0
  test-no-sensitive.sh → # pass=7 fail=0
  test-render.sh       → # pass=3 fail=0
```

### Commit

Amend локального 9741593 (remote отсутствует — безопасно), сообщение
неизменно. Staged ровно: `scripts/install.sh`,
`scripts/patch-mcp-config.mjs`, обновлённый журнал (журналы коммитятся
вместе с задачей).
