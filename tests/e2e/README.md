---
type: doc
status: active
owner: Team
created: 2026-04-24
updated: 2026-04-24
tags:
  - ongoing
  - reference
related: []
priority: reference
cycle: ongoing
---

> **TL;DR:** **Статус:** Skeleton. CI ещё не настроен. **Автор первоначальной структуры:** Product Architect, overnight pass 2026-04-23.

# Maket CP — End-to-End тесты (Playwright)

**Статус:** Skeleton. CI ещё не настроен.
**Автор первоначальной структуры:** Product Architect, overnight pass 2026-04-23.

Эта папка — заготовка под Playwright-тесты Maket CP. Ничего из лежащих в `pending/` файлов **не запускается автоматически**, пока не переименованы из `.draft` в `.spec.ts` и не подключён `playwright.config.ts`.

---

## Структура

```
tests/e2e/
├── README.md                     ← этот файл
├── pending/                      ← skeleton тесты (не запускаются)
│   └── rate-setter-sync.spec.ts.draft
├── fixtures/                     ← тестовые данные (TODO: создать)
│   └── capture-one-session/      ← .cos файлы для Rate Setter тестов
└── helpers/                      ← TODO: общие утилиты (login, query, cleanup)
```

Расширение `.draft` — защитный суффикс: Playwright runner ищет `*.spec.ts`, поэтому draft-файлы ему невидимы. Для активации теста переименуйте `.draft` → `.spec.ts`.

---

## Что уже есть

1. `pending/rate-setter-sync.spec.ts.draft` — skeleton для 15 сценариев Rate Setter sync.
   Источник сценариев: `docs/agents/qa/test-plans/rate-setter-sync-regression.md`.
   Большинство тестов помечены `test.fixme(...)` и не падают, но и не запускаются.

## Чего ещё нет (следующие PA-волны или QA-реализация)

- `playwright.config.ts` в корне репозитория.
- `package.json` с dev-dependency `@playwright/test`.
- CI workflow `.github/workflows/e2e.yml`.
- Helpers (`helpers/supabase.ts`, `helpers/auth.ts`, `helpers/cleanup.ts`).
- Fixtures (тестовая Capture One session).

Эти шаги относятся к следующей волне overnight-задачи PA (не overnight 2026-04-23).

---

## Как настроить локально (когда будет готова волна N+1)

### 1. Зависимости

```bash
cd /path/to/maket-cp
npm install --save-dev @playwright/test@latest
npx playwright install chromium
```

### 2. Environment

Создать `.env.test` (не коммитить) со следующими переменными:

```env
MAKET_BASE_URL=http://localhost:5173         # или https://staging.maket.example
QA_OWNER_EMAIL=qa-owner@maket.test
QA_OWNER_PWD=<пароль из 1Password>
QA_CLIENT_EMAIL=qa-client@maket.test
QA_CLIENT_PWD=<пароль из 1Password>
SUPABASE_URL=<https://xxxxx.supabase.co>
SUPABASE_SERVICE_ROLE_KEY=<для data-integrity checks>
```

### 3. Playwright config (draft, реализовать в следующей волне)

```typescript
// playwright.config.ts (НЕ СОЗДАВАТЬ В ЭТОЙ ВОЛНЕ)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/pending/**'],   // не запускаем draft
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html'], ['list']],
  use: {
    baseURL: process.env.MAKET_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'load',
      testMatch: /rate-setter-sync\.spec\.ts/,
      grep: /RS-REG-15/,
      timeout: 20 * 60_000,
    },
  ],
});
```

### 4. Запуск

```bash
# Все тесты (кроме pending/)
npx playwright test

# Только Rate Setter
npx playwright test rate-setter-sync

# Только один сценарий
npx playwright test -g "RS-REG-03"

# Отчёт
npx playwright show-report
```

---

## Политика activation

Тест переходит из `pending/*.draft` → `tests/e2e/*.spec.ts` только когда выполнены **все** условия:

1. Соответствующий фикс (F-01 … F-10) merged в main.
2. Fixture'ы необходимые для теста — положены в `fixtures/`.
3. Helpers вызываемые в тесте — существуют.
4. Сценарий вручную пройден QA на staging хотя бы 1 раз.
5. Приложена запись `test-plans/rate-setter-sync-regression.md` к разделу «Verified».

Без этого — держать в `pending/` с суффиксом `.draft`. Preference: лучше нет теста, чем есть падающий в CI без смысла.

---

## Как читать test-план вместе со skeleton'ом

1. Открыть `docs/agents/qa/test-plans/rate-setter-sync-regression.md` — там детальные сценарии (pre-condition, steps, expected).
2. Открыть `pending/rate-setter-sync.spec.ts.draft` — там `describe`/`test` блоки с соответствующими номерами RS-REG-XX.
3. Каждый TODO внутри теста должен ссылаться на секцию плана.

---

## Связь с другими лейнами

- **QA:** владелец реализации, приоритизирует waves (см. комментарий внизу `.draft` файла).
- **PA (этот):** поддерживает skeleton, добавляет новые сценарии при fix-merge.
- **DAD:** предоставляет разметку toast'ов для F-01-зависимых тестов (selector `.toast-error`).
- **CoS:** контролирует, что fixture'ы не содержат реальных PII пользователей.

---

## Troubleshooting (common problems)

### «Cannot find module @playwright/test»
Установить: `npm install --save-dev @playwright/test`.

### «Тест падает на `page.goto` с ERR_CONNECTION_REFUSED»
Запустить Maket CP локально (`v2/frontend/index.html` через simple HTTP server) или указать staging URL в `MAKET_BASE_URL`.

### «Rate Setter тест падает на `pywebview.api not found`»
Desktop-only API недоступно в браузере. Тест должен запускаться против браузерного фолбэка; в Rate Setter это значит — подменить `rate_setter_run` через Supabase Edge function (см. ADR-003, не написан).

---

**Следующий шаг для QA:** начать с Wave 1 (RS-REG-01, 02, 06, 07, 10, 12) после merge F-01 + F-02.
