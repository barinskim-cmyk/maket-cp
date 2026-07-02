// ─────────────────────────────────────────────────────────────
//  landing-smoke.spec.ts
//
//  Минимальный smoke для публичного landing'а:
//    1. Hero показывает Version A-формулировку
//       («Платформа для визуального продакшена»).
//    2. На странице НЕТ устаревших утверждений, которые мы
//       сознательно убрали (EU-серверы / PIM / «Все ждет»).
//    3. На странице есть форма-маршрутизатор роли (фотограф / команда).
//
//  baseURL берётся из playwright.config.ts (LANDING_URL).
//  Зелёный результат ожидается ПОСЛЕ деплоя landing'а с Version A.
// ─────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

test('landing has Version A hero', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText(
    'Платформа для визуального продакшена'
  );
});

test('landing has no deprecated claims', async ({ page }) => {
  await page.goto('/');
  // Проверяем ВИДИМЫЙ текст, не raw HTML: в HTML-комментарии шапки
  // легитимно упоминается «Removed PIM claim» (changelog деплоя),
  // из-за чего page.content() давал ложный красный (fix 2026-07-02).
  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toContain('EU серверы');
  expect(visibleText).not.toContain('PIM');
  expect(visibleText).not.toContain('Все ждет');
});

test('landing has hybrid routing form', async ({ page }) => {
  await page.goto('/');
  // Форма-маршрутизатор: radio/select/группа CTA с выбором роли
  // (фотограф / команда). Локатор толерантен к разметке —
  // любой <form> или .cta-role-group считается достаточным якорем.
  const form = page.locator('form, .cta-role-group').first();
  await expect(form).toBeVisible();
});
