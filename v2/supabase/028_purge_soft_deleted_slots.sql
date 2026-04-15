-- ═════════════════════════════════════════════════════════════════════
-- Migration 028: Разовая чистка накопленных soft-deleted slot rows
-- ═════════════════════════════════════════════════════════════════════
--
-- Проблема:
--   До коммита slots-bloat-upsert клиентский sbSyncCardsLight делал
--   DELETE FROM slots WHERE project_id = X при каждой синхронизации.
--   Триггер миграции 026 превращает DELETE в UPDATE deleted_at=now(),
--   поэтому физически ничего не удалялось — все помеченные строки
--   оставались в таблице. На больших проектах (57+ карточек ~= сотни
--   слотов × десятки sync-циклов) таблица slots разрослась до
--   десятков тысяч soft-deleted строк. Следующий DELETE блокировал
--   таблицу надолго (массовый UPDATE по всем найденным строкам) и
--   упирался в PostgreSQL statement_timeout (8 сек по умолчанию).
--
-- Решение (клиентская часть уже в коде):
--   sbSyncCardsLight теперь использует UPSERT по slots.id +
--   filter-based soft-delete стейл-строк (.not('id', 'in', localIds)).
--   Новых массовых DELETE не будет.
--
-- Эта миграция (серверная часть):
--   Разово физически удаляет все soft-deleted slot rows. Это безопасно:
--   эти строки уже помечены как "удалённые" и не участвуют в работе.
--   После чистки размер таблицы возвращается к реальному объёму
--   активных данных, триггеры перестают тормозить.
--
-- Hard-delete обходит триггер через SET LOCAL maketcp.allow_hard_delete
-- = 'on' (механизм предусмотрен в миграции 026 именно для крон-джобов
-- чистки старого мусора).
--
-- Идемпотентно. Запустить один раз в Supabase Dashboard → SQL Editor.
-- ═════════════════════════════════════════════════════════════════════

BEGIN;

-- Разрешаем hard-delete в рамках этой транзакции (триггер 026 пропустит)
SET LOCAL maketcp.allow_hard_delete = 'on';

-- Собираем статистику ДО чистки для лога
DO $$
DECLARE
  total_before bigint;
  soft_del_before bigint;
  active_before bigint;
BEGIN
  SELECT COUNT(*) INTO total_before FROM slots;
  SELECT COUNT(*) INTO soft_del_before FROM slots WHERE deleted_at IS NOT NULL;
  SELECT COUNT(*) INTO active_before FROM slots WHERE deleted_at IS NULL;
  RAISE NOTICE 'slots BEFORE purge: total=%, soft_deleted=%, active=%',
    total_before, soft_del_before, active_before;
END $$;

-- ─── ГЛАВНОЕ: физически удаляем все soft-deleted slot rows ───
DELETE FROM slots WHERE deleted_at IS NOT NULL;

-- Статистика ПОСЛЕ
DO $$
DECLARE
  total_after bigint;
  active_after bigint;
BEGIN
  SELECT COUNT(*) INTO total_after FROM slots;
  SELECT COUNT(*) INTO active_after FROM slots WHERE deleted_at IS NULL;
  RAISE NOTICE 'slots AFTER purge: total=% (active=%)', total_after, active_after;
END $$;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════
-- ВАЖНО: Supabase SQL Editor оборачивает запрос в транзакцию, поэтому
-- VACUUM здесь запускать НЕЛЬЗЯ (выдаст ERROR: 25001 VACUUM cannot run
-- inside a transaction block).
--
-- Автовакуум Postgres разберёт dead tuples сам в фоне — это безопасно
-- для корректности, просто место освободится не мгновенно.
--
-- Если хочется форсировать reclaim сразу, запустить ОТДЕЛЬНЫМ запросом
-- (без BEGIN/COMMIT вокруг, и не внутри транзакции SQL Editor — можно
-- через psql или через Supabase CLI):
--
--   VACUUM ANALYZE slots;
--
-- Для корректности работы приложения это не требуется.
-- ═════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════
-- Опционально: такая же чистка для cards (если со временем накопятся)
-- На момент миграции 028 cards уже используют UPSERT (с коммита b9cd02f),
-- поэтому мусора там почти нет. Но раскомментировать при необходимости:
--
-- BEGIN;
-- SET LOCAL maketcp.allow_hard_delete = 'on';
-- DELETE FROM cards WHERE deleted_at IS NOT NULL
--   AND deleted_at < now() - interval '30 days';  -- оставляем свежие для восстановления
-- COMMIT;
-- VACUUM ANALYZE cards;
--
-- ═════════════════════════════════════════════════════════════════════
-- Проверка после запуска:
--
--   SELECT
--     COUNT(*)                                    AS total,
--     COUNT(*) FILTER (WHERE deleted_at IS NULL)  AS active,
--     COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
--   FROM slots;
--
-- Ожидаемо: soft_deleted = 0, total = active.
--
-- После этого sbSyncCardsLight на проекте с 57 карточками должен
-- проходить без statement_timeout.
-- ═════════════════════════════════════════════════════════════════════
