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
