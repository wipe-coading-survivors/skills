# AGENTS.md

## Тесты (гейт каждого коммита)

- `make test` — гейт каждого коммита: `node --test` (MCP-сервер), render
  (подстановка `local.mk` → SKILL.md), `scripts/test-no-sensitive.sh`.
- `make build` / `make smoke` — сборка и smoke контейнера.

## Кодовые правила

- **no-cre-hardcode.** Контейнерный инструмент определяется переменной
  `CRE` (`podman` или `podman-remote` — сборка может идти через хост). В
  скриптах не хардкодить `podman`/`podman-remote`: инструмент определяется
  так же, как в Makefile — `podman` с суффиксом `-remote`, если существует
  файл `/run/.containerenv`.
- **english-commits.** Сообщения коммитов git — на английском.
- **no-inline-comments.** В Containerfile нет завершающих (inline)
  комментариев после инструкции — комментарий только отдельной строкой.
- `rm` в скриптах репо не используется (удаление по путям из переменных
  запрещено).
- Чувствительные значения (реальные IP хостов/BMC) не в tracked-файлах:
  `local.mk` gitignored (шаблон — `local.mk.example`), проверка —
  `scripts/test-no-sensitive.sh` (часть `make test`).
