# Живой проб приёмки (G5) + живой чек режима (б)

- Дата проба: 2026-10-26 (UTC-время сессий — из логов opencode).
- План/спека: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 7;
  `docs/superpowers/specs/2026-10-25-skills-repo-design.md`
  (статус: утверждено владельцем 2026-10-25).
- Окружение: opencode v1.19.4, модель `pigoky-llama-cpp/default` (локальный
  llama.cpp), CRE=podman-remote, образ `skills-mcp:local`
  (digest-шапка `5b37bbb9785d`), node v22.22.2.
- Конфиг `~/.config/opencode/opencode.jsonc` → `mcp.servers`:
  - `context7`: remote, `https://mcp.context7.com/mcp`, Bearer-токен в headers
    (в этом доке токен НЕ приводится);
  - `skills`: local, `podman-remote run --rm -i skills-mcp:local`.
- Маскировка: реальные IP хостов/BMC в док не вносятся; алиасы хостов
  (root-mellanox и т.п.) — допустимо и приведены.

## Шаг 1 — полный гейт (fresh, перед живыми пробами)

```
make test  → exit 0: node --test 28/28 pass; no-sensitive pass=7; render pass=3
make smoke → exit 0: build (all cached, 5b37bbb9785d) → smoke-ok
```

## Шаг 2 — живой чек режима (б): remote/HTTP-транспорт с реальным клиентом

Цель (Review Focus 1): доказать, что opencode-клиент работает с MCP-сервером
`skills` по HTTP (не только stdio в контейнере).

1. `make run-http` в фоне (make-PID 405420): контейнер
   `podman-remote run --rm -p 8080:8080 -e MCP_MODE=http skills-mcp:local`
   (id `4d9d3f7ef2d1`, порт `0.0.0.0:8080->8080/tcp`); сервер:
   «listening on port 8080». `GET /healthz` → `ok`.
2. Независимое доказательство работоспособности HTTP-endpoint:
   `POST /mcp` `initialize` (curl) → JSON-RPC-ответ
   `serverInfo: {"name":"skills","version":"1.0.0"}`.
3. Временный каталог `/tmp/ocprobe7.IJdV65` с минимальным конфигом
   `.opencode/opencode.json` (дословно из плана):
   `{"mcp":{"servers":{"skills":{"type":"remote","url":"http://127.0.0.1:8080/mcp"}}}}`
4. Из этого каталога (сессия `ses_e887734f7ffeFvWk47dur2WdnF`, opencode log
   run `5d8290fd`):
   Вопрос (закреплён планом):
   «Вызови инструмент list_skills MCP-сервера skills и покажи его вывод.»
   Вызов инструмента: `skills_list_skills` (status=completed).
   Вывод (дословно, все 5 имён):

```
analyzing-opencode-logs — Use when finding, extracting, or verifying content from opencode session logs or transcripts — a finding or conclusion is missing from a report, an investigation seems "lost" after compaction, a message must be recovered by msg_id, or auditing what a session actually concluded (files: oclog.py, SKILL.md)
basecalc — Use when computing arithmetic or bitwise operations on numbers in mixed bases, or converting between bases — hex (0x), decimal, octal (0o, leading-0), binary (0b, trailing-b) — e.g. register offsets, address math, bit masks, firmware addresses, "what is 0x1E5 minus 0x20". (files: calc.py, SKILL.md)
ipmi-ops — Use when working with a server BMC over IPMI — power status/on/off, mc info, SOL (serial-over-LAN) console capture or key injection, rebooting a hung or live host through the BMC, "SOL session closed by BMC", "SOL payload already active", tcgetattr, lab BMCs with IP/L/P creds files. (files: SKILL.md, sol_bridge.py)
mellanox-flash-ops — Use when running mstflint flash operations (ri/rb dumps, dc, q, burn, activating the new FW after burn via mstfwreset) on Mellanox/ConnectX cards over ssh — long-running flash ops, "Flash semaphore" errors, flint_oem write-protect, hosts without mst service (root-mellanox, root-bazzite), burn flag/mode selection for modified images ("The Digest in the signature is wrong", --no_fw_ctrl vs --nofs/-ocr legacy). (files: SKILL.md)
mellanox-fw-build — Use when building or customizing Mellanox ConnectX firmware images offline — patching ini/config sections of a base .bin, adding a build identifier to 0x30 DBG_FW_INI, embedding GUID/MAC into an image before a burn, or running offline image verify gates (mlxini, mstflint -i verify). (files: SKILL.md)
```

5. Уборка: `podman-remote stop 4d9d3f7ef2d1` (exit 0), make-PID убит;
   `GET /healthz` → connection refused; в `podman-remote ps` контейнера на
   8080 нет — порт свободен.

Атрибуция транспорта (честно): прямой строки «использован HTTP» в логе
opencode нет. Цепочка доказательств: в склеенном конфиге единственный сервер
`skills` — remote (проектный конфиг переопределяет глобальный для того же
ключа `mcp.servers.skills` — в логе видна загрузка и глобальных, и проектного
конфига); endpoint функционален (пункт 2); вызов `skills_list_skills`
успешен. → **РЕЗУЛЬТАТ: PASS** (все 5 имён; HTTP-транспорт с реальным
клиентом работает).

## Шаг 3 — живой проб G5

### 3.1 Предпроверка: context7 активен

Свежая сессия (каталог `/tmp/ocprobe7.g5.fAgzUx`, без локального конфига —
действует глобальный `mcp.servers`; сессия `ses_e8872f712ffeXWg5NeJcyTq2aR`,
log run `47acc2a9`). Вопрос (выбран для детерминированности — явная
наводка на context7; общая немелланоксовая тема):

«Используй MCP-сервер context7: найди документацию по React (последняя версия)
и скажи, какие аргументы принимает хук useOptimistic и что он возвращает.»

Вызовы инструментов (5):

| # | инструмент | input (кратко) | статус |
|---|---|---|---|
| 1 | `context7_resolve-library-id` | `{"libraryName":"React","query":"useOptimistic hook latest version"}` | completed |
| 2 | `context7_query-docs` | `{"libraryId":"/react/react/v19.3.0","query":"useOptimistic hook signature arguments and return value",…}` | completed |
| 3 | `context7_query-docs` | `{"libraryId":"/reactjs/react.dev","query":"useOptimistic API reference: …"}` | error |
| 4 | `context7_query-docs` | `{"libraryId":"/reactjs/react.dev","query":"useOptimistic hook reference"}` | error |
| 5 | `context7_query-docs` | `{"libraryId":"/websites/react_dev_reference_react","query":"useOptimistic hook reference: …"}` | completed |

Финальный ответ — корректная справка по `useOptimistic` со ссылками на
react.dev (аргументы `initialState`/`reduce`, возвращаемый тупл
`[optimisticState, setOptimisticState]`). → **context7 активен**
(удалось и resolve, и query-docs; после 2 ошибок по неверному libraryId
агент сам перешёл на рабочий).

### 3.2 Проб G5 (вопрос закреплён планом)

Свежая сессия (тот же каталог; сессия `ses_e886fe4e5ffeuau5I5dffN2UYq`,
log run `598adffd`). Вопрос дословно:

«Какой командой сделать ri-дамп прошивки на root-mellanox? Покажи только
команду, ничего не выполняй.»

Вызовы инструментов (1, до ответа):

| # | инструмент | input | статус |
|---|---|---|---|
| 1 | `skill` | `{"name":"mellanox-flash-ops"}` | completed |

Финальный ответ (дословно):

```sh
mstflint -d <BDF> ri /root/x.bin
```

`<BDF>` — из `lspci -nnd 15b3:` (mst-сервиса нет, адресация напрямую по PCI
BDF). Операция долгая (~136 с на CX-6) и молчит до конца — запускать в фоне
с `nohup … &`.

### 3.3 Вердикт G5 (критерии закреплены планом)

| Критерий | Факт | |
|---|---|---|
| Агент консультирует `mellanox_flash_ops_docs` (ИЛИ скилл mellanox-flash-ops) до ответа | вызов `skill` → `mellanox-flash-ops` сделан до ответа | PASS |
| В ответе — `mstflint` | `mstflint -d <BDF> ri /root/x.bin` | PASS |
| Нет `flint`/`mlxconfig`/`mlxlink` как первичных команд | первичная команда — `mstflint`; `flint`/`mlxconfig`/`mlxlink` отсутствуют | PASS |
| Нет `/dev/mst` | адресация по PCI BDF (`lspci -nnd 15b3:`), `/dev/mst` в ответе нет | PASS |

**Вердикт: PASS.**

Замечание (честность транскрипта): агент использовал хостовой инструмент
`skill` (загрузка `SKILL.md` скилла из `~/.config/opencode/skills/`), а не
MCP-инструмент `skills_mellanox_flash_ops_docs`. Закреплённый критерий явно
допускает оба варианта («…(или скилл mellanox-flash-ops)»). На MCP-инструмент
`_docs` в этой сессии агент не ходил; context7-инструменты в пробах G5 не
вызывались (не требуется — тема закрыта скиллом).

## Итог

| Шаг | Результат |
|---|---|
| 1. `make test` + `make smoke` | PASS (28/28, smoke-ok) |
| 2. Режим (б): HTTP-транспорт + 5 имён list_skills | PASS |
| 3.1 context7 активен (baseline) | PASS |
| 3.2–3.3 Проб G5 | PASS |

Приёмка пройдена.
