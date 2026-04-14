-- ═════════════════════════════════════════════════════════════════════
-- Migration 026: Soft-delete для cards и slots (защита от потери данных)
-- ═════════════════════════════════════════════════════════════════════
--
-- Проблема (инцидент 2026-04-14, проект [anchor client]):
--   Таблицы cards/slots очищались через DELETE при каждой синхронизации
--   (sbSyncCardsLight / sbUploadCards / save_cards_by_token — все
--   работали по паттерну DELETE ALL → INSERT NEW).
--   Если INSERT не долетал (RLS-отказ, разрыв сети, закрытие вкладки),
--   облако оставалось физически пустым. Следующий автопулл на любой
--   машине затирал локальный стейт — и данные исчезали бесследно.
--
-- Решение:
--   1) Колонка deleted_at (timestamptz) в cards и slots.
--   2) BEFORE DELETE триггер ловит ЛЮБОЙ DELETE на уровне БД и
--      превращает его в UPDATE deleted_at = now(). Физически ни
--      одна строка не удаляется — даже если клиентский код забудет
--      про soft-delete, защита срабатывает на уровне БД.
--   3) Индексы: частичные (WHERE deleted_at IS NULL) — активные строки.
--   4) save_cards_by_token: guard от пустого push, работает поверх
--      триггеров (просто INSERT, старые ряды сами помечаются через
--      триггер, либо остаются если не трогали).
--   5) RPC restore_deleted_cards — одна команда для восстановления.
--
-- Запустить в Supabase Dashboard → SQL Editor. Идемпотентно.
-- ═════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Колонки deleted_at ────────────────────────────────────────────
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN cards.deleted_at IS 'Soft-delete timestamp. NULL = active, set = hidden. НИКОГДА не удалять физически — восстановление через UPDATE deleted_at=NULL или SELECT restore_deleted_cards(...).';
COMMENT ON COLUMN slots.deleted_at IS 'Soft-delete timestamp. NULL = active, set = hidden. Восстановление через restore_deleted_cards(...).';

-- ── 2. Частичные индексы для быстрой фильтрации активных строк ──────
CREATE INDEX IF NOT EXISTS idx_cards_project_active
  ON cards (project_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_slots_project_active
  ON slots (project_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_slots_card_active
  ON slots (card_id, position)
  WHERE deleted_at IS NULL;

-- ── 3. ГЛАВНАЯ ЗАЩИТА: BEFORE DELETE триггеры ───────────────────────
-- Любой DELETE FROM cards/slots (откуда бы он ни пришёл — клиент,
-- RPC, SQL-редактор) превращается в soft-delete. Физически ничего
-- не стирается. Это страховка на уровне БД.
-- Если нужно действительно удалить (например крон-джоб очистки
-- старых soft-deleted > 90 дней) — использовать SET LOCAL
-- maketcp.allow_hard_delete = 'on' внутри транзакции.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _maketcp_soft_delete_cards()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Экстренный выход: если явно разрешён hard-delete (чистка старого)
  IF current_setting('maketcp.allow_hard_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  -- Если строка уже soft-deleted — обновим timestamp (оставим как есть).
  -- Для новых удалений — ставим текущее время.
  UPDATE cards
     SET deleted_at = COALESCE(deleted_at, now())
   WHERE id = OLD.id;

  RETURN NULL; -- отменить физический DELETE
END;
$$;

CREATE OR REPLACE FUNCTION _maketcp_soft_delete_slots()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('maketcp.allow_hard_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  UPDATE slots
     SET deleted_at = COALESCE(deleted_at, now())
   WHERE id = OLD.id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_soft_delete_cards ON cards;
CREATE TRIGGER trg_soft_delete_cards
  BEFORE DELETE ON cards
  FOR EACH ROW
  EXECUTE FUNCTION _maketcp_soft_delete_cards();

DROP TRIGGER IF EXISTS trg_soft_delete_slots ON slots;
CREATE TRIGGER trg_soft_delete_slots
  BEFORE DELETE ON slots
  FOR EACH ROW
  EXECUTE FUNCTION _maketcp_soft_delete_slots();

COMMENT ON TRIGGER trg_soft_delete_cards ON cards
  IS 'Перехватывает любой DELETE и превращает его в soft-delete (UPDATE deleted_at=now()). Обойти: SET LOCAL maketcp.allow_hard_delete=''on''.';
COMMENT ON TRIGGER trg_soft_delete_slots ON slots
  IS 'Перехватывает любой DELETE и превращает его в soft-delete.';

-- ── 4. save_cards_by_token: guard от пустого push ───────────────────
-- DELETE теперь безопасен (триггер превратит в soft-delete), но
-- добавляем явный guard: если cards_data пуст — НЕ трогаем ничего.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION save_cards_by_token(
  share_token text,
  cards_data jsonb,
  oc_data text DEFAULT '[]',
  oc_containers_data text DEFAULT '[]',
  annotations_data jsonb DEFAULT '{}'::jsonb,
  comments_data jsonb DEFAULT '{}'::jsonb,
  checkpoints_data jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  card_row jsonb;
  slot_row jsonb;
  new_card_id text;
  c_pos int;
BEGIN
  pid := _find_project_by_share_token(share_token);
  IF pid IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired share token';
  END IF;

  -- Обновляем метаданные проекта
  UPDATE projects SET
    other_content = oc_data,
    oc_containers = oc_containers_data,
    annotations = COALESCE(annotations_data, '{}'::jsonb),
    comments = COALESCE(comments_data, '{}'::jsonb),
    checkpoints = COALESCE(checkpoints_data, '[]'::jsonb),
    updated_at = now()
  WHERE id = pid;

  -- GUARD: пустой cards_data — НЕ стираем ничего, просто выходим.
  -- Это защита от "пустого push" на случай race condition в клиенте.
  IF cards_data IS NULL OR jsonb_array_length(cards_data) = 0 THEN
    RETURN;
  END IF;

  -- Старые карточки/слоты soft-delete'нутся триггером, как только
  -- начнётся DELETE. Но чтобы не создавать пересечения ID, сначала
  -- помечаем старые активные как удалённые (в том же духе что триггер).
  UPDATE slots SET deleted_at = now()
   WHERE project_id = pid AND deleted_at IS NULL;
  UPDATE cards SET deleted_at = now()
   WHERE project_id = pid AND deleted_at IS NULL;

  -- Вставляем новые карточки и слоты (deleted_at = NULL по умолчанию)
  c_pos := 0;
  FOR card_row IN SELECT * FROM jsonb_array_elements(cards_data)
  LOOP
    new_card_id := 'card_' || substring(pid::text, 1, 8) || '_' || c_pos || '_' || extract(epoch from now())::bigint;

    INSERT INTO cards (id, project_id, position, status, has_hero, h_aspect, v_aspect, lock_rows)
    VALUES (
      new_card_id,
      pid,
      COALESCE((card_row->>'position')::int, c_pos),
      COALESCE(card_row->>'status', 'draft'),
      COALESCE((card_row->>'has_hero')::boolean, true),
      COALESCE(card_row->>'h_aspect', '3/2'),
      COALESCE(card_row->>'v_aspect', '2/3'),
      COALESCE((card_row->>'lock_rows')::boolean, false)
    );

    IF card_row->'slots' IS NOT NULL AND jsonb_typeof(card_row->'slots') = 'array' THEN
      FOR slot_row IN SELECT * FROM jsonb_array_elements(card_row->'slots')
      LOOP
        INSERT INTO slots (card_id, project_id, position, orient, weight, row_num, rotation, file_name)
        VALUES (
          new_card_id,
          pid,
          COALESCE((slot_row->>'position')::int, 0),
          COALESCE(slot_row->>'orient', 'v'),
          COALESCE((slot_row->>'weight')::int, 1),
          (slot_row->>'row_num')::int,
          COALESCE((slot_row->>'rotation')::int, 0),
          slot_row->>'file_name'
        );
      END LOOP;
    END IF;

    c_pos := c_pos + 1;
  END LOOP;
END;
$$;

-- ── 5. get_project_by_token: фильтр deleted_at IS NULL ──────────────
CREATE OR REPLACE FUNCTION get_project_by_token(share_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid uuid;
  result jsonb;
  proj_row record;
  cards_arr jsonb;
BEGIN
  pid := _find_project_by_share_token(share_token);
  IF pid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, name, stage, other_content, oc_containers, annotations, comments, checkpoints
    INTO proj_row
    FROM projects
   WHERE id = pid
     AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'position', c.position,
      'status', c.status,
      'has_hero', c.has_hero,
      'h_aspect', c.h_aspect,
      'v_aspect', c.v_aspect,
      'lock_rows', c.lock_rows,
      'slots', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'position', s.position,
            'orient', s.orient,
            'weight', s.weight,
            'row_num', s.row_num,
            'rotation', s.rotation,
            'file_name', s.file_name,
            'thumb_path', s.thumb_path
          ) ORDER BY s.position
        )
        FROM slots s
         WHERE s.card_id = c.id
           AND s.deleted_at IS NULL
      ), '[]'::jsonb)
    ) ORDER BY c.position
  ), '[]'::jsonb)
  INTO cards_arr
  FROM cards c
  WHERE c.project_id = pid
    AND c.deleted_at IS NULL;

  result := jsonb_build_object(
    'project_id', proj_row.id,
    'name', proj_row.name,
    'stage', proj_row.stage,
    'other_content', proj_row.other_content,
    'oc_containers', proj_row.oc_containers,
    'annotations', COALESCE(proj_row.annotations, '{}'::jsonb),
    'comments', COALESCE(proj_row.comments, '{}'::jsonb),
    'checkpoints', COALESCE(proj_row.checkpoints, '[]'::jsonb),
    'cards', cards_arr
  );

  RETURN result;
END;
$$;

-- ── 6. RPC для восстановления soft-deleted карточек ─────────────────
-- Использование:
--   SELECT restore_deleted_cards('<project_uuid>', '2026-04-14 10:00:00+00');
--   SELECT restore_deleted_cards('<project_uuid>', NULL); -- всё удалённое
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION restore_deleted_cards(
  p_project_id uuid,
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(restored_cards int, restored_slots int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rc int := 0;
  rs int := 0;
BEGIN
  WITH updated AS (
    UPDATE cards
       SET deleted_at = NULL
     WHERE project_id = p_project_id
       AND deleted_at IS NOT NULL
       AND (p_since IS NULL OR deleted_at >= p_since)
     RETURNING id
  )
  SELECT COUNT(*) INTO rc FROM updated;

  WITH updated_s AS (
    UPDATE slots
       SET deleted_at = NULL
     WHERE project_id = p_project_id
       AND deleted_at IS NOT NULL
       AND (p_since IS NULL OR deleted_at >= p_since)
     RETURNING id
  )
  SELECT COUNT(*) INTO rs FROM updated_s;

  restored_cards := rc;
  restored_slots := rs;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_deleted_cards(uuid, timestamptz) TO authenticated;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════
-- Инструкция на случай потери карточек:
--
--   1) Найти project_id:
--      SELECT id, brand, updated_at FROM projects
--      WHERE owner_id = '<user_uuid>' ORDER BY updated_at DESC;
--
--   2) Посмотреть удалённые карточки:
--      SELECT id, position, status, deleted_at FROM cards
--      WHERE project_id = '<pid>' AND deleted_at IS NOT NULL
--      ORDER BY deleted_at DESC;
--
--   3) Восстановить всё удалённое после инцидента:
--      SELECT * FROM restore_deleted_cards(
--        '<pid>'::uuid,
--        '2026-04-14 13:00:00+00'::timestamptz
--      );
--
--   4) Или всё вообще:
--      SELECT * FROM restore_deleted_cards('<pid>'::uuid, NULL);
--
-- ВНИМАНИЕ: для проекта [anchor client] (инцидент 14.04) восстанавливать
-- нечего — данные были потеряны ДО этой миграции (старый DELETE).
-- Эта защита работает только с момента её установки.
-- ═════════════════════════════════════════════════════════════════════
