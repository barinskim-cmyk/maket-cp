# Template logic audit plan
**Created:** 2026-05-02 (after shoot-mode cot/cop integration session).
**Author:** Claude + Маша. Маша greenlit a refactor — у Виктории шаблоны не сохранены, blast radius low.
**Status:** plan only. To be executed in a dedicated session with fresh context.

## Why an audit now

Live shoot-mode now creates cards via Cmd+Shift+C with smart per-photo
orientation. But the broader template subsystem (`cpAddCard`,
`UserTemplates`, `proj._template`, `proj.templateId`, the «Сохранить шаблон»
button, the «Библиотека шаблонов» modal, default «4 вертикали» fallback) is
old, accreted, and Маша has been hitting «странные комяки» — slots
appearing/disappearing, unexpected aspect ratios, hero/no-hero confusion.

Now that the new live flow has its own template code path that we control
end-to-end, we can reshape the legacy code without breaking Маша's working
tests on Эконика's data (Виктория's templates aren't on the line).

## Scope — areas to audit

1. **Card creation paths**
   - `cpAddCard` (cards.js:151) — current fallback chain:
     prev card → `proj._template` → `proj.templateId` → 4 vertical.
     Verify that each branch produces consistent slot shapes and sane
     `_hAspect / _vAspect / _hasHero / _heroOrient`.
   - `smStartFromProjectParams` and the live-shoot flow already create
     cards via `onShoot_hotkey_card_created`. Confirm both paths converge
     on the same card schema.

2. **Template persistence**
   - `UserTemplates` array (state.js, ?). Where is it persisted? localStorage?
     Cloud? Per-user or per-device? Sync semantics with Supabase.
   - `proj.templateId` vs `proj._template` — when are they each canonical?
     Migration path between old (`templateId` only) and new (`_template`)?
   - «Сохранить шаблон» — what does it actually serialize? Slot orient +
     weight? Aspect ratio? Hero flag? Re-saving an existing template —
     overwrite vs version?

3. **Rendering**
   - `renderTemplatePreview` (shootings.js:81) — mini preview rules:
     - hero `h` → top + bottom row
     - hero `v` → hero left + right grid
     - no hero → row
     Compare with `cpRenderCard` (cards.js:438) — does the actual editor
     render the same shape? Reports of «карточка выглядит не как preview».
   - Default 4-vertical fallback fires when nothing else matches. Verify
     that's the intended behaviour for first card with zero photos vs
     first card after Cmd+Shift+C with N variants.

4. **Slot mutation**
   - When a photo is dragged into a slot (or hotkey-tagged), does the
     slot grow / shrink / split? Маша: «слоты добавляются если больше
     картинок». Find the code path. Decide: should the template be
     immutable post-creation, or grow on demand, or only via explicit
     «+ V» / «+ H» buttons?

5. **Aspect ratio fields**
   - `card._hAspect`, `card._vAspect`, `card._lockRows`, `card._hasHero`
     — what consumes each? What writes each? Defaults vs nulls.
   - Slot-level `aspect` — vs card-level. Order of precedence.

6. **Live-shoot card vs legacy card**
   - Schema diff: live-shoot card has `slots[i].stem`, `_heroOrient`,
     `source: 'shoot'`. Legacy doesn't. Consumers should be tolerant of
     both; verify.

## Process

1. **Inventory pass** — grep for `templateId`, `_template`, `UserTemplates`,
   `cpAddCard`, `renderTemplatePreview`, `_hAspect`, `_hasHero`,
   `_heroOrient`, `slots[`, document call graph in a markdown.

2. **Bug hunt** — for each path, pick a sample input (1H+2V, 4V, 1V hero +
   3V, 5V row, etc.) and trace what comes out the other side. Note
   discrepancies between editor render and template-preview render.

3. **Decide invariants** — write down the canonical card schema we want
   going forward. Pick one source of truth (`_template` or `templateId`).
   Decide whether slots are immutable post-create or auto-grow.

4. **Refactor** — implement, behind a feature flag if scope balloons.
   Migration script for old projects: their existing slots map cleanly
   to the new schema since both use the same field names.

5. **Verify** — re-load Эконика's saved cards, confirm visual identity.
   Live-shoot N cards with mixed orientations, confirm hero detection.

## Out of scope for this audit

- Drive integration (separate workstream).
- Project-to-Supabase sync (paused per Маша's «не засрём облако» rule
  during shoot-mode testing).
- Any change to the `UserTemplates` UI (Save / Load / Delete) — the
  data shape may shift, the UI gets a free pass.

## Estimate

Inventory + bug hunt: ~2 hours.
Refactor + tests: ~3-4 hours.
Total: half-day session, separate from the active shoot-mode iteration.

## Acceptance

- One canonical card schema documented in this file (or a sibling).
- Live-shoot cards and legacy cards produce identical render in
  `renderTemplatePreview` for the same `(slots, hero)` configuration.
- 4V fallback only fires for «empty card from + Новая карточка» — not
  for hotkey-driven card creation.
- Маша's «странные комяки» list: each entry struck-through or with
  a follow-up bug ticket.
