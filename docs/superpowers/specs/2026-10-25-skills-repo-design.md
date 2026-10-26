# Дизайн: `skills` — канон-репозиторий opencode-скиллов + общий MCP-сервер

Дата: 2026-10-25. Статус: утверждено владельцем 2026-10-25.

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
2. context7 (remote MCP, общие доки) нужен подключённым, но по
   мелланоксовским темам тащит устаревшие MLNX_OFED-доки и NVIDIA-маркетинг:
   агент ищет `/dev/mst`, лезет в `flint`/`mlxconfig`/`mlxlink` вместо
   `mstflint`/`mstconfig`/`mstlink`. Выверенные скиллы проигрывают общим
   знаниям модели и шуму context7.
3. Per-skill MCP-прототип (`mellanox-flash-ops/mcp/server.mjs`) работает
   (инструмент с description «ALWAYS consult … takes precedence»), но он
   привязан к одному скиллу и необщий.

**Текущее состояние MCP-конфига** (верифицировано): в
`~/.config/opencode/opencode.jsonc` записи `mcp-mlnx` (mellanox-flash-ops) и
`mcp1` (context7) лежат под невалидными ключами — opencode читает только
ключ `mcp` (схема: https://opencode.ai/config.json). То есть активных
MCP-серверов сейчас ноль; context7 отключён намеренно «кривым» именем, чтобы
оставить описание, но не подключать.

Цель: один git-репо (private GitHub) как канон скиллов, общий MCP-сервер,
раздающий контент скиллов (SKILL.md + хелпер-файлы), и один установочный
скрипт на любой хост.

## 2. Цели / не цели

Цели:

- **G1.** Репо `~/git/IMPLEMENTATION/skills` — канон-хранение пяти скиллов
  (SKILL.md + .py), канон-remote — private GitHub-репо (создаётся через
  `gh`, авторизация есть).
- **G2.** Общий MCP-сервер (node, ноль npm-зависимостей): автообнаружение
  каталогов скиллов, по-скилловые инструменты + доступ к файлам; два
  транспорта — stdio и streamable-HTTP.
- **G3.** Сервер в контейнере (containerfile + Makefile, `CRE` по
  no-cre-hardcode); host-specific значения (IP) запекаются в образ через
  gitignore-данный `local.mk`.
- **G4.** Скрипт установки в репо: подготовка `~/.config/opencode/skills/`
  (симлинки/рендер) + идемпотентная запись `mcp`-блока в
  `~/.config/opencode/opencode.jsonc`.
- **G5.** context7 остаётся подключённым (включается переносом записи в
  валидный `mcp`-блок); по нашим темам агент следует нашему MCP (через
  tool description), без переписывания AGENTS.md проектов.
- **G6.** Host-specific значения в контенте скиллов (сейчас — IP-адреса в
  `ipmi-ops/SKILL.md`, 4 вхождения) не коммитятся: выносятся в
  `local.mk`, подставляются при сборке образа и при подготовке хостовой
  копии.

Не цели:

- Публичное распространение / регистры (лаборатория, private git).
- Сервер НЕ исполняет скрипты скиллов — он отдаёт содержимое файлов;
  исполнение на хосте агента.
- Не мигрируем прочие скиллы: `glm-quota`, `irisc-asm` (канон — в репо
  mlxini) остаются как есть.
- Не переписываем AGENTS.md проектов.
- **Скоуп цикла — только текущий хост.** Режим (б) (центральный HTTP-сервер)
  собирается и тестируется, но не деплоится; подключение других хостов
  (root-mellanox, root-bazzite, …) — отдельный будущий цикл.

Anti-goals (условие провала):

- Агент по mstflint/flash-вопросам всё ещё следует context7/MLNX_OFED-докам
  (проверяется живым пробом, §9).
- Тихий дрифт: канон в репо и хостовые копии расходятся.
- IP-адреса/секреты попали в git-историю (предупреждает
  `scripts/test-no-sensitive.sh` в `make test`: значения `local.mk` +
  общий regex частных IP-диапазонов по всем tracked-файлам).
- На (будущем) новом хосте больше двух шагов: clone + `scripts/install.sh`.

## 3. Решения владельца (из обсуждения)

1. Репо: `~/git/IMPLEMENTATION/skills` (имя — `skills`).
2. Сервер читает список каталогов скиллов: список путей из env/арга, по
   умолчанию — каталог `skills/` рядом с сервером. Каталог = скилл, если
   в нём есть SKILL.md. В репо каталоги скиллов — в подкаталоге `skills/`
   (не в корне).
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
7. context7 подключается (валидный `mcp`-блок), но по нашим темам должен
   проигрывать нашим скиллам.
8. Канон-remote — private GitHub-репо, создаётся через `gh`
   (`gh auth status` — авторизован).
9. Скоуп цикла — текущий хост; режим (б) — поддержка + тесты, без деплоя.
10. IP-адреса в скиллах (ipmi-ops) выносятся в gitignore-данный `local.mk`;
    сборка контейнера — через Makefile, подключаящий `local.mk`.

## 4. Раскладка репо

```
~/git/IMPLEMENTATION/skills/
  skills/                    # каталоги скиллов (решение владельца)
    analyzing-opencode-logs/ SKILL.md  oclog.py
    basecalc/                SKILL.md  calc.py
    ipmi-ops/                SKILL.md  sol_bridge.py
    mellanox-flash-ops/      SKILL.md
    mellanox-fw-build/       SKILL.md
  server/
    server.mjs               # MCP-сервер, ноль npm-зависимостей
    test/                    # node --test
  containerfile
  Makefile                   # CRE ?= авто; -include local.mk
  local.mk.example           # в git: имена переменных, плейсхолдер-значения
  local.mk                   # gitignored: реальные значения (IP и пр.)
  .gitignore
  scripts/
    install.sh               # установка на хост (G4)
    test-no-sensitive.sh     # чек: нет чувствительных значений в tracked-файлах (уже в репо)
  docs/
    superpowers/specs/       # этот документ
    reference/               # прототип сервера (см. §8)
  AGENTS.md                  # минимальный: build/test, CRE, english-commits
```

Каталоги скиллов — в подкаталоге `skills/` репо (решение владельца:
монтировать один каталог в контейнер проще). В образе: `server.mjs` →
`/app/server.mjs`, `skills/` → `/app/skills/` — дефолт сканирования
работает и в образе, и в чекауте; монтаж `<repo>/skills` → `/app/skills` —
один том.

## 5. Спецификация MCP-сервера

**Обнаружение:**

- `SKILLS_DIRS` (env, список путей через `:`) или аргумент CLI; по
  умолчанию — подкаталог `skills/` рядом с каталогом, где лежит
  `server.mjs` (в образе: `/app/skills`; в чекауте: `<repo>/skills`).
- Каталог — скилл, если содержит `SKILL.md`; иначе — пропуск + предупреждение
  в stderr.
- Frontmatter `SKILL.md` (`name`, `description`) парсится для описаний.

**Инструменты (одинаковый набор в stdio и http):**

- `list_skills` — таблица: имя, однострочное описание, список файлов.
- `<скилл>_docs` на каждый скилл (имя каталога, `-`→`_`; например
  `mellanox_flash_ops_docs`): опциональный аргумент `section` —
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
  200, для healthcheck контейнера. Auth нет (лабораторная сеть).
- Режим: env `MCP_MODE=stdio|http`, дефолт `stdio`.

**Рендер:** сервер работает с тем, что лежит в его каталогах скиллов. В
образе это отрендеренный контент (заглушки заменены значениями `local.mk`,
см. §6) — MCP раздаёт реальные IP. Заглушки в raw-контенте репо сервером
не обрабатываются.

**Ограничение:** ноль npm-зависимостей (node:fs, node:path, node:http,
node:url). Прототип (`mellanox-flash-ops/mcp/server.mjs`, ~140 строк) —
референсная реализация stdio-части.

## 6. Контейнер и рендер

**Рендер (G6):**

- В контенте скиллов репо host-specific значения — плейсхолдеры
  (синтаксис — выбор билдера, напр. `@IPMI_BMC_AS_R1@`). Сейчас под
  вынос: 4 IP в `ipmi-ops/SKILL.md` (таблица хостов + упоминание asr1 в
  примечании). В `.py`-файлах IP не найдены (проверено).
- `local.mk` (gitignored): make-переменные с реальными значениями;
  `local.mk.example` (в git): те же имена, без реальных значений.
- `Makefile`: `-include local.mk`. Одна рендер-функция (make/node) — два
  потребителя:
  1. **build context**: отрендеренные каталоги скиллов + `server.mjs` в
     временный каталог сборки, из него — `$(CRE) build`;
  2. **хостовая копия**: `scripts/install.sh` (или вызываемая им make-цель)
     рендерит копии для скиллов с плейсхолдерами.
- Плейсхолдер без значения в `local.mk` (не задана/пустая переменная) —
  ошибка сборки с указанием имени (тихая пустая подстановка запрещена).

**containerfile:** `FROM quay.io/fedora/nodejs-22:latest` (Fedora 44 с
node v22 — решение владельца, 2026-10-26), COPY `server/server.mjs` +
(отрендеренные) каталоги скиллов в `/app` (раскладка 1:1 с чекаутом),
`WORKDIR /app`, `EXPOSE 8080`, `CMD ["node", "server/server.mjs"]`
(stdio-дефолт).

**Makefile:** `CRE ?= podman` с автопереключением на `podman-remote`, если
существует `/run/.containerenv` (no-cre-hardcode). Цели:

- `build` — образ (имя, напр. `skills-mcp:local`, — выбор билдера);
- `test` — `node --test` (сервер + рендер, без контейнера) +
  `scripts/test-no-sensitive.sh` (запускается из Makefile; проверка, что
  значений `local.mk` и частных IP нет в tracked-файлах);
- `smoke` — поднять контейнер (stdio), отправить `initialize` +
  `tools/list`, проверить ожидаемый набор инструментов;
- `run-http` — `$(CRE) run --rm -p 8080:8080 -e MCP_MODE=http <образ>`.

## 7. Установка на хост (`scripts/install.sh`)

Запускается из чекаута репо на целевом хосте:

1. Проверка: node, git, инструмент CRE, `local.mk` существует и даёт
   значения на все плейсхолдеры.
2. Для каждого скилла:
   - без плейсхолдеров: `mkdir -p ~/.config/opencode/skills/<имя>`;
     `ln -sf <репо>/skills/<имя>/SKILL.md ~/.config/opencode/skills/<имя>/SKILL.md`
     (паттерн irisc-asm). Если на месте цели уже лежит обычный файл
     (до-миграционное состояние) — скрипт ошибается с подсказкой про
     одноразовую миграцию (§8): install.sh ничего не удаляет, rm в скриптах
     нет (safe-rm не портируется).
   - с плейсхолдерами (сейчас: `ipmi-ops`): отрендеренная обычная копия
     `SKILL.md` в `~/.config/opencode/skills/<имя>/` + md5-контроль
     (fallback-паттерн irisc-asm: после обновления репо-файла/`local.mk`
     перезапустить установку и сверить md5).
   - `.py`-хелперы на хост не кладутся (распространяются через MCP,
     `skill_file`; fallback — сам чекаут репо на хосте).
3. `opencode.jsonc` — идемпотентно вписать/обновить `mcp`-блок (механика —
   выбор билдера, например node: strip-комментарии → JSON.parse → заменить
   ключ → записать). Формат — современный, по схеме
   https://opencode.ai/config.json:

   ```jsonc
   "mcp": {
     "servers": {
       "skills": {
         "type": "local",
         "command": ["<CRE>", "run", "--rm", "-i", "<образ>"]
       }
     }
   }
   ```

   - режим (а) — по умолчанию (local-команда с `CRE`);
   - режим (б): если задан `SKILLS_MCP_URL` — вместо/вместе с ним
     `{ "type": "remote", "url": "<SKILLS_MCP_URL>" }`.
   - Существующие невалидные ключи (`mcp-mlnx`, `mcp1`) скрипт не трогает —
     их очистка входит в одноразовую миграцию (§8).
4. Смоук: `make smoke` (или прямой JSON-RPC-хендшейк с контейнером).

## 8. Одноразовая миграция (текущий хост)

1. Скопировать пять каталогов из `~/.config/opencode/skills/` в репо,
   исключая `mellanox-flash-ops/mcp/` и `SKILL.md-old`. Прототип
   `mcp/server.mjs` сохранить в репо как `docs/reference/` (референс, не
   исполняемый код) — иначе он пропадёт при замене каталога.
2. `ipmi-ops/SKILL.md`: заменить 4 IP на плейсхолдеры; значения — в
   `local.mk` (gitignored), имена — в `local.mk.example`.
3. Обновить SKILL.md, где скрипты вызываются по локальному пути скилла:
   скрипты берутся через `skill_file` (fallback — чекаут репо на хосте).
   .py проверить на CWD-независимость (пути относительно себя), при
   необходимости поправить.
4. GitHub: `gh repo create` (private) + `git remote add origin` + push.
5. Начальный коммит с контентом; `make build`; ручная замена старых обычных
   файлов в `~/.config/opencode/skills/<имя>/` на симлинки (контент уже
   сохранён в git; скрипты замену не делают, rm не используют);
   `scripts/install.sh`.
6. Очистка `opencode.jsonc`: удалить невалидные ключи `mcp-mlnx` и
   `mcp1`; перенести запись context7 из `mcp1` в `mcp.servers.context7`
   (type remote, url, headers) — context7 становится активным.
7. Проверка: механическая (§9.1) + живой проб (§9.2).

## 9. Тесты и критерии готовности

**9.1 Механика:**

- `server/test/` (`node --test`):
  - обнаружение: дефолтный каталог, `SKILLS_DIRS`, пропуск нескилловых;
  - `tools/list` — ожидаемый набор;
  - `tools/call <скилл>_docs` — полный текст / секция / промах со списком
    секций;
  - `skill_file` — обычный случай, выход через `..` → ошибка, бинарный →
      ошибка;
  - `resources/list` / `resources/read`;
  - http: `POST /mcp` (initialize + tools/list + tools/call), `/healthz`;
  - рендер: подстановка по `local.mk`; плейсхолдер без значения → ошибка;
  - `scripts/test-no-sensitive.sh` (уже в репо): значения `local.mk` и
    частные IP-диапазоны не встречаются в tracked-файлах (часть `make test`).
- `make smoke` — живой контейнер (stdio-хендшейк).
- В живой opencode-сессии: все пять скиллов в `available_skills`,
  инструменты сервера отвечают, `mellanox_flash_ops_docs` отдаёт отрендеренный
  текст; context7 активен.
- CI нет (лабораторное репо).

**9.2 Живой проб G5** (принято координатором): новая opencode-сессия,
context7 включён, реальный mstflint-вопрос (напр. «сделай ri-дамп прошивки
на root-mellanox»). Проход: агент консультирует наши инструменты
(`mellanox_flash_ops_docs` и/или скилл) и не следует MLNX_OFED/legacy-докам
(нет `/dev/mst`, нет `flint`/`mlxconfig`/`mlxlink` как первичных).
Провал: доложить владельцу, крутить формулировки description (допустимо,
малый скоуп); цикл не считается провалившимся автоматически.

## 10. Оставлено на выбор билдера

- Точная форма streamable-HTTP-ответов, которую требует opencode (сверить
  на живой сессии, референс — context7).
- Тег node-образа, имя образа.
- Точные формулировки «takes precedence»-суффиксов.
- Механика JSONC-патча (сохранение комментариев/форматирования).
- Синтаксис плейсхолдеров и механизм рендера (sed/node, единая функция для
  build context и хостовой копии).
- CWD-независимость .py (проверить, при необходимости поправить).
- Делать ли `git pull` внутри install.sh (рабочий вариант: скрипт работает
  из чекаута; на новом хосте — clone + install.sh).

## 11. Референсы

- Прототип: `~/.config/opencode/skills/mellanox-flash-ops/mcp/server.mjs`
  (до миграции; после — `docs/reference/` в репо).
- Паттерн irisc-asm: `mlxini/skills/irisc-asm/SKILL.md` (симлинк +
  восстановление из git; fallback — копия + md5-сверка).
- Текущая конфига: `~/.config/opencode/opencode.jsonc`; схема —
  https://opencode.ai/config.json (ключ `mcp`, подблок `servers`;
  local: type+command, remote: type+url+headers; плоская форма
  `mcp: {<name>: …}` — deprecated).
- Правила no-cre-hardcode, english-commits — из `AGENTS.md` mlxini;
  портируются в AGENTS.md нового репо (rm-rf-guard/safe-rm не портируются:
  rm в наших скриптах нет).
- `scripts/test-no-sensitive.sh` — портирован из параллельного проекта
  (уже в репо); запускается из Makefile (`make test`).
- GitHub: `gh auth status` — авторизован; репо создаётся при миграции.
