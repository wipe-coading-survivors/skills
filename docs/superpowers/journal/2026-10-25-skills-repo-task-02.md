# Журнал: Task 2 — MCP-сервер: ядро (discovery, tools, stdio)

План: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 2.
Бриф: `.superpowers/sdd/2026-10-25-skills-repo/task-2-brief.md`.
Рабочая ветка: `plan/skills-repo`. Node v22.22.2, ESM, только `node:` builtins.
Прототип: `docs/reference/mellanox-flash-ops-prototype.mjs` (stdio JSON-RPC-цикл,
`sections()`, `err()`).

## Pre-check

- Литеральные description (res. 2): извлечены из
  `~/.config/opencode/skills/{mellanox-flash-ops,basecalc}/SKILL.md`
  (`cat -A` — без trailing whitespace, эм-дэши U+2014), скопированы в
  `server/test/frontmatter.test.mjs` как JS-литералы. Верификация
  node-скриптом (строка description из источника как вербатим-подстрока
  тест-файла): mfx `true`, basecalc `true`. В рантайме тест файлы вне репо
  не читает.
- local.mk: 6 значений IPMI_* (172.16/172.17) — в контент задачи не
  попадают (см. доп. проверку ниже).

## Шаг 1: фикстуры

- `alpha/SKILL.md` (frontmatter `name: alpha`, description с двоеточием и
  эм-дэшем; тело `# Alpha`, `## One`, `## Two`), `beta/SKILL.md` (`name: beta`,
  `## Only`), `notaskill/readme.txt`.
- `alpha/tool.txt` — ровно `hello tool` **без** финального newline
  (`printf 'hello tool'`), чтобы `assert.equal(text, "hello tool")` шло
  точным равенством; `od -c` проверено.
- `alpha/blob.bin` (res. 1 — создавать) — `printf 'bin\x00ary data\x00'`,
  NUL-байты подтверждены `od -c`.

## Шаг 2: RED — frontmatter

```sh
node --test server/test/frontmatter.test.mjs   # exit=1
```

FAIL: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../server/server.mjs'` — ожидаемо: модуль ещё не создан (буква брифа:
«модуль server.mjs не найден»).

## Шаг 3: parseFrontmatter / discoverSkills / defaultSkillsDir

`server/server.mjs`:
- frontmatter — блок между первой `---` и следующей `---`, пары `key: value`
  (split по первому `:` — description с двоеточиями не ломаются);
  `body` — остаток после закрывающего `---` с обрезанным leading whitespace
  (тест: `body.startsWith("# ")`).
- discovery: entry со `SKILL.md` → скилл; иначе — подкаталоги с `SKILL.md`;
  нескилловые — пропуск + `warning: skipping non-skill directory: …` в
  stderr. `files` — относительные пути, рекурсивно, отсортированы
  (детерминизм для list_skills/resources).
- `defaultSkillsDir()` — формула из брифа дословно:
  `join(dirname(fileURLToPath(import.meta.url)), "skills")`.

GREEN: `node --test server/test/frontmatter.test.mjs` → 4/4 pass, exit 0.

## Шаг 4: RED — tools

```sh
node --test server/test/tools.test.mjs   # exit=1
```

FAIL: `SyntaxError: The requested module '../server.mjs' does not provide an
export named 'buildResources'` — ожидаемо: buildTools/buildResources/
handleRequest ещё не реализованы (step 5 по TDD).

## Шаг 5: buildTools / buildResources / handleRequest

- `tools/call` — switch по имени; `<snake>_docs` — полный текст SKILL.md или
  секции по `^## ` (case-insensitive substring) — логика `sections()`
  дословно по прототипу; промах — `isError: true` +
  `No section matching "…". Available sections: (preamble) | One | Two`.
- `skill_file` — `resolve(join(dir, path))` + `startsWith(resolve(dir) + sep)`
  (иначе «outside skill dir»); NUL в первых 8К → «binary file not supported»;
  неизвестный скилл → «unknown skill».
- description инструментов — frontmatter description + закреплённый суффикс
  «ALWAYS consult this … (context7, vendor docs) for these topics».
- `initialize` — эхо `protocolVersion` + `serverInfo.name === "skills"`;
  неизвестный method → `-32601`, неизвестный tool → `-32602`.
- `resources/list|read` — `mcp://skills/<name>/SKILL.md`, `text/markdown`.

GREEN: `node --test server/test/tools.test.mjs` → 18/18 pass, exit 0.

## Шаг 6: RED — stdio

```sh
node --test server/test/stdio.test.mjs   # exit=1
```

FAIL: `process exited with code 0 after 0/3 lines` — ожидаемо: `main()` ещё
нет, spawned-процесс грузит модуль и завершается, не читая stdin.

## Шаг 7: main() + полный гейт

- `main()`: `SKILLS_DIRS` (split по `path.delimiter`) || `defaultSkillsDir()`;
  newline-delimited JSON-RPC-цикл по прототипу (буфер строк, skip пустых
  линий/не-JSON/сообщений без `id`, catch → `-32603`, exit 0 на stdin end).
- Main-guard дословно по брифу:
  `if (import.meta.url === pathToFileURL(process.argv[1]).href) main()`.

**Отклонение гейт-команды (важно).** Буква брифа: `node --test server/test`.
На Node v22.22.2 позиционные аргументы `--test` — **glob-паттерны**, а не
каталоги (доки v22, «Running tests from the command line»: «one or more glob
patterns can be provided as the final argument(s)»); каталог воспринимается
как один файл → `Cannot find module '.../server/test'` (MODULE_NOT_FOUND).
Минимальный репро вне репо (`/tmp/opencode/td/a.test.mjs`) — то же самое:
ограничение Node v22, не дефект кода. Эквивалентный гейт с тем же интентом
(все 3 файла):

```sh
node --test "server/test/**/*.test.mjs"   # 23/23 pass, exit=0
node --test server/test/*.test.mjs        # 23/23 pass, exit=0 (shell-форма)
sh scripts/test-no-sensitive.sh           # 7 ok, exit=0
```

23 = 4 (frontmatter) + 18 (tools) + 1 (stdio). Строки
`# warning: skipping non-skill directory: …/notaskill` в TAP-выводе —
закреплённое по Interfaces поведение discoverSkills (предупреждение в
stderr), а не шум: их генерируют вызовы `discoverSkills` из tools-теста.

Доп. проверка чувствительности не-закоммиченного контента (скрипт гребет
только tracked, как в журнале task 1): regex по приватным IP-диапазонам и 6
значений local.mk напрямую по `server/` — 0 совпадений (rc=1/1).

## Шаг 8: commit

```sh
git add server
git add docs/superpowers/journal/2026-10-25-skills-repo-task-02.md
git commit -m "feat: MCP server core — skill discovery, tools, stdio transport"
```

(res. 3: журнал коммитится вместе с задачей; ничего else не staged.)

## Доп. фикс по плану (после шага 8): defaultSkillsDir — sibling-формула

Дефект плана (выявлен контроллером): исходная формула из брифа
`join(dirname(fileURLToPath(import.meta.url)), "skills")` давала дочерний
`<repo>/server/skills`, а не реальный `<repo>/skills` с пятью скиллами —
dev-default (`SKILLS_DIRS` не задан) работал в пустоту. Бриф регенерирован
(шаг 3 + pinned-ассерт шага 4): формула — sibling
`resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills")`;
образ Task 4 будет изоморфным (server.mjs под `server/`), формула та же.

Фикс (2 строки):
- `server/server.mjs` `defaultSkillsDir()` →
  `return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");`
  (`resolve` уже импортирован — нормализованный/абсолютный путь).
- `server/test/tools.test.mjs` pinned-ассерт:
  `assert.equal(defaultSkillsDir(), resolve(join(serverDir, "..", "skills")))`,
  где `serverDir = join(here, "..")` (дословно формула из шага 4;
  `resolve` добавлен в import node:path).

Гейты после фикса:
- `node --test "server/test/**/*.test.mjs"` → 23/23 pass, exit 0
  (тест `defaultSkillsDir: sibling skills/ next to the server dir` — ok 8).
- `sh scripts/test-no-sensitive.sh` → 7 ok, exit 0.
- Smoke dev-default (read-only): `env -u SKILLS_DIRS node server/server.mjs`
  + `tools/list` → 7 инструментов (5 реальных скиллов из `<repo>/skills`
  подхвачены без env).

Коммит `a5d170d` поправлен (amend, local-only — remote отсутствует;
сообщение не менялось). Новый SHA — в fix-отчёте.
