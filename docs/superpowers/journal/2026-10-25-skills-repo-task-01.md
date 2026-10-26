# Журнал: Task 1 — скелет репо + миграция контента скиллов

План: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 1.
Бриф: `.superpowers/sdd/2026-10-25-skills-repo/task-1-brief.md`.
Рабочая ветка: `plan/skills-repo`. Источник (read-only): `~/.config/opencode/skills/`.

## Pre-check (до шага 1)

- `git status`: ветка `plan/skills-repo`, в репо только `docs/` +
  `scripts/test-no-sensitive.sh`; НЕЗАКРЕПЛЁННОЕ изменение в
  `docs/superpowers/plans/2026-10-25-skills-repo.md` (строчка `.superpowers/`
  в блоке .gitignore шага 3 — правка контроллера, внесена до старта задачи).
  Бриф требует `git add -A` на шаге 7 — правка попадёт в коммит; отмечено в
  отчёте.
- Grep tracked-файлов по приватным IP-диапазонам: нет совпадений (rc=123) —
  базовая часть test-no-sensitive.sh проходит до миграции.
- `SKILL.md-old` (mellanox-flash-ops): приватных IP нет (grep -c = 0) —
  трекинг безопасен.
- `python3` 3.14.4 доступен — шаг 5 (прогон .py из /tmp) исполним.
- Источник ipmi-ops/SKILL.md: таблица хостов (строки root-mellanox /
  root-bazzite / root-asr1, колонки host/BMC) + упоминание asr1 в примечании
  (§ SOL, «asr1 (…): F2 spam at POST») — 6 IP-литералов, 5 уникальных + 1
  повтор (BMC asr1 в таблице и в примечании).

## Разбор расхождений брифа (решено контроллером)

- Бриф шаг 1: `rm -f skills/mellanox-flash-ops/SKILL.md-old`; контроллер
  (res. 4): SKILL.md-old **сохраняется**. Действую по решению контроллера:
  каталог копируется целиком, исключая `mcp/`.
- local.mk (res. 2): ровно 6 переменных, реальные значения из таблицы
  исходного SKILL.md (значения в этом журнале не приводятся — файл tracked).

## Шаг 1: копирование контента

```sh
mkdir -p skills docs/reference
for d in analyzing-opencode-logs basecalc ipmi-ops mellanox-flash-ops mellanox-fw-build; do
  cp -a ~/.config/opencode/skills/$d skills/$d
done
rm -rf skills/mellanox-flash-ops/mcp
cp ~/.config/opencode/skills/mellanox-flash-ops/mcp/server.mjs \
   docs/reference/mellanox-flash-ops-prototype.mjs
```

- `rm -rf skills/mellanox-flash-ops/mcp` — литеральный путь в свежем чекауте
  (разрешено правилом; мcp-прототип заменён новым сервером в поздней задаче).
- `rm -f skills/mellanox-flash-ops/SKILL.md-old` из брифа — НЕ выполнен по
  решению контроллера (res. 4): SKILL.md-old сохранён.
- Проверка: `diff -r` источник↔копия — идентично, кроме намеренно удалённого
  `mcp/`; `server.mjs` ↔ `docs/reference/mellanox-flash-ops-prototype.mjs`
  идентичны (diff пуст).
- Результат: 10 файлов (5 SKILL.md + SKILL.md-old + oclog.py + calc.py +
  sol_bridge.py + prototype.mjs).

## Шаг 2: плейсхолдеры в skills/ipmi-ops/SKILL.md

Маппинг по заголовкам таблицы (2-я колонка = host → `*_HOST`, 3-я = BMC →
`*_BMC`):

- строки таблицы root-mellanox / root-bazzite / root-asr1 — host- и BMC-IP →
  `@IPMI_MELLANOX_HOST@`, `@IPMI_MELLANOX_BMC@`, `@IPMI_BAZZITE_HOST@`,
  `@IPMI_BAZZITE_BMC@`, `@IPMI_ASR1_HOST@`, `@IPMI_ASR1_BMC@`;
- примечание «asr1 (…): F2 spam at POST» — BMC asr1 → `@IPMI_ASR1_BMC@`.

Проверка: `grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}'` по файлу — 0 совпадений
(rc=1); 6 уникальных плейсхолдеров, `@IPMI_ASR1_BMC@` ×2 (таблица +
примечание).

## Шаг 3: local.mk / local.mk.example / .gitignore

- `local.mk.example`: 6 переменных `:= 192.0.2.101…192.0.2.106` (RFC 5737,
  по порядку имён).
- `local.mk` (gitignored): те же 6 имён, реальные значения из таблицы
  исходного SKILL.md (res. 2; цифры в журнале не приводятся — файл tracked).
- `.gitignore`: ровно 3 строки — `local.mk`, `.build/`, `.superpowers/`.

Проверка: `git check-ignore -v` — `local.mk` → строка 1, `.superpowers/` →
строка 3; `git status --porcelain` — ни local.mk, ни .superpowers/ в списке.

## Шаг 4: AGENTS.md

Создан: `make test` — гейт коммита (node --test, render, test-no-sensitive),
`make build`/`make smoke`, no-cre-hardcode, english-commits,
no-inline-comments, запрет rm в скриптах репо, чувствительные значения —
только в gitignored local.mk (проверка test-no-sensitive.sh).

## Шаг 5: SKILL.md про .py-хелперы

Заменены локальные пути на provenance-формулировку (по брифу; файлы
англоязычные — формулировка на английском):

- `skills/analyzing-opencode-logs/SKILL.md`: «`oclog.py` next to this file» →
  «fetched from the MCP server via the `skill_file(analyzing-opencode-logs,
  oclog.py)` tool (fallback: a checkout of this repo)».
- `skills/basecalc/SKILL.md`: «(in the directory of this SKILL.md)» →
  та же формулировка с `skill_file(basecalc, calc.py)`; в блоке Run
  `python3 <skill_dir>/calc.py` → `python3 calc.py`.
- `skills/ipmi-ops/SKILL.md`: «(next to this SKILL.md)» → та же формулировка
  с `skill_file(ipmi-ops, sol_bridge.py)`; в launch-блоке
  `~/.config/opencode/skills/ipmi-ops/sol_bridge.py` → `sol_bridge.py`.

CWD-независимость (grep `__file__|open(|os.path|chdir` по skills/*.py):
- `__file__` ни в одном скрипте нет;
- oclog.py — все пути из CLI-аргументов либо абсолютные (`expanduser`);
- sol_bridge.py — только argv + env;
- calc.py — файловых операций нет.
Проблем не найдено — правки .py не требовались.

Прогон из /tmp (python3 3.14.4):
- `oclog.py --help` → usage, rc=0;
- `calc.py` (без аргументов) → usage, rc=2 (задумано: «nothing to do»);
  `calc.py --selftest` → `selftest: 32 ok`, rc=0;
- `sol_bridge.py` (без аргументов) → IndexError на `sys.argv[1]`, rc=1 —
  прежнее поведение (скрипт без argparse, 2 позиционных аргумента
  обязательны); это прежнее поведение скрипта, не CWD-проблема и не входит в
  скоуп фикса шага 5 — зафиксировано.

## Шаг 6: проверки

- `sh scripts/test-no-sensitive.sh` (до коммита): 7 × `ok`, `# pass=7
  fail=0`, exit 0. Замечание: скрипт гребет только tracked (git ls-files),
  поэтому новый не-закоммиченный контент я дополнительно проверил тем же
  regex-паттерном напрямую по `skills/ docs/reference/ docs/superpowers/
  journal/ AGENTS.md .gitignore local.mk.example` — 0 совпадений по
  приватным IP; 192.0.2.x — только в `local.mk.example` (RFC 5737, как
  задумано) и в диапазоне-упоминании в этом журнале.
- `git status --porcelain`: `local.mk` отсутствует в списке (игнорируется,
  не отслеживается) — как ожидается; `.superpowers/` тоже не в списке.

## Шаг 7: commit

```sh
git add -A
git commit -m "feat: migrate five skills into canonical repo with local.mk externalization"
```

- Коммит `61aca58`: 15 файлов, +1884. В составе — и незакоммиченная до старта
  правка контроллера в `docs/superpowers/plans/2026-10-25-skills-repo.md`
  (добавление строки `.superpowers/` в блок .gitignore шага 3 плана) —
  `git add -A` по брифу её поглотил; отмечено в отчёте.
- `local.mk` и `.superpowers/` в коммит не попали (gitignore).
- Post-commit: `sh scripts/test-no-sensitive.sh` — снова 7 × ok, exit 0 (теперь
  уже с покрытием новых tracked-файлов). `git status` — чистый.
- Self-review grep (post-commit):
  - 192.0.2 в tracked: только `local.mk.example`, план/журнал (TEST-NET
    упоминания), комментарии test-скрипта — ожидаемо, тест на них не срабатывает;
  - `local.mk`: ровно 6 переменных IPMI_* (ASR1_BMC/HOST, BAZZITE_BMC/HOST,
    MELLANOX_BMC/HOST);
  - `skills/*/SKILL.md`: IP-литералов нет (rc=1).
- `~/.config/opencode/skills/` не тронут: только cp/diff/grep/head (read-only).

## Доп. правка по ревью (после шага 7)

Замечание ревью: `skills/mellanox-flash-ops/SKILL.md-old` не должен был быть
отслеживаем — шаг 1 брифа предписывает `rm -f skills/mellanox-flash-ops/SKILL.md-old`.
Примечание контроллера «сохранить» (res. 4) было ошибкой контроллера; источник
истины — бриф (план). К тому же файл несёт дублирующий frontmatter
`name: mellanox-flash-ops` — hazard для поздних потребителей, сканирующих
каталог скилла (render-шаг, индексация).

Фикс:
```sh
git rm skills/mellanox-flash-ops/SKILL.md-old
```
- Файл удалён из индекса и с диска; в `skills/mellanox-flash-ops/` остался
  только `SKILL.md`.
- Гейт: `sh scripts/test-no-sensitive.sh` — 7 × ok, `# pass=7 fail=0`, exit 0.
- Коммит поправлен (amend, local-only, remote нет) — задача остаётся одним
  коммитом, сообщение не менялось. Новый SHA см. в отчёте (task-1-report.md).
