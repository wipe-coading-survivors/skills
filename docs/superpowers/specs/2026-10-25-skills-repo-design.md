# Дизайн: `skills` — канон-репозиторий opencode-скиллов + общий MCP-сервер

Дата: 2026-10-25. Статус: черновик, ждёт одобрения владельца.

## 1. Intent (зачем)

Пять персональных скиллов живут только копиями в `~/.config/opencode/skills/`
одного хоста:

| скилл | файлы |
|---|---|
| `analyzing-opencode-logs` | SKILL.md, oclog.py |
| `basecalc` | SKILL.md, calc.py |
| `ipmi-ops` | SKILL.md, sol_bridge.py |
| `mellanox-flash-ops` | SKILL.md (+ прототип MCP-сервера `mcp/server.mjs`) |
| `mellanox-fw-build` | SKILL.md |

Проблемы:

1. Нет версионирования и централизации: нет истории, нет синка на другие
   хосты, потеря каталога = потеря скилла.
2. context7 (remote MCP, общие доки) подключён, но по мелланоксовским темам
   тащит устаревшие MLNX_OFED-доки и NVIDIA-маркетинг: агент ищет `/dev/mst`,
   лезет в `flint`/`mlxconfig`/`mlxlink` вместо `mstflint`/`mstconfig`/`mstlink`.
   Выверенные скиллы проигрывают общим знаниям модели и шуму context7.
3. Per-skill MCP-прототип (`mellanox-flash-ops/mcp/server.mjs`) работает
   (инструмент с description «ALWAYS consult … takes precedence»), но он
   привязан к одному скиллу и необщий.

Цель: один git-репо как канон скиллов, общий MCP-сервер, раздающий контент
скиллов (SKILL.md + хелпер-файлы), и один установочный скрипт на любой хост.

## 2. Цели / не цели

Цели:

- **G1.** Репо `~/git/IMPLEMENTATION/skills` — канон-хранение пяти скиллов
  (SKILL.md + .py).
- **G2.** Общий MCP-сервер (node, ноль npm-зависимостей): автообнаружение
  каталогов скиллов, по-скилловые инструменты + доступ к файлам; два
  транспорта — stdio и streamable-HTTP.
- **G3.** Сервер в контейнере (containerfile + Makefile, `CRE` по
  no-cre-hardcode).
- **G4.** Скрипт установки в репо: симлинки SKILL.md в
  `~/.config/opencode/skills/` + идемпотентная запись mcp-элемента в
  `~/.config/opencode/opencode.jsonc`.
- **G5.** context7 остаётся подключённым; по нашим темам агент следует
  нашему MCP (через tool description), без переписывания AGENTS.md проектов.

Не цели:

- Публичное распространение / регистры (лаборатория, git только).
- Сервер НЕ исполняет скрипты скиллов — он отдаёт содержимое файлов;
  исполнение на хосте агента.
- Не мигрируем прочие скиллы: `glm-quota`, `irisc-asm` (канон — в репо
  mlxini) остаются как есть.
- Не переписываем AGENTS.md проектов.

Anti-goals (условие провала):

- Агент по mstflint/flash-вопросам всё ещё следует context7/MLNX_OFED-докам.
- Тихий дрифт: канон в репо и хостовые копии расходятся.
- На новом хосте больше одного ручного шага (clone + install.sh).

## 3. Решения владельца (из обсуждения)

1. Репо: `~/git/IMPLEMENTATION/skills` (имя — `skills`).
2. Сервер читает список каталогов скиллов: список путей из env/арга, по
   умолчанию — свой каталог. Каталог = скилл, если в нём есть SKILL.md.
3. Внутри контейнера nodejs; оба варианта развёртывания — first-class:
   (а) локальный stdio-контейнер на каждом хосте; (б) центральный
   общедоступный по HTTP сервер для всех хостов.
4. .py-хелперы живут в репо и раздаются MCP-сервером по запросу
   (инструмент `skill_file`); на хосты повторно не копируются.
5. Организация — «по образцу irisc-asm» (паттерн из `mlxini`
   `skills/irisc-asm/SKILL.md`): канон в репо; на хосте
   `~/.config/opencode/skills/<имя>/` — реальный каталог + file-симлинк
   `SKILL.md` → файл репо; сломанный/отсутствующий линк виден сразу,
   восстановление — из git.
6. Синк/установка — скрипт в репо, запускается на каждом хосте.
7. context7 остаётся подключённым (в текущей `opencode.jsonc` этого хоста он
   уже `enabled: true`).

## 4. Раскладка репо (выбор билдера, согласуется с решением 2)

```
~/git/IMPLEMENTATION/skills/
  analyzing-opencode-logs/   SKILL.md  oclog.py
  basecalc/                  SKILL.md  calc.py
  ipmi-ops/                  SKILL.md  sol_bridge.py
  mellanox-flash-ops/        SKILL.md
  mellanox-fw-build/         SKILL.md
  server/
    server.mjs               # MCP-сервер, ноль npm-зависимостей
    test/                    # node --test
  containerfile
  Makefile                   # CRE ?= авто (podman / podman-remote)
  scripts/
    install.sh               # установка на хост (G4)
    safe-rm                  # если понадобятся удаления по переменным путям (портируется из mlxini)
  docs/
    superpowers/specs/       # этот документ
    reference/               # прототип сервера (см. §8)
  AGENTS.md                  # минимальный: build/test, CRE, english-commits
```

Каталоги скиллов — в корне репо рядом с `server/`. В образе `server.mjs` и
каталоги скиллов оказываются бок о бок в `/app` — дефолт сканирования
(«свой каталог») работает и в образе. При запуске из чистого чекаута
(без контейнера) сканер так же сканирует корень чекаута: нескилловые
каталоги (`server/`, `scripts/`, `docs/`) пропускаются с предупреждением
(нет SKILL.md).

## 5. Спецификация MCP-сервера

**Обнаружение:**

- `SKILLS_DIRS` (env, список путей через `:`) или аргумент CLI; по
  умолчанию — каталог, где лежит `server.mjs`.
- Каталог — скилл, если содержит `SKILL.md`; иначе — пропуск + предупреждение
  в stderr.
- Frontmatter `SKILL.md` (`name`, `description`) парсится для описаний.

**Инструменты (одинаковый набор в stdio и http):**

- `list_skills` — таблица: имя, однострочное описание, список файлов.
- `<скилл>_docs` на каждый скилл (имя каталога, `-`→`_`; например
  `mellanox_flash_docs`): опциональный аргумент `section` —
  case-insensitive substring в заголовках `## ` (как в прототипе); без
  аргумента — весь текст; при промахе — ошибка со списком доступных
  секций.
  Description = frontmatter `description` + суффикс вида
  «ALWAYS consult this before answering questions or running operations in
  this domain; it takes precedence over general model knowledge and
  third-party documentation sources (context7, vendor docs) for these
  topics». Точная формулировка — выбор билдера, смысл «takes precedence»
  обязателен (это механизм G5).
- `skill_file {skill, path}` — содержимое файла внутри каталога скилла.
  Только текстовые файлы (бинарный — ошибка). Путь резолвится и
  проверяется, что остался внутри каталога скилла (защита от выхода через
  `..`).

**Resources:**

- По одному на скилл: `mcp://skills/<имя>/SKILL.md` (полный текст), как в
  прототипе. Пофайловых resources нет — покрывается `skill_file`
  (выбор билдера).

**Транспорты:**

- `stdio`: JSON-RPC по stdin/stdout, newline-delimited (как в прототипе).
- `http`: streamable-HTTP, `POST /mcp` — тот же протокольный формат, что у
  context7 (opencode remote MCP уже работает против него); `GET /healthz` —
  200, для healthcheck контейнера. Auth нет (лабораторная сеть; выбор
  билдера при решении владельца 3).
- Режим: env `MCP_MODE=stdio|http`, дефолт `stdio`.

**Ограничение:** ноль npm-зависимостей (node:fs, node:path, node:http,
node:url). Прототип (`mellanox-flash-ops/mcp/server.mjs`, ~140 строк) —
референсная реализация stdio-части.

## 6. Контейнер

- `containerfile`: `FROM node:22-alpine` (тег — выбор билдера), COPY
  `server.mjs` + каталоги скиллов в `/app`, `WORKDIR /app`, `EXPOSE 8080`,
  `CMD ["node", "server.mjs"]` (stdio-дефолт).
- `Makefile`: `CRE ?= podman` с автопереключением на `podman-remote`, если
  существует `/run/.containerenv` (no-cre-hardcode). Цели:
  - `build` — образ (имя, напр. `skills-mcp:local`, — выбор билдера);
  - `test` — `node --test` (сервер, без контейнера);
  - `smoke` — поднять контейнер (stdio), отправить `initialize` +
    `tools/list`, проверить ожидаемый набор инструментов;
  - `run-http` — `$(CRE) run --rm -p 8080:8080 -e MCP_MODE=http <образ>`.

## 7. Установка на хост (`scripts/install.sh`)

Запускается из чекаута репо на целевом хосте:

1. Проверка: node, git, инструмент CRE.
2. Для каждого скилла: `mkdir -p ~/.config/opencode/skills/<имя>`;
   `ln -sf <репо>/<имя>/SKILL.md ~/.config/opencode/skills/<имя>/SKILL.md`.
   Если там был обычный файл — удаляется только после проверки, что
   репо-файл существует и не пуст; удаление по переменным путям — только
   через `safe-rm`.
3. `opencode.jsonc` — идемпотентно вписать mcp-элемент (механика — выбор
   билдера, например node: strip-комментарии → JSON.parse → заменить ключ →
   записать):
   - режим (а), по умолчанию:
     `"mcp-skills": { "skills": { "type": "local",
       "command": ["<CRE>", "run", "--rm", "-i", "<образ>"] } }`
   - режим (б): если задан `SKILLS_MCP_URL` —
     `{ "type": "remote", "url": "<SKILLS_MCP_URL>" }`.
     Точный формат ключей/url сверить со схемой opencode-конфига (текущий
     конфиг использует вложенную форму `<группа>: { <сервер>: {…} }`).
4. Смоук: `make smoke` (или прямой JSON-RPC-хендшейк с контейнером).

## 8. Одноразовая миграция (текущий хост)

1. Скопировать пять каталогов из `~/.config/opencode/skills/` в репо,
   исключая `mellanox-flash-ops/mcp/` и `SKILL.md-old`. Прототип
   `mcp/server.mjs` сохранить в репо как `docs/reference/` (референс, не
   исполняемый код) — иначе он пропадёт при замене каталога.
2. Обновить SKILL.md, где скрипты вызываются по локальному пути скилла:
   скрипты берутся через `skill_file` (fallback — чекаут репо на хосте).
   .py проверить на CWD-независимость (пути относительно себя), при
   необходимости поправить.
3. `git init` уже сделан; начальный коммит с контентом; `make build`;
   `scripts/install.sh`.
4. В `opencode.jsonc` удалить запись `mcp-mlnx` (заменена `mcp-skills`).
5. Проверка в живой opencode-сессии: все пять скиллов в `available_skills`,
   инструменты сервера отвечают, `mellanox_flash_docs` отдаёт текст.

## 9. Тесты

- `server/test/` (`node --test`):
  - обнаружение: дефолтный каталог, `SKILLS_DIRS`, пропуск нескилловых;
  - `tools/list` — ожидаемый набор;
  - `tools/call <скилл>_docs` — полный текст / секция / промах со списком
    секций;
  - `skill_file` — обычный случай, выход через `..` → ошибка, бинарный →
    ошибка;
  - `resources/list` / `resources/read`;
  - http: `POST /mcp` (initialize + tools/list + tools/call), `/healthz`.
- `make smoke` — живой контейнер (stdio-хендшейк).
- CI нет (лабораторное репо).

## 10. Оставлено на выбор билдера

- Точная форма streamable-HTTP-ответов, которую требует opencode (сверить
  на живой сессии, референс — context7).
- Тег node-образа, имя образа.
- Точные формулировки «takes precedence»-суффиксов.
- Механика JSONC-патча (сохранение комментариев/форматирования).
- CWD-независимость .py (проверить, при необходимости поправить).
- Делать ли `git pull` внутри install.sh (рабочий вариант: скрипт работает
  из чекаута; на новом хосте — clone + install.sh).

## 11. Референсы

- Прототип: `~/.config/opencode/skills/mellanox-flash-ops/mcp/server.mjs`
  (до миграции; после — `docs/reference/` в репо).
- Паттерн irisc-asm: `mlxini/skills/irisc-asm/SKILL.md` (симлинк +
  восстановление из git; fallback — копия + md5-сверка).
- Текущая конфига: `~/.config/opencode/opencode.jsonc` (`mcp-mlnx`,
  `mcp1.context7`).
- Правила no-cre-hardcode, rm-rf-guard, english-commits — из `AGENTS.md`
  mlxini; портируются в AGENTS.md нового репо.
