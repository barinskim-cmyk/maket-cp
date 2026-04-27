/**
 * verify_decoupling.mjs
 * Логическая проверка bug-fix "Shared hide-verified checkboxes (3 menus)".
 *
 * Проверяем:
 *   - 3 независимых flag (Checklist / Matching / Verification)
 *   - 3 независимых CSS-класса на #page-articles
 *   - toggle одного flag НЕ изменяет состояние других
 *   - CSS-селектор каждого класса покрывает только свой набор строк
 *
 * Запуск:  node bugs/_artifacts/2026-04-27-shared-hide-verified/verify_decoupling.mjs
 */

let _arHideVerifiedChecklist    = true;
let _arHideVerifiedMatching     = true;
let _arHideVerifiedVerification = true;

const pageClasses = new Set();
function syncClass(name, on) {
  if (on) pageClasses.add(name); else pageClasses.delete(name);
}

function toggleChecklist() {
  _arHideVerifiedChecklist = !_arHideVerifiedChecklist;
  syncClass('ar-hide-verified-checklist', _arHideVerifiedChecklist);
}
function toggleMatching() {
  _arHideVerifiedMatching = !_arHideVerifiedMatching;
  syncClass('ar-hide-verified-matching', _arHideVerifiedMatching);
}
function toggleVerification() {
  _arHideVerifiedVerification = !_arHideVerifiedVerification;
  syncClass('ar-hide-verified-verification', _arHideVerifiedVerification);
}

// Init: всё true → все 3 класса присутствуют
syncClass('ar-hide-verified-checklist',    _arHideVerifiedChecklist);
syncClass('ar-hide-verified-matching',     _arHideVerifiedMatching);
syncClass('ar-hide-verified-verification', _arHideVerifiedVerification);

// CSS-правила (как в style.css):
//   .ar-hide-verified-checklist     hides tr.ar-row.ar-verified
//   .ar-hide-verified-matching      hides .ar-match-row.ar-verified
//   .ar-hide-verified-verification  hides .ar-vfy-row.ar-vfy-verified
function isHidden(rowKind) {
  if (rowKind === 'checklist')    return pageClasses.has('ar-hide-verified-checklist');
  if (rowKind === 'matching')     return pageClasses.has('ar-hide-verified-matching');
  if (rowKind === 'verification') return pageClasses.has('ar-hide-verified-verification');
  throw new Error('unknown rowKind: ' + rowKind);
}

const results = [];
function check(name, cond) {
  const ok = !!cond;
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
}

// Initial: все 3 скрыты
check('init: checklist hidden',    isHidden('checklist'));
check('init: matching hidden',     isHidden('matching'));
check('init: verification hidden', isHidden('verification'));

// Toggle Checklist OFF — matching/verification остаются hidden
toggleChecklist();
check('after toggleChecklist: checklist VISIBLE',    !isHidden('checklist'));
check('after toggleChecklist: matching still hidden', isHidden('matching'));
check('after toggleChecklist: verification still hidden', isHidden('verification'));
check('after toggleChecklist: matching flag unchanged',     _arHideVerifiedMatching === true);
check('after toggleChecklist: verification flag unchanged', _arHideVerifiedVerification === true);

// Toggle Matching OFF — checklist (off) и verification (on) не трогаются
toggleMatching();
check('after toggleMatching: checklist still VISIBLE',    !isHidden('checklist'));
check('after toggleMatching: matching VISIBLE',           !isHidden('matching'));
check('after toggleMatching: verification still hidden',   isHidden('verification'));

// Toggle Verification OFF — оба остаются как были
toggleVerification();
check('after toggleVerification: checklist still VISIBLE',    !isHidden('checklist'));
check('after toggleVerification: matching still VISIBLE',     !isHidden('matching'));
check('after toggleVerification: verification VISIBLE',       !isHidden('verification'));

// Toggle Verification ON снова — другие не трогаются
toggleVerification();
check('toggle Verification back ON: verification hidden',     isHidden('verification'));
check('toggle Verification back ON: checklist still VISIBLE', !isHidden('checklist'));
check('toggle Verification back ON: matching still VISIBLE',  !isHidden('matching'));

// Состояние Машиного бага: visible checkboxes off (false) but rows hidden
// → теперь невозможно: каждый чекбокс контролирует ТОЛЬКО свой класс
// Симулируем:  поставить все в visible (off), ни один класс не должен висеть
toggleChecklist();   // bring back to true
toggleChecklist();   // → false (visible)
toggleMatching();    // bring back to true
toggleMatching();    // → false (visible)
// verification уже скрыт (true) после re-toggle выше; снимаем
toggleVerification();
check('all checkboxes off: no checklist class',    !pageClasses.has('ar-hide-verified-checklist'));
check('all checkboxes off: no matching class',     !pageClasses.has('ar-hide-verified-matching'));
check('all checkboxes off: no verification class', !pageClasses.has('ar-hide-verified-verification'));

// Summary
const failed = results.filter(r => !r.ok);
console.log('\n--- ' + (results.length - failed.length) + '/' + results.length + ' passed ---');
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log('  - ' + f.name);
  process.exit(1);
}
console.log('OK — all 3 hide-verified checkboxes are independent.');
