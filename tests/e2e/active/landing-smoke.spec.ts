// ─────────────────────────────────────────────────────────────
//  landing-smoke.spec.ts
//
//  Smoke для публичного лендинга (редизайн Content Pulse, 03.07.2026):
//    1. Hero показывает новый заголовок («Каждый кадр — уникальный
//       отпечаток процесса») и бренд CONTENT PULSE.
//    2. Нет устаревших утверждений (EU-серверы / PIM / «Все ждет»)
//       и старого бренда «Maket CP» в видимом тексте.
//    3. CTA «Запустить пилот» ведёт на mailto (форма-маршрутизатор
//       сознательно убрана — решение Маши 02.07.2026).
//    4. Ключевые секции на месте: пульс, эволюция, согласование.
//
//  baseURL берётся из playwright.config.ts (LANDING_URL).
// ─────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

test('landing has Content Pulse hero', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('уникальный отпечаток процесса');
  const visibleText = await page.locator('body').innerText();
  expect(visibleText).toContain('CONTENT');
  expect(visibleText).toContain('ПЛАТФОРМА ДЛЯ ВИЗУАЛЬНОГО ПРОДАКШЕНА');
});

test('landing has no deprecated claims or old brand', async ({ page }) => {
  await page.goto('/');
  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toContain('EU серверы');
  expect(visibleText).not.toContain('PIM');
  expect(visibleText).not.toContain('Все ждет');
  expect(visibleText).not.toContain('Maket CP');
});

test('landing CTA is mailto pilot button', async ({ page }) => {
  await page.goto('/');
  const cta = page.locator('#cta a.btn-primary');
  await expect(cta).toBeVisible();
  const href = await cta.getAttribute('href');
  expect(href).toContain('mailto:');
});

test('landing key sections render', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pulse')).toBeVisible();
  await expect(page.locator('#growth')).toBeVisible();
  await expect(page.locator('#approve')).toBeVisible();
  // Кардиограмма отрисовывается скриптом при доскролле
  await page.locator('#pulse').scrollIntoViewIfNeeded();
  await expect
    .poll(async () => page.locator('#pulse-wrap svg').count(), { timeout: 10_000 })
    .toBeGreaterThan(0);
});
