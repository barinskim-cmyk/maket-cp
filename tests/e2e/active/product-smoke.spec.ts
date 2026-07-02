// ─────────────────────────────────────────────────────────────
//  product-smoke.spec.ts
//
//  Smoke-тесты продукта (web-клиент на GitHub Pages).
//  Активированы 2026-07-02 (аудит audit0702-ci-block).
//
//  Сценарии (см. docs/feature-matrix.md):
//    1. Приложение загружается: auth-gate виден анонимному пользователю.
//    2. Share-ссылка (роль client) открывает проект: карточки рендерятся.
//    3. Невалидный share-токен не роняет приложение.
//
//  MAKET_SHARE_TOKEN — активный client-токен тестового проекта
//  (все данные в системе тестовые, см. strategy-2026.md раздел 3).
// ─────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

const PRODUCT_URL =
  process.env.MAKET_PRODUCT_URL ||
  'https://barinskim-cmyk.github.io/maket-cp/';

// Тестовый токен (client, тестовый проект с 42 карточками).
const SHARE_TOKEN =
  process.env.MAKET_SHARE_TOKEN ||
  '8b65736ea997f3d335e0be0bfdcc05b251d405584995018f';

test.describe('product smoke', () => {
  test('app shell loads and shows auth gate for anonymous user', async ({ page }) => {
    await page.goto(PRODUCT_URL);
    await expect(page.locator('#auth-gate')).toBeVisible({ timeout: 15_000 });
  });

  test('share link (client role) opens project and renders cards', async ({ page }) => {
    await page.goto(`${PRODUCT_URL}?share=${SHARE_TOKEN}`);
    // Auth gate должен быть пропущен, app-main показан.
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 30_000 });
    // Карточки загружаются из Supabase — ждём хотя бы одну в списке.
    await expect
      .poll(async () => page.locator('#cp-cards-list > *').count(), {
        timeout: 30_000,
        message: 'cards did not render from share link',
      })
      .toBeGreaterThan(0);
  });

  test('invalid share token does not crash the app', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${PRODUCT_URL}?share=not-a-real-token`);
    // Приложение остаётся живым: либо auth-gate, либо сообщение об ошибке,
    // но НЕ белый экран с необработанным исключением.
    await page.waitForTimeout(5_000);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    expect(errors.filter((e) => /TypeError|ReferenceError/.test(e))).toHaveLength(0);
  });
});
