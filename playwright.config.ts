// ─────────────────────────────────────────────────────────────
//  playwright.config.ts
//
//  Минимальный Playwright-конфиг для Maket CP.
//  Цель: green CI на 3 smoke-тестах (landing).
//  Продуктовые spec'ы (share-link, auto-rename) живут рядом как
//  .draft-skeleton'ы с test.fixme и игнорируются этим конфигом —
//  активируем, когда появится локальный dev-server и auth fixture.
//
//  baseURL привязан к landing:
//    https://barinskim-cmyk.github.io/maket-landing/
//  Продуктовым тестам baseURL не нужен — они fixme до активации.
// ─────────────────────────────────────────────────────────────

import { defineConfig, devices } from '@playwright/test';

const LANDING_URL =
  process.env.MAKET_LANDING_URL ||
  'https://barinskim-cmyk.github.io/maket-landing/';

export default defineConfig({
  testDir: './tests/e2e/active',

  // .draft-скелеты лежат рядом, но в активный прогон не попадают.
  testIgnore: ['**/*.draft', '**/*.draft.ts'],

  timeout: 30_000,
  expect: { timeout: 5_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 2 retry в CI, 0 локально — так просит спецификация.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: LANDING_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
