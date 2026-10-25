# Журнал: Task 3 — HTTP-транспорт (streamable-HTTP)

План: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 3.
Бриф: `.superpowers/sdd/2026-10-25-skills-repo/task-3-brief.md`.
Рабочая ветка: `plan/skills-repo`. Node v22.22.2, ESM, только `node:` builtins
(`node:http` — единственный новый импорт; npm-зависимостей нет).

Решения контроллера: (1) интеграционный тест — spawn реального процесса +
глобальный `fetch` (node 22); (2) teardown — `child.kill()` в `after`;
(3) журнал коммитится вместе с задачей; (5) stdio-ветка не трогается.

Закреплённые из заголовка плана (строка «Порт»): дефолтный порт 8080
(`PORT` env, `0` = ephemeral + строка `listening on port <n>` в stderr).
Привязка host: `server.listen(port)` без host (все интерфейсы) — образ Task 4
достигается снаружи контейнера (`run-http -p 8080:8080`), 127.0.0.1 не годится.
Строку `listening on port <n>` печатает main после `await startHttpServer`
(порт — `server.address().port`); экспорт `startHttpServer` остаётся чистым.

## Шаг 1: failing-тест

`server/test/http.test.mjs`: spawn `node server/server.mjs` c env
`MCP_MODE=http`, `PORT=0`, `SKILLS_DIRS=<fixtures>`; ожидание
`listening on port (\d+)` в stderr (таймаут 5 c); затем ровно 5 закреплённых
проверок брифа: POST initialize (200, content-type `application/json`,
`serverInfo.name === "skills"`), POST `tools/call list_skills` (текст содержит
`alpha`), POST `notifications/initialized` без `id` (202, пустое тело),
GET /healthz (200, тело `ok`), GET /mcp (200, content-type
`text/event-stream`; тело отменено `body.cancel()` — это и есть disconnect
клиента, сервер должен закрыться по нему и не упасть). Teardown —
`after(() => { if (proc) proc.kill(); })`.

## Шаг 2: RED

```sh
node --test server/test/http.test.mjs   # exit=1
```

FAIL: `timeout waiting for 'listening on port <n>' in stderr; stderr so far:
warning: skipping non-skill directory: …/fixtures/skills/notaskill` (5 c).
Ожидаемо: http-ветки нет, процесс уходит в stdio-режим — discoverSkills
напечатал warning и цикл ждёт stdin (pipe открыт), строки listening нет.

## Шаг 3: http-ветка

`server/server.mjs` (stdio-ветка не тронута — дословно та же, лишь в main
после http-ветки):
- импорт `createServer` из `node:http` (между fs и path — по алфавиту).
- `sendJson(res, obj)` — 200 + `application/json` + `JSON.stringify`.
- `startHttpServer(skills, port) -> Promise<http.Server>`:
  - `POST /mcp`: сборка тела; `JSON.parse` — сбой → `-32603` «invalid JSON body»
    (id `null`); массив → `-32603` «batch requests are not supported»
    (закреплено брифом); `msg.id === undefined` (вкл. `null`/не-объект) →
    202, пустое тело; иначе `handleRequest` в try/catch → `-32603`.
  - `GET /mcp`: 200, `text/event-stream` (+ `cache-control: no-cache`),
    `flushHeaders()` (иначе заголовки уходят только при write/end и fetch
    клиента висит), стрим открыт; `req.on("close", () => res.end())` —
    закрытие по disconnect.
  - `GET /healthz`: 200, тело `ok`. Остальные метод/путь → 404.
  - `listen(port)` без host (все интерфейсы); `once("error", reject)` снят
    после успешного listen.
- `main()` → async; http-ветка: `MCP_MODE === "http"` →
  `port = PORT === undefined ? 8080 : Number(PORT)` → `await startHttpServer`
  → `listening on port <n>` в stderr → return (stdin не читается).

## Шаг 4: GREEN + полный гейт

```sh
node --test server/test/http.test.mjs    # 1/1 pass, exit=0
node --test "server/test/**/*.test.mjs"  # 24/24 pass, exit=0 (4 файла)
sh scripts/test-no-sensitive.sh          # 7 ok, exit=0
```

24 = 4 (frontmatter) + 1 (http) + 1 (stdio) + 18 (tools). Строки
`# warning: skipping non-skill directory: …/notaskill` в TAP-выводе —
закреплённое поведение discoverSkills (stderr), не шум (как в журнале
task 2).

Smoke вне закреплённых проверок (read-only, `/tmp/opencode/http-smoke.mjs`):
- `POST /mcp` с JSON-массивом → 200, `error.code -32603`,
  «batch requests are not supported»;
- `POST /mcp` с `{not json` → 200, `error.code -32603` (не краш);
- `GET /nope` → 404; `POST /healthz` → 404;
- stdin.close() в http-режиме: процесс жив (`exitCode === null`) — stdin не
  читается;
- `MCP_MODE=http` без `PORT` → `listening on port 8080` (дефолт плана).

## Шаг 5: commit

```sh
git add server
git add docs/superpowers/journal/2026-10-25-skills-repo-task-03.md
git commit -m "feat: MCP server — streamable-HTTP transport (POST /mcp, GET /mcp SSE, /healthz)"
```

(res. 3: журнал коммитится вместе с задачей; ничего else не staged.)
