# Журнал: Task 6 — GitHub + одноразовая миграция (текущий хост)

План: `docs/superpowers/plans/2026-10-25-skills-repo.md`, task 6.
Бриф: `.superpowers/sdd/2026-10-25-skills-repo/task-6-brief.md` (совпадает с
планом; закреплённые элементы сверены по брифу). Рабочая ветка:
`plan/skills-repo`.

Окружение: node v22.22.2, `/run/.containerenv` существует → CRE=podman-remote
(автоопределение как в Makefile/install.sh; `podman` в PATH отсутствует,
`podman-remote` = /usr/bin/podman-remote). Образ `skills-mcp:local` уже собран
(Task 4/5, 739 MB). `gh` авторизован как `wipe-coading-survivors` (scopes
включают `repo`).

Состояние до начала (read-only-проверки):
- git: ветка `plan/skills-repo`, working tree clean. `main` = b506487 (base,
  merge-base), `plan/skills-repo` = b0de8a7 (tip, 9 коммитов вперёд;
  `rev-list --left-right --count main...plan` → `0 9`).
- `gh repo view wipe-coading-survivors/skills` →
  `Could not resolve to a Repository … (repository)`, exit 1 (404 — репо нет).
- `~/.config/opencode/opencode.jsonc`: невалидные топовые ключи `mcp-mlnx`
  (старый mellanox-flash-ops) и `mcp1` (context7); ключа `mcp` нет.
- `~/.config/opencode/skills/`: 7 каталогов — 5 в скопе задачи
  (analyzing-opencode-logs, basecalc, ipmi-ops, mellanox-flash-ops,
  mellanox-fw-build) + вне скопа glm-quota, irisc-asm (не трогаем).
- mellanox-flash-ops на хосте: `mcp/`, `SKILL.md`, `SKILL.md-old` (в репо нет
  `mcp/` и `SKILL.md-old` — ожидаемо).

Маскировка: реальные IP (значения local.mk) и Bearer-токен context7 в журнал
НЕ вносятся (no-sensitive гейт + гигиена): IP → `10.x.x.x`-стиль, токен →
`ctx7sk-****`.

## Шаг 1: GitHub

`gh repo view` → 404 (см. выше) → создаём.

```sh
gh repo create skills --private --source . --remote origin
# → https://github.com/wipe-coading-survivors/skills  (exit 0)
```

`gh` создал репо и добавил remote `origin`, но ветки не запушил
(`git ls-remote --heads origin` → пусто, `defaultBranchRef.name` = "").
Закреплённое `git push` не сработало как есть:

```sh
git push
# fatal: The current branch plan/skills-repo has no upstream branch.
#   (подсказка git: git push --set-upstream origin plan/skills-repo)
```

Минимальная адаптация (тот же намеренный «запушить текущую ветку на
origin», как предлагает сам git):

```sh
git push --set-upstream origin plan/skills-repo
#  * [new branch] plan/skills-repo -> plan/skills-repo
#  branch 'plan/skills-repo' set up to track 'origin/plan/skills-repo'.  (exit 0)
```

Итог:
```
git ls-remote --heads origin
# b0de8a76…  refs/heads/plan/skills-repo
gh repo view … --json isPrivate,defaultBranchRef
# {"isPrivate":true,"defaultBranchRef":{"name":"plan/skills-repo"}}
```

Отклонение (мелкое): default-ветка remote = `plan/skills-repo`, а не `main`,
как предсказывал контроллер — `gh repo create --source .` не пушит `main`,
а первый запушенный ref и становится default. Функционально неважно:
доведение до `main` (merge) — финальный ревью (по решению контроллера).
Ключевые требования выполнены: приватное репо создано, ветка запушена,
в существующее репо не пушали (404 проверен).

## Шаг 2: Верификация содержимого (lossless) — read-only

### 4 скилла без плейсхолдеров

`.py` — byte-идентичны (diff пуст, `[identical]`):
```
skills/analyzing-opencode-logs/oclog.py  ==  ~/.config/opencode/skills/analyzing-opencode-logs/oclog.py
skills/basecalc/calc.py                  ==  ~/.config/opencode/skills/basecalc/calc.py
skills/ipmi-ops/sol_bridge.py            ==  ~/.config/opencode/skills/ipmi-ops/sol_bridge.py
```

`SKILL.md` — diff:
- `mellanox-flash-ops` → **идентично** (exit 0). В репо нет скрипта (только
  SKILL.md; `mcp/`, `SKILL.md-old` на хосте — ожидаемо не в репо) → менять
  provenance нечего.
- `mellanox-fw-build` → **идентично** (exit 0). Аналогично (нет скрипта).
- `analyzing-opencode-logs` → 1 ханк, provenance-смена (Task 1):
  ```
  < Helper: `oclog.py` — fetched from the MCP server via the
  < `skill_file(analyzing-opencode-logs, oclog.py)` tool (fallback: a checkout of
  < this repo). `oclog.py --help` for subcommands.
  ---
  > Helper: `oclog.py` next to this file. `oclog.py --help` for subcommands.
  ```
- `basecalc` → 2 ханка, оба — та же provenance-смена (скрипт `calc.py`
  упомянут в двух местах — описательная строка + usage-пример):
  ```
  < Run `calc.py` — fetched from the MCP server via the
  < `skill_file(basecalc, calc.py)` tool (fallback: a checkout of this repo) — …
  ---
  > Run `calc.py` (in the directory of this SKILL.md) — …
  < python3 calc.py [-w N] [-f BASE] ...
  ---
  > python3 <skill_dir>/calc.py [-w N] [-f BASE] ...
  ```
  Оба ханка — замена «старого local-path-ссылки» на формулировку skill_file
  (по разрешению контроллера №2 это допустимый класс изменения; usage-пример
  `<skill_dir>/calc.py` → `calc.py` — тот же local-path-референс того же
  скрипта, что и описательная строка).

### ipmi-ops: рендер-раундтрип

```sh
tmp=$(mktemp -d)   # /tmp/tmp.PMqeOXEeNw (область оставляю, rm не использую)
mkdir -p "$tmp/skills"; cp -a skills/ipmi-ops "$tmp/skills/"
scripts/render.sh "$tmp/skills" "$tmp/out"     # exit 0
grep -cE '@[A-Z][A-Z0-9_]*@' "$tmp/out/ipmi-ops/SKILL.md"   # 0 (плейсхолдеров не осталось)
diff "$tmp/out/ipmi-ops/SKILL.md" ~/.config/opencode/skills/ipmi-ops/SKILL.md
```

Ожидалось (закреплено, разрешение №2): **byte-идентично**. Факт: **НЕ
идентично** — ровно 2 ханка (проверено: `diff … | grep -cE '^[0-9]'` → 2):
```
43,46c43,44
< is not a TTY). The bridge `sol_bridge.py` — fetched from the MCP server via
< the `skill_file(ipmi-ops, sol_bridge.py)` tool (fallback: a checkout of this
< repo) — gives ipmitool a pty: keys in via fifo, console out to a raw log.
< Check `… sol info`
---
> is not a TTY). The bridge `sol_bridge.py` (next to this SKILL.md) gives
> ipmitool a pty: keys in via fifo, console out to a raw log. Check `… sol info`
55c53
< nohup python3 sol_bridge.py /tmp/solin.fifo /tmp/sol.log >/dev/null 2>&1 &
---
> nohup python3 ~/.config/opencode/skills/ipmi-ops/sol_bridge.py /tmp/solin.fifo /tmp/sol.log >/dev/null 2>&1 &
```

Оба ханка — **та самая provenance-смена Task 1**, дословно задокументированная
в журнале Task 1 (`docs/…/2026-10-25-skills-repo-task-01.md:98-100`):
«(next to this SKILL.md)» → skill_file(ipmi-ops, sol_bridge.py); в launch-блоке
`~/.config/opencode/skills/ipmi-ops/sol_bridge.py` → `sol_bridge.py`.

Доказательство lossless именно по IP (то, ради чего раундтрип):
- 0 leftover `@IPMI_@` в отрендеренном файле (все 6 плейсхолдеров — 5 уникальных:
  MELLANOX/BAZZITE HOST+BMC, ASR1_HOST, ASR1_BMC×2 — подставлены);
- diff отрендеренного с хостовым = **ровно эти 2 provenance-ханка и НИЧЕГО
  больше** → все строки с IP в таблице совпали (иначе diff показал бы их).
  Т.е. значения `local.mk` точно воспроизводят IP исходника на хосте.

### ВЫВОД — STOP (NEEDS_CONTEXT)

Закреплённое «rendered == host, byte-for-byte» **неудовлетворимо как
написано**: Task 1 изменил provenance в ipmi-ops так же, как в остальных 4
скиллах (журнал Task 1:98-100), поэтому отрендеренный файл всегда будет
отличаться от хостового ровно на provenance, а не на IP. Это НЕ дефект
фидельности — репо является верной миграцией:
- все `.py` byte-идентичны;
- все отличия `SKILL.md` = задокументированная provenance-смена Task 1;
- IP-плейсхолдеры ipmi-ops обратимы lossless (раундтрип: только provenance,
  IP совпадают, 0 остатков).

Мутаций хоста НЕ было (шаг 2 read-only; конфиг и каталоги skills/ на месте).
Шаги 3-5 не начаты. По решению-прецеденту (журнал Task 5, решение 5:
«закреплённое утверждение, неудовлетворимое как написано → STOP +
NEEDS_CONTEXT») — стоп, запрос к контроллеру.

Запрос к контроллеру: подтвердить, что для ipmi-ops допустимо ослабление
ожидания до «отрендеренный SKILL.md == хостовой, кроме задокументированной
Task-1 provenance-смены» (симметрично правилу для 4 скиллов без плейсхолдеров),
и авторизовать продолжение шагов 3-5. Альтернатива (строгая byte-identity)
требовала бы отката provenance в skills/ipmi-ops/SKILL.md — противоречит
одобренному изменению Task 1, нужна явная директива.

## Возобновление: ратификация + шаги 3-5

Контроллер РАТИФИЦИРОВАЛ предложенное ослабление (план закреплён коммитом
3a56967; бриф регенерирован — step 2 теперь: «разница ТОЛЬКО строки
провенанса Task 1 (симметрия с четырьмя остальными); все IP-строки совпадают,
0 оставшихся `@IPMI_*@`»). Моё step-2 доказательство этому уже удовлетворяет.
Продолжаю с текущего состояния (step 1 done, step 2 verified, до сих пор
без мутаций хоста).

### Шаг 3: Бэкап + отодвинуть старые каталоги

```sh
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak-20261026   # exit 0
for d in analyzing-opencode-logs basecalc ipmi-ops mellanox-flash-ops mellanox-fw-build; do
  mv ~/.config/opencode/skills/$d ~/.config/opencode/skills/$d.pre-migration
done
```

Результат: `opencode.jsonc.bak-20261026` создан (2114 байта); 5 каталогов →
`<d>.pre-migration`; `glm-quota` и `irisc-asm` (вне скопа) не тронуты.

### Шаг 4: Конфиг — context7 + skills

DRY-проверка экстракции (токен не печатается):
```
node -e '…parseJsonc(конфиг)…; e=o.mcp1.context7; delete e.enabled…'
# mcp1 keys: [ 'context7' ]
# entry keys after drop: [ 'type', 'url', 'headers' ]
# type: remote ; url: https://mcp.context7.com/mcp
# enabled present?: false ; headers.Authorization startsWith "Bearer "?: true
```

Реальная экстракция entry в переменную (токен остаётся в переменной, в журнал
НЕ вносится), затем 4 закреплённые команды (CRE=podman-remote — автоопределение):
```sh
entry=$(node -e '…delete e.enabled; process.stdout.write(JSON.stringify(e))')   # 135 символов
node scripts/patch-mcp-config.mjs set    ~/.config/opencode/opencode.jsonc context7 "$entry"   # exit 0
node scripts/patch-mcp-config.mjs set    ~/.config/opencode/opencode.jsonc skills '{"type":"local","command":["podman-remote","run","--rm","-i","skills-mcp:local"]}'  # exit 0
node scripts/patch-mcp-config.mjs remove ~/.config/opencode/opencode.jsonc mcp1   # exit 0
node scripts/patch-mcp-config.mjs remove ~/.config/opencode/opencode.jsonc mcp-mlnx  # exit 0
```
В entry `enabled` удалено (было `true`; в современном `mcp.servers` —
`disabled`, не `enabled`). Токен в команде маскируется: `Bearer ctx7sk-****`.

Ре-парс результата (Review Focus 4):
```
node -e '…parseJsonc(новый конфиг)…'
# RE-PARSE OK
# top-level keys: $schema, lsp, plugin, provider, mcp
# mcp.servers keys: context7, skills
# has mcp1?: false ; has mcp-mlnx?: false
# context7: type=remote, url=https://mcp.context7.com/mcp, enabled?: false,
#           headers.Authorization = Bearer ctx7****
# skills: {"type":"local","command":["podman-remote","run","--rm","-i","skills-mcp:local"]}
# plugin / provider(pigoky-llama-cpp, local-llama-cpp) / lsp=true — сохранены
```

Конфиг переведён в современный `mcp.servers.<name>`; невалидные топовые
`mcp1`/`mcp-mlnx` удалены; остальное (plugin, provider, lsp, $schema) цел.

### Шаг 5: Установка + верификация

```sh
scripts/install.sh   # exit 0
# build: skills-mcp:local (cached, 5b37bbb9785d)
# ipmi-ops rendered: md5 c7fff3c75a166a44f62bd00628b218df  ~/.config/opencode/skills/ipmi-ops/SKILL.md
# smoke-ok
# install: done
```

Состояние после (закреплённые ожидания — все выполнены):
- 4 симлинка (→ `skills/<d>/SKILL.md` репо): analyzing-opencode-logs, basecalc,
  mellanoX-flash-ops, mellanoX-fw-build (readlink подтверждён).
- ipmi-ops: отрендерен (обычный файл, НЕ symlink) + `.rendered` + md5 c7fff3…;
  0 leftover `@IPMI_*@`.
- `.pre-migration` ×5 на месте; `glm-quota`/`irisc-asm` не тронуты.

Живые пробы — из временного каталога `/tmp/ocprobe-UgH4H1` (`opencode run`
неинтерактивен по умолчанию; флаги сверены по `opencode run --help`).

**Проба (a)** «Перечисли доступные скиллы и вызови инструмент list_skills
MCP-сервера skills, покажи вывод»:
- `skills_list_skills` вызван → ровно 5 скиллов: analyzing-opencode-logs,
  basecalc, ipmi-ops, mellanoX-flash-ops, mellanoX-fw-build.
- Модель дополнительно отметила superpowers/glm-quota/customize-opencode/
  irisc-asm, но MCP-сервер `skills` отдаёт ровно эти 5.

Ground truth (лог opencode, run d7b5416e) — 5 WARN `duplicate skill name`:
opencode обнаружил ОБА — мигрированные (symlink/rendered) и `.pre-migration`
(в них ещё лежат SKILL.md исходников с тем же `name` в frontmatter). Выводы:
1. **opencode следует симлинкам** (нашёл SKILL.md через symlink) → fallback
   (Review Focus 3: symlink → копия + md5) **НЕ нужен**.
2. Все 5 имён в `available_skills` (каждое как existing+duplicate) →
   закреплённое «все 5 скиллов в available_skills» выполнено.

⚠️ **Concern (побочный эффект закреплённого шага 3):** `.pre-migration` внутри
`skills/` дают 5 предупреждений о дублях. Разрешение дублей — по порядку
readdir (стабильно при неизменном каталоге, иначе — нет): в данном прогоне
basecalc/analyzing-opencode-logs/ipmi-ops → NEW (мигрированное),
mellanoX-flash-ops/mellanoX-fw-build → OLD (`.pre-migration`). Для mellanoX-*
OLD == NEW (byte-идентичны, шаг 2) → функционально без разницы. Рекомендация:
после верификации вынести бэкапы из `skills/` (вне скопа этой задачи;
extra-mutation не выполняю — закреплено хранить `.pre-migration`).

**Проба (b)** «Вызови инструмент ipmi_ops_docs MCP-сервера skills и покажи
полный вывод»:
- `skills_ipmi_ops_docs` вызван → полный отрендеренный SKILL.md с РЕАЛЬНЫМИ IP
  (таблица 3 хоста × host/BMC + примечание asr1), 0 плейсхолдеров `@IPMI_*@`.
  IP в журнале маскируются (`10.x.x.x`).
- Доказательство без печати значений: в отрендеренном файле 7 IP-токенов
  (6 уникальных; BMC asr1 ×2 — таблица + примечание), 0 `@IPMI_*@`; каждое
  значение local.mk присутствует (5×1 + 1×2 = 7).
