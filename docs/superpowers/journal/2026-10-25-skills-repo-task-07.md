# Журнал: Task 7 — Приёмка (тесты, smoke, режим (б), живой проб G5)

План: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 7 (последний).
Бриф: `.superpowers/sdd/2026-10-25-skills-repo/task-7-brief.md` + разрешения
контроллера №1–7 (в dispatch-сообщении). Рабочая ветка: `plan/skills-repo`.

Окружение: node v22.22.2, `/run/.containerenv` существует → CRE=podman-remote
(автоопределение, как в Makefile). Образ `skills-mcp:local` собран (Task 6,
smoke-ok). Конфиг `~/.config/opencode/opencode.jsonc` — `mcp.servers`:
context7 (remote, Bearer-токен в headers) + skills (local:
`podman-remote run --rm -i skills-mcp:local`).

Маскировка (как в Task 6): реальные IP → `172.x.x.x`, Bearer-токен context7 →
`ctx7sk-****`. В док/журнал/коммит sensitive-значения не вносятся.

Состояние до начала (read-only):
- git: ветка `plan/skills-repo`, working tree clean, up to date с origin.
- `docs/acceptance/` в репо нет (создаётся этим task).
- Статус спеки (read-only проверка): строка 3 = «Статус: утверждено владельцем
  2026-10-25.» → step 4 брифа («уже переключён») выполнен ранее, менять нечего.

## Шаг 1: Полный гейт (fresh)

```sh
make test   # exit 0
# node --test: tests 28 / pass 28 / fail 0 (383 ms)
# test-no-sensitive.sh: pass=7 fail=0
# test-render.sh: pass=3 fail=0
make smoke  # exit 0
# build: skills-mcp:local (cached, 5b37bbb9785d, все 6 STEP using cache)
# → smoke-ok
```

Оба гейта зелёные с первого прогона (fresh, без правок кода).

## Шаг 2: Живой чек режима (б) (Review Focus 1)

Порядок (разрешение контроллера №1): run-http в фоне → healthz → опрос из
временного каталога → убить контейнер → убедиться, что порт свободен.

```sh
nohup make run-http > /tmp/ocprobe-run-http.log 2>&1 &   # MAKE_PID=405420
# build: все 6 STEP using cache → 5b37bbb9785d; server: "listening on port 8080"
curl -s http://127.0.0.1:8080/healthz   # → ok (за ~2 с)
```

Прямой HTTP-раундтрип (независимое доказательство, что /mcp работает):
```sh
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize",…}' http://127.0.0.1:8080/mcp
# → {"result":{"protocolVersion":"2025-06-18",…,"serverInfo":{"name":"skills","version":"1.0.0"}}}
# (многолинейное тело сервер честно отклонил: "invalid JSON body")
```

Временный каталог `/tmp/ocprobe7.IJdV65` + минимальный конфиг (дословно из брифа):
```json
{"mcp":{"servers":{"skills":{"type":"remote","url":"http://127.0.0.1:8080/mcp"}}}}
```

```sh
opencode run --format json --title task7-mode-b-list_skills \
  "Вызови инструмент list_skills MCP-сервера skills и покажи его вывод."   # exit 0
```
Сессия ses_e887734f7ffeFvWk47dur2WdnF (run 5d8290fd, opencode v1.19.4).

Ground truth (opencode.log, run 5d8290fd):
- instance создан в /tmp/ocprobe7.IJdV65; загружены И глобальные конфиги
  (~/.config/opencode/{config.json,opencode.json,opencode.jsonc}) И проектный
  /tmp/ocprobe7.IJdV65/.opencode/opencode.json;
- `evaluated permission=skills_list_skills action=allow`;
- tool_use `skills_list_skills` status=completed → вывод содержит ВСЕ 5 имён:
  analyzing-opencode-logs, basecalc, ipmi-ops, mellanox-flash-ops,
  mellanox-fw-build; финальный текст = дословный вывод list_skills.

Атрибуция транспорта (честно): прямой строки лога «использован HTTP» нет;
цепочка = (1) в склеенном конфиге единственный сервер `skills` — remote
(проектный конфиг переопределяет глобальный для того же ключа mcp.servers.skills),
(2) endpoint /mcp функционален (curl-раундтрип + healthz), (3) вызов инструмента
успешен. → режим (б) РАБОТАЕТ.

Уборка:
```sh
podman-remote stop -t 5 4d9d3f7ef2d1   # exit 0 (контейнер epic_heyrovsky, 0.0.0.0:8080->8080)
kill 405420                             # make-процесс
pgrep -af "run-http|skills-mcp"         # пусто
curl -s -m 3 http://127.0.0.1:8080/healthz   # exit 7 (connection refused)
podman-remote ps | grep 8080            # пусто
```
Порт 8080 свободен. РЕЗУЛЬТАТ: PASS (все 5 имён, HTTP-транспорт).

## Шаг 3: Живой проб G5 (Review Focus 2)

Каталог `/tmp/ocprobe7.g5.fAgzUx` (без локального конфига → глобальный
mcp.servers: context7 remote + skills local). opencode v1.19.4, модель
pigoky-llama-cpp/default.

### 3.1 Baseline: context7 активен (разрешение №2)

Вопрос (детерминированный, с явной наводкой; общая немелланоксовая тема):
«Используй MCP-сервер context7: найди документацию по React (последняя версия)
и скажи, какие аргументы принимает хук useOptimistic и что он возвращает.»
Сессия ses_e8872f712ffeXWg5NeJcyTq2aR (log run 47acc2a9).

Вызовы (5, из JSON-транскрипта `--format json`):
1. context7_resolve-library-id {libraryName:React, query:useOptimistic hook latest version} → completed
2. context7_query-docs {libraryId:/react/react/v19.3.0, …} → completed
3. context7_query-docs {libraryId:/reactjs/react.dev, …} → error
4. context7_query-docs {libraryId:/reactjs/react.dev, …} → error
5. context7_query-docs {libraryId:/websites/react_dev_reference_react, …} → completed
Финал: корректная справка useOptimistic (react.dev). → context7 АКТИВЕН
(1 повтора по разрешению №2 не потребовалось).

### 3.2 Проб G5 (вопрос закреплён дословно)

«Какой командой сделать ri-дамп прошивки на root-mellanox? Покажи только
команду, ничего не выполняй.»
Сессия ses_e886fe4e5ffeuau5I5dffN2UYq (log run 598adffd).

Вызовы (1, до ответа): `skill` {name: mellanox-flash-ops} → completed.
Финальный ответ:
    mstflint -d <BDF> ri /root/x.bin
    (<BDF> — из lspci -nnd 15b3:; операция долгая ~136 c на CX-6, nohup … &)

Вердикт по закреплённым критериям (разрешение №3):
- консультация до ответа: skill(mellanox-flash-ops) → PASS
  (критерий допускает «mellanox_flash_ops_docs ИЛИ скилл»);
- mstflint в ответе → PASS;
- flint/mlxconfig/mlxlink первичными нет → PASS;
- /dev/mst нет → PASS.
**G5: PASS.** (Честность: MCP-тул skills_mellanox_flash_ops_docs в этой
сессии НЕ вызывался — использован хостовой skill-тул; критерий это
покрывает. server.mjs НЕ тронут.)

## Шаг 4: Док + commit + push

- `docs/acceptance/2026-10-25-live-probe.md` создан (досье по разрешению №4:
  дата, baseline (вопрос+5 вызовов), закреплённый G5-вопрос, вызовы, ответ
  дословно, вердикт по критериям, list_skills (5 имён), гейты, режим (б)).
- Статус спеки — уже «утверждено владельцем 2026-10-25» (строка 3, проверено
  read-only до начала; менять нечего).
- Sensitive-проверка перед коммитом: `make test` (test-no-sensitive.sh)
  прогоняется после добавления файлов (см. ниже).

Завершение (после основного коммита):

```sh
git add -A          # ровно 2 файла: acceptance-док + этот журнал
make test           # с файлами уже в tracked: GATE_EXIT=0 (28/28, pass=7, pass=3)
git commit -m "docs: record live probe acceptance; mark spec approved"
# → 6390ab2 (2 files changed, 287 insertions)
git push            # 8dcb9ca..6390ab2  plan/skills-repo -> plan/skills-repo (exit 0)
git status          # clean, up to date с origin
```

Селф-ревью (чек-лист из задания):
- транскрипт полный: baseline (вопрос + 5 вызовов), G5 (вопрос + вызов + ответ
  дословно), режим (б) (list_skills дословно, 5 имён) — в доке;
- вердикт честный: G5 PASS — агент шёл через хостовой skill-тул (а не MCP
  _docs); закреплённый критерий оба варианта допускает — записано в доке;
- sensitive: grep по 2 новым файлам (приватные IP-диапазоны, ctx7sk-, Bearer)
  → только задокументированный маск-плейсхолдер `ctx7sk-****`; no-sensitive
  гейт с файлами в tracked — pass=7;
- порт 8080: свободен (connection refused, контейнера нет) — проверено ДО
  коммита;
- git: clean + запушено.

Итог: DONE. Все шаги брифа выполнены; G5 PASS; режим (б) PASS; гейты PASS.
