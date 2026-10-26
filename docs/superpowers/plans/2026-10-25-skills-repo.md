# skills repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Канон-репо пяти opencode-скиллов + zero-dep MCP-сервер (stdio + streamable-HTTP, в контейнере) + установка на хост — так, чтобы подключённый context7 не перекрывал выверенные скиллы.

**Architecture:** В репо `~/git/IMPLEMENTATION/skills` контент скиллов лежит в `skills/` (host-specific значения — плейсхолдеры `@VAR@`, значения в gitignored `local.mk`); `server/server.mjs` (node, только builtins) обнаруживает каталоги скиллов и раздаёт tools/resources; Makefile рендерит контент и собирает образ `skills-mcp:local`; `scripts/install.sh` кладёт симлинки/отрендеренные SKILL.md в `~/.config/opencode/skills/` и идемпотентно пишет `mcp.servers` в `opencode.jsonc`.

**Tech Stack:** node 22 (только builtins), POSIX sh, podman/podman-remote, `node --test`, `gh`.

**Spec:** `docs/superpowers/specs/2026-10-25-skills-repo-design.md`

## Global Constraints

- Node ≥ 22 (на хосте v22; образ `FROM quay.io/fedora/nodejs-22:latest` — Fedora 44, node v22.23.1; решение владельца 2026-10-26).
- Ноль npm-зависимостей: только `node:` builtins (fs, path, http, url, test).
- Имя образа: `skills-mcp:local`; порт 8080 (env `PORT`, `0` = ephemeral + строка `listening on port <n>` в stderr).
- Env: `MCP_MODE=stdio|http` (дефолт `stdio`); `SKILLS_DIRS` — список путей через `:`; каждый элемент — каталог скилла (содержит SKILL.md) ИЛИ корень с такими каталогами; дефолт — `skills/` рядом с каталогом `server.mjs`.
- HTTP-эндпоинты: `POST /mcp` (JSON-RPC, ответ `application/json`), `GET /mcp` (SSE-стрим, открыт, без событий), `GET /healthz` (200).
- Инструменты: `list_skills`, `<имя-каталога, - → _>_docs {section?}`, `skill_file {skill, path}`; resources `mcp://skills/<имя>/SKILL.md`; serverInfo `{name: "skills", version: "1.0.0"}`; `initialize` — эхо `protocolVersion` (fallback `"2025-06-18"`).
- Плейсхолдеры: `@VAR@`; `local.mk` в корне репо, строки `VAR := value` / `VAR = value`; `local.mk.example` в git, значения только 192.0.2.0/24.
- Имена переменных ipmi-ops (закреплено): `IPMI_MELLANOX_HOST`, `IPMI_MELLANOX_BMC`, `IPMI_BAZZITE_HOST`, `IPMI_BAZZITE_BMC`, `IPMI_ASR1_HOST`, `IPMI_ASR1_BMC` (маппинг на столбцы таблицы — по её заголовкам).
- CRE: `podman`, при существовании `/run/.containerenv` — `podman-remote` (авто в Makefile и install.sh; хардкод запрещён).
- Коммиты — на английском; в containerfile нет завершающих (inline) комментариев; rm в скриптах репо не используется; `make test` включает `scripts/test-no-sensitive.sh` и обязан проходить на каждом коммите (для коммитов Tasks 1–3, где Makefile ещё нет, — его компоненты: `sh scripts/test-no-sensitive.sh` + `node --test` существующих тестов).
- Гейт `node --test` — glob-форма `node --test "<dir>/**/*.test.mjs"` (Node 22: позиционные аргументы — glob-паттерны, голая директория не разворачивается в тесты).
- Формат opencode-конфига: современный `mcp.servers.<имя>` (local: `type`+`command`; remote: `type`+`url`+`headers`).

## Review Focus

1. Реальные ожидания opencode-клиента streamable-HTTP (Accept, MCP-Session-Id, SSE vs JSON) — fetch-тесты не покрывают; живой чек режима (б) в Task 7.
2. Поведенческий G5: следует ли агент нашим докам, а не context7 — живой проб в Task 7.
3. Discovery opencode симлинкованного SKILL.md (у irisc-asm задокументирован fallback на копию) — Task 6 проверяет `available_skills`; fallback = копия/рендер + md5.
4. JSONC-патч реального `opencode.jsonc` (URL с `//`, чужие ключи) — фикстура Task 5 содержит URL с `//`; Task 6: бэкап до патча + ре-парс после.
5. stdio-passthrough podman-remote для smoke (`-i` через remote) — `make smoke` (Task 4) в этом окружении гоняется под CRE=podman-remote.

---

### Task 1: Скелет репо + миграция контента скиллов

**Files:**
- Create: `skills/{analyzing-opencode-logs,basecalc,ipmi-ops,mellanox-flash-ops,mellanox-fw-build}/…`, `local.mk.example`, `local.mk` (gitignored), `.gitignore`, `AGENTS.md`, `docs/reference/mellanox-flash-ops-prototype.mjs`
- Source (read-only): `~/.config/opencode/skills/<пять каталогов>/`

**Interfaces:**
- Consumes: ничего.
- Produces: `skills/<имя>/SKILL.md` + .py; ipmi-ops SKILL.md с `@IPMI_*@`; `local.mk` (6 закреплённых переменных); `local.mk.example`; `.gitignore`; AGENTS.md.

- [ ] **Step 1: Скопировать контент**

```sh
mkdir -p skills docs/reference
for d in analyzing-opencode-logs basecalc ipmi-ops mellanox-flash-ops mellanox-fw-build; do
  cp -a ~/.config/opencode/skills/$d skills/$d
done
rm -rf skills/mellanox-flash-ops/mcp
rm -f skills/mellanox-flash-ops/SKILL.md-old
cp ~/.config/opencode/skills/mellanox-flash-ops/mcp/server.mjs \
   docs/reference/mellanox-flash-ops-prototype.mjs
```

(Два `rm` — литеральные пути в свежем чекауте, не внутри скриптов репо; правило «нет rm в скриптах» их не охватывает.)

- [ ] **Step 2: Плейсхолдеры в ipmi-ops/SKILL.md**

Прочитать `skills/ipmi-ops/SKILL.md`. Заменить IP (строки таблицы хостов + упоминание asr1 в примечании) на `@IPMI_MELLANOX_HOST@`, `@IPMI_MELLANOX_BMC@`, `@IPMI_BAZZITE_HOST@`, `@IPMI_BAZZITE_BMC@`, `@IPMI_ASR1_HOST@`, `@IPMI_ASR1_BMC@` — маппинг по заголовкам таблицы (какой столбец HOST, какой BMC).

- [ ] **Step 3: local.mk / local.mk.example / .gitignore**

`local.mk.example` — 6 переменных, значения 192.0.2.101…192.0.2.106. `local.mk` — те же имена, реальные значения. `.gitignore`:

```
local.mk
.build/
.superpowers/
```

- [ ] **Step 4: AGENTS.md**

Краткий файл: `make test` — гейт каждого коммита (node --test, render, test-no-sensitive); `make build`/`make smoke` — контейнер; CRE-правило (no-cre-hardcode); english-commits; no-inline-comments (containerfile); rm в скриптах репо не используется; чувствительные значения не в tracked-файлах (test-no-sensitive.sh).

- [ ] **Step 5: Обновить SKILL.md про .py-хелперы**

Для `analyzing-opencode-logs` (oclog.py), `basecalc` (calc.py), `ipmi-ops` (sol_bridge.py): где SKILL.md ссылается на скрипт по локальному пути скилла — заменить на «скрипт берётся с MCP-сервера инструментом `skill_file(<скилл>, <файл>)` (fallback — чекаут этого репо)». Проверить каждый .py на CWD-независимость (пути относительно `__file__`), при проблеме поправить. Если есть `python3` — прогнать каждый скрипт из `/tmp` с `--help`/без аргументов.

- [ ] **Step 6: Проверки**

Run: `sh scripts/test-no-sensitive.sh`
Expected: все `ok`, exit 0.
Run: `git status --porcelain`
Expected: `local.mk` не отслеживается.

- [ ] **Step 7: Commit**

```sh
git add -A
git commit -m "feat: migrate five skills into canonical repo with local.mk externalization"
```

---

### Task 2: MCP-сервер: ядро (discovery, tools, stdio)

**Files:**
- Create: `server/server.mjs`, `server/test/fixtures/skills/alpha/SKILL.md`, `server/test/fixtures/skills/alpha/tool.txt`, `server/test/fixtures/skills/beta/SKILL.md`, `server/test/fixtures/skills/notaskill/readme.txt`, `server/test/frontmatter.test.mjs`, `server/test/tools.test.mjs`, `server/test/stdio.test.mjs`

**Interfaces:**
- Consumes: frontmatter-формат `---\nname: …\ndescription: …\n---`.
- Produces (экспорты `server.mjs`):
  - `parseFrontmatter(text) -> {name, description, body}`
  - `discoverSkills(dirs) -> Array<{name, dir, meta: {name, description}, files}>` (entry — каталог скилла или корень; нескилловые — пропуск + предупреждение в stderr; `files` — относительные пути)
  - `defaultSkillsDir() -> string`
  - `buildTools(skills) -> Array<{name, description, inputSchema}>`
  - `buildResources(skills) -> Array<{uri, name, description, mimeType}>`
  - `handleRequest(msg: {id, method, params?}, skills) -> object` (JSON-RPC-ответ; неизвестный method → `-32601`, неизвестный tool → `-32602`, промах по секции → `result.isError: true` + текст `Available sections: …`)

Фикстуры (закреплено):
- `alpha/SKILL.md`: frontmatter `name: alpha`, `description: Alpha test skill: with colon — and em dash`; тело: `# Alpha`, `## One` («One body.»), `## Two` («Two body.»).
- `alpha/tool.txt`: `hello tool`
- `alpha/blob.bin`: бинарный файл (содержит NUL-байт).
- `beta/SKILL.md`: `name: beta`, `description: Beta skill`; `## Only` («Only body.»).
- `notaskill/readme.txt`: `not a skill` (без SKILL.md).

- [ ] **Step 1: Фикстуры + failing-тест frontmatter**

`server/test/frontmatter.test.mjs`: `parseFrontmatter` на alpha/beta + 2 реальных samples — строки description из frontmatter `~/.config/opencode/skills/mellanox-flash-ops/SKILL.md` и `basecalc/SKILL.md` (с эм-дэшами/двоеточиями), **скопированные литералами** в тест-файл при написании (сверка с исходниками — на этапе написания теста; в рантайме тест файлы вне репо НЕ читает — после Task 6 эти пути изменятся). Assert: точные `name`/`description`, `body` начинается с `# `.

- [ ] **Step 2: Run — FAIL**

Run: `node --test server/test/frontmatter.test.mjs`
Expected: FAIL (модуль `server.mjs` не найден).

- [ ] **Step 3: Реализовать parseFrontmatter, discoverSkills, defaultSkillsDir**

`server.mjs` (ESM). Frontmatter: блок между первой `---` и следующей `---`, пары `key: value`. Discovery: entry с SKILL.md → скилл; иначе — подкаталоги с SKILL.md; иначе skip + stderr. `defaultSkillsDir` = `resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills")` (соседский `skills/` к каталогу server.mjs — работает и в чекауте репо, и в образе, т.к. containerfile кладёт server.mjs в `server/`).

- [ ] **Step 4: Failing-тест tools**

`server/test/tools.test.mjs` (assertions закреплёны):
- `discoverSkills([fixtures/skills])` → ровно 2 скилла (alpha, beta); `alpha.files` содержит `tool.txt`.
- `discoverSkills([fixtures/skills/alpha, fixtures/skills/beta])` (entry = сами каталоги скиллов) → 2 скилла.
- `defaultSkillsDir()` → `resolve(join(dirname(<каталог server.mjs>), "..", "skills"))` (в репо — `<repo>/skills`).
- `buildTools` → имена: `list_skills`, `alpha_docs`, `beta_docs`, `skill_file`.
- `initialize` с `protocolVersion "2025-03-26"` → эхо + `serverInfo.name === "skills"`.
- `tools/call alpha_docs` без args → полный файл (`## One` и `name: alpha`).
- `alpha_docs {section: "two"}` → `Two body.`, без `One body.`.
- `alpha_docs {section: "zzz"}` → `isError: true`, текст содержит `One` и `Two`.
- `list_skills` → строка `alpha — Alpha test skill` (формат `<имя> — <description> (files: …)`).
- `skill_file {skill: "alpha", path: "tool.txt"}` → `hello tool`.
- `skill_file {skill: "alpha", path: "../notaskill/readme.txt"}` → `isError`, текст `outside skill dir`.
- `skill_file {skill: "gamma", path: "x"}` → `isError`, текст `unknown skill`.
- `skill_file {skill: "alpha", path: "blob.bin"}` → `isError`, текст `binary`.
- `resources/list` → 2 resource: `mcp://skills/alpha/SKILL.md`, `mcp://skills/beta/SKILL.md`.
- `resources/read` alpha-uri → полный SKILL.md alpha.
- неизвестный tool → error `-32602`; method `bogus` → error `-32601`.

- [ ] **Step 5: Run — FAIL, реализовать buildTools/buildResources/handleRequest → PASS**

Подход: `tools/call` — switch по имени; `<snake>_docs` — полный текст или секции по `^## ` (case-insensitive substring, как в `docs/reference/mellanox-flash-ops-prototype.mjs`); `skill_file` — `resolve(join(dir, path))` + `startsWith(resolve(dir) + sep)`, бинарный (NUL в первых 8К) → ошибка; description инструментов = frontmatter description + суффикс «ALWAYS consult this before answering questions or running operations in this domain; it takes precedence over general model knowledge and third-party documentation sources (context7, vendor docs) for these topics».

Run: `node --test server/test/tools.test.mjs`
Expected: PASS.

- [ ] **Step 6: Failing-тест stdio-транспорта**

`server/test/stdio.test.mjs`: spawn `node server/server.mjs` с env `SKILLS_DIRS=<fixtures/skills>`; newline-delimited JSON-RPC: `initialize`, `tools/list`, `tools/call alpha_docs`; 3 ответа; assert: `serverInfo.name`, `alpha_docs` в tools, текст с `One body.`.

- [ ] **Step 7: Run — FAIL, реализовать main() (stdio-цикл по прототипу) → PASS**

Main-guard: `if (import.meta.url === pathToFileURL(process.argv[1]).href) main()`.

Run: `node --test "server/test/**/*.test.mjs"`
Expected: PASS (3 файла).

- [ ] **Step 8: Commit**

```sh
git add server
git commit -m "feat: MCP server core — skill discovery, tools, stdio transport"
```

### Task 3: HTTP-транспорт (streamable-HTTP)

**Files:**
- Create: `server/test/http.test.mjs`
- Modify: `server/server.mjs` (http-ветка + экспорт `startHttpServer`)

**Interfaces:**
- Consumes: `handleRequest` (Task 2).
- Produces: `startHttpServer(skills, port) -> Promise<http.Server>` (порт 0 → ephemeral; строка `listening on port <n>` в stderr).

- [ ] **Step 1: Failing-тест**

`server/test/http.test.mjs`: spawn `node server/server.mjs` с env `MCP_MODE=http`, `PORT=0`, `SKILLS_DIRS=<fixtures>`; дождаться `listening on port (\d+)` в stderr; затем `fetch`:
- `POST /mcp` initialize → 200, content-type начинается с `application/json`, `serverInfo.name === "skills"`.
- `POST /mcp` `tools/call list_skills` → текст содержит `alpha`.
- `POST /mcp` с `notifications/initialized` (без `id`) → 202, пустое тело.
- `GET /healthz` → 200.
- `GET /mcp` → 200, content-type начинается с `text/event-stream`.
- `defaultSkillsDir`-зависимостей в этом тесте нет (spawn с явным `SKILLS_DIRS`).

- [ ] **Step 2: Run — FAIL**

Run: `node --test server/test/http.test.mjs`
Expected: FAIL (нет http-ветки; процесс уходит в stdio-режим).

- [ ] **Step 3: Реализовать http-ветку**

`node:http`. `POST /mcp`: тело — одно JSON-RPC-сообщение (массив → error `-32603`), ответ `application/json` через `handleRequest`; сообщение без `id` (notification, напр. `notifications/initialized`) → `202 Accepted`, пустое тело. `GET /mcp`: 200, `text/event-stream`, стрим открыт, закрывается по disconnect клиента. `GET /healthz`: 200 `ok`. Остальные пути → 404. При `MCP_MODE=http` stdin не читается.

- [ ] **Step 4: Run — PASS**

Run: `node --test "server/test/**/*.test.mjs"`
Expected: PASS (4 файла).

- [ ] **Step 5: Commit**

```sh
git add server
git commit -m "feat: MCP server — streamable-HTTP transport (POST /mcp, GET /mcp SSE, /healthz)"
```

---

### Task 4: Рендер, Makefile, containerfile, smoke

**Files:**
- Create: `scripts/render.sh`, `scripts/test-render.sh`, `containerfile`, `Makefile`, `test/fixtures-render/skills/alpha/SKILL.md`

**Interfaces:**
- Consumes: синтаксис `local.mk`/плейсхолдеров (Task 1), `skills/` + `server/server.mjs`.
- Produces:
  - `scripts/render.sh <src> <dst> [local.mk]` — src: каталог с каталогами скиллов; dst не должен существовать (иначе exit 1); подстановка `@VAR@`; оставшиеся `@[A-Z][A-Z0-9_]*@` → exit 1 со списком; пустое значение → exit 1 `empty value: VAR`; local.mk по умолчанию — `<repo>/local.mk`.
  - Makefile: цели `build`, `test`, `smoke`, `run-http`; переменные `CRE`, `IMAGE ?= skills-mcp:local`.

- [ ] **Step 1: Failing-тест render**

Фикстура `test/fixtures-render/skills/alpha/SKILL.md`: frontmatter + строки с `@FOO@` и `@BAR@`.
`scripts/test-render.sh` (TAP, стиль `test-no-sensitive.sh`; временные local.mk в `mktemp -d`):
- ok: local.mk с `FOO := 192.0.2.101` и `BAR = 192.0.2.102` → в выводе оба значения, `@FOO@`/`@BAR@` отсутствуют.
- ok: фикстура с `@NOPE@`, NOPE не задан → exit ≠ 0, в stderr имя `NOPE`.
- ok: `FOO :=` (пусто) → exit ≠ 0, в stderr `empty value: FOO`.

Run: `sh scripts/test-render.sh`
Expected: FAIL (render.sh нет).

- [ ] **Step 2: Реализовать render.sh → PASS**

POSIX sh: разбор local.mk (`VAR := v` / `VAR = v`, пропуск комментариев/пустых), `cp -a` src→dst, `sed`-подстановка по всем файлам, финальный `grep -RnE '@[A-Z][A-Z0-9_]*@'` по dst → остаток = ошибка.

Run: `sh scripts/test-render.sh`
Expected: 3 ok, exit 0.

- [ ] **Step 3: containerfile**

```
FROM quay.io/fedora/nodejs-22:latest

WORKDIR /app
COPY server/server.mjs server/server.mjs
COPY skills/ ./skills/

EXPOSE 8080
CMD ["node", "server/server.mjs"]
```

(Раскладка 1:1 с чекаутом репо: server.mjs в `server/`, `skills/` соседний — дефолт `defaultSkillsDir` (соседский) работает в образе без `SKILLS_DIRS`.)

- [ ] **Step 4: Makefile**

```make
ifeq ($(wildcard /run/.containerenv),)
CRE ?= podman
else
CRE ?= podman-remote
endif
-include local.mk
IMAGE ?= skills-mcp:local
.PHONY: build test smoke run-http

build:
	@mkdir -p .build; CTX=$$(mktemp -d .build/ctx-XXXXXX); \
	scripts/render.sh skills $$CTX/skills && \
	mkdir -p $$CTX/server && cp server/server.mjs $$CTX/server/server.mjs && \
	$(CRE) build -f containerfile -t $(IMAGE) $$CTX

test:
	node --test "server/test/**/*.test.mjs"
	sh scripts/test-no-sensitive.sh
	sh scripts/test-render.sh

smoke: build
	@OUT=$$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | $(CRE) run --rm -i $(IMAGE)); \
	echo "$$OUT" | grep -q '"name":"skills"' && \
	echo "$$OUT" | grep -q 'list_skills' && \
	echo "$$OUT" | grep -q 'mellanox_flash_ops_docs' && echo smoke-ok

run-http: build
	$(CRE) run --rm -p 8080:8080 -e MCP_MODE=http $(IMAGE)
```

- [ ] **Step 5: build + smoke + test**

Run: `make build`
Expected: образ создан (`$(CRE) image exists skills-mcp:local` → да).
Run: `make smoke`
Expected: `smoke-ok` (в этом окружении — под CRE=podman-remote, покрывает Review Focus 5).
Run: `make test`
Expected: все PASS.

- [ ] **Step 6: Commit**

```sh
git add scripts/render.sh scripts/test-render.sh containerfile Makefile test/fixtures-render
git commit -m "feat: container build pipeline — render.sh, Makefile (CRE auto), containerfile, smoke"
```

### Task 5: install.sh и патчер opencode.jsonc

**Files:**
- Create: `scripts/patch-mcp-config.mjs`, `scripts/install.sh`, `scripts/test/patch-mcp-config.test.mjs`, `scripts/test/fixtures/config.jsonc`

**Interfaces:**
- Consumes: `make build`, `make smoke`, `render.sh` (Task 4); `local.mk` (Task 1).
- Produces:
  - `scripts/patch-mcp-config.mjs set <config.jsonc> <server-name> <json-entry>` — вписать `mcp.servers.<name> = <json-entry>` (создать блок, остальное сохранить).
  - `scripts/patch-mcp-config.mjs remove <config.jsonc> <top-level-key>` — удалить топовый ключ.
  - Модуль экспортирует `parseJsonc(text) -> object` (переиспользуется one-liner'ом Task 6).
  - JSONC-вход: `//`, `/* */`, trailing commas, URL с `//`; вывод: нормализованный JSON, indent 2 (комментарии не сохраняются).
  - `scripts/install.sh` (из корня репо; env `SKILLS_MCP_URL` → remote-запись).

Фикстура `scripts/test/fixtures/config.jsonc` (закреплено): `//`-комментарий, `/* */`-комментарий, `"url": "https://mcp.context7.com/mcp"`, trailing comma, чужие топовые ключи `mcp1`, `plugin: []`; ключа `mcp` нет.

Тесты (assertions закреплёны):
- `set`: `mcp.servers.skills` появляется с точным entry; URL `https://…` цел; чужие ключи сохранены; результат ре-парсится.
- `set` дважды → entry перезаписан (идемпотентно).
- `remove` → топовый ключ убрался, остальное на месте.
- Trailing comma во входе парсится.

- [ ] **Step 1: Фикстура + failing-тест**

Run: `node --test scripts/test/patch-mcp-config.test.mjs`
Expected: FAIL (модуль не найден).

- [ ] **Step 2: Реализовать patch-mcp-config.mjs → PASS**

JSONC-strip — малая state machine (в-строке с экскейпами / `//` / `/* */` / trailing commas), чтобы `//` внутри URL не считалась комментарием.

Run: `node --test scripts/test/patch-mcp-config.test.mjs`
Expected: PASS.

- [ ] **Step 3: install.sh**

POSIX sh, запуск из корня репо; шаги (закреплено):
1. Проверки: node, git, CRE-авто (логика как в Makefile), `local.mk`, существование `$HOME/.config/opencode/opencode.jsonc`; `make build`.
2. Для каждого каталога в `skills/`: `mkdir -p` target `$HOME/.config/opencode/skills/<имя>`; если `target/SKILL.md` существует как обычный файл без маркера `.rendered`, а в скилле нет плейсхолдеров → abort с подсказкой про одноразовую миграцию (до-миграционное состояние). Скилл с плейсхолдерами: `tmp=$(mktemp -d); cp -a skills/<имя> $tmp/skills/<имя>; scripts/render.sh $tmp/skills $tmp/out`; затем `cp $tmp/out/<имя>/SKILL.md target/`, `touch target/.rendered`, вывести md5. Иначе: `ln -sf <репо>/skills/<имя>/SKILL.md target/SKILL.md`.
3. `node scripts/patch-mcp-config.mjs set <config> skills '<entry>'` — entry: local `{"type":"local","command":["<CRE>","run","--rm","-i","skills-mcp:local"]}` либо remote `{"type":"remote","url":"$SKILLS_MCP_URL"}` (если задан).
4. `make smoke`.

Run: `sh -n scripts/install.sh`
Expected: синтаксис ок. (Живой прогон — Task 6.)

- [ ] **Step 4: Расширить test-таргет + make test + commit**

Makefile: в цели `test` строку `node --test "server/test/**/*.test.mjs"` заменить на `node --test "server/test/**/*.test.mjs" "scripts/test/**/*.test.mjs"`.

Run: `make test`
Expected: PASS (node --test теперь включает `scripts/test`).

```sh
git add scripts Makefile
git commit -m "feat: host install — JSONC mcp-config patcher, install.sh (symlink/render/smoke)"
```

---

### Task 6: GitHub + одноразовая миграция (текущий хост)

**Files:**
- Modify (хост, не в репо): `~/.config/opencode/skills/*`, `~/.config/opencode/opencode.jsonc`
- Repo: push

Шаги (команды закреплёны; rm не используется):

- [ ] **Step 1: GitHub**

`gh repo view <gh-юзер>/skills` — если 404: `gh repo create skills --private --source . --remote origin`. `git push`.

- [ ] **Step 2: Верификация содержимого (lossless)**

4 скилла без плейсхолдеров: `diff` SKILL.md и .py пофайлово против исходников в `~/.config` (mellanox-flash-ops — только SKILL.md; не скопированные `mcp/`, `SKILL.md-old` — ожидаемо).
ipmi-ops: рендер с `local.mk` во временный каталог (`mktemp -d`) → `diff` отрендеренного SKILL.md с `~/.config/opencode/skills/ipmi-ops/SKILL.md` → идентично (плейсхолдерный раундтрип lossless).

- [ ] **Step 3: Бэкап + отодвинуть старые каталоги**

```sh
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak-$(date +%Y%m%d)
for d in analyzing-opencode-logs basecalc ipmi-ops mellanox-flash-ops mellanox-fw-build; do
  mv ~/.config/opencode/skills/$d ~/.config/opencode/skills/$d.pre-migration
done
```

- [ ] **Step 4: Конфиг: context7 + skills**

Достать entry context7 из `mcp1` (node one-liner через `parseJsonc` из patch-mcp-config.mjs); **убрать из entry поле `enabled`** (в современном `mcp.servers` используется `disabled`); затем:

```sh
node scripts/patch-mcp-config.mjs set ~/.config/opencode/opencode.jsonc context7 '<достатый entry>'
node scripts/patch-mcp-config.mjs set ~/.config/opencode/opencode.jsonc skills '{"type":"local","command":["<CRE>","run","--rm","-i","skills-mcp:local"]}'
node scripts/patch-mcp-config.mjs remove ~/.config/opencode/opencode.jsonc mcp1
node scripts/patch-mcp-config.mjs remove ~/.config/opencode/opencode.jsonc mcp-mlnx
```

Ре-парс результата (node) → OK. (Review Focus 4.)

- [ ] **Step 5: Установка + верификация**

`scripts/install.sh` → PASS (4 симлинка, ipmi-ops отрендерен + md5, smoke).
Через `opencode run` из временного каталога (если флаги другие — `opencode run --help`): «Перечисли доступные скиллы и вызови инструмент list_skills MCP-сервера skills, покажи вывод».
Expected: все 5 скиллов в `available_skills` (Review Focus 3); `list_skills` → 5 строк; `ipmi_ops_docs` содержит реальные IP (отрендерено, без `@IPMI_@`).

- [ ] **Step 6: Commit (если были правки репо) + push**

---

### Task 7: Приёмка (тесты, smoke, режим (б), живой проб)

**Files:**
- Create: `docs/acceptance/2026-10-25-live-probe.md`
- Modify: `docs/superpowers/specs/2026-10-25-skills-repo-design.md` (строка статуса)

- [ ] **Step 1: Полный гейт**

Run: `make test` → все PASS.
Run: `make smoke` → `smoke-ok`.

- [ ] **Step 2: Живой чек режима (б) (Review Focus 1)**

`make run-http` (в фоне); во временном каталоге `.opencode/opencode.json`: `{"mcp":{"servers":{"skills":{"type":"remote","url":"http://127.0.0.1:8080/mcp"}}}}`; оттуда `opencode run "Вызови инструмент list_skills MCP-сервера skills и покажи его вывод."`
Expected: вывод содержит все 5 имён скиллов. Убить контейнер.

- [ ] **Step 3: Живой проб G5 (Review Focus 2)**

Свежая сессия (интерактивная или `opencode run`). Предварительно убедиться, что context7 активен: вопросом по общей (немелланоксовой) теме проверить, что агент вызывает инструмент context7. Вопрос проба (закреплён): «Какой командой сделать ri-дамп прошивки на root-mellanox? Покажи только команду, ничего не выполняй.»
Проход: агент консультирует `mellanox_flash_ops_docs` (или скилл mellanox-flash-ops) до ответа; в ответе — `mstflint`; нет `flint`/`mlxconfig`/`mlxlink` в качестве первичных, нет `/dev/mst`.
Провал: доложить владельцу, поправить формулировки tool description, повторить проб (малый скоуп).
Транскрипт → `docs/acceptance/2026-10-25-live-probe.md` (вопрос, вызовы инструментов, ответ, вердикт).

- [ ] **Step 4: Статус спеки + commit + push**

Статус спеки уже переключён на «утверждено владельцем 2026-10-25» (сделано вместе с коммитом замечаний ревью плана).

```sh
git add -A
git commit -m "docs: record live probe acceptance; mark spec approved"
git push
```
