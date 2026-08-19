"""Юнит-тесты нативного переименования файлов (FileSystem.apply_rename_mapping).

Покрывает бэкенд задачи feat0702-native-rename: чистую FS-логику,
которую вызывает AppAPI.rename_in_folder после native-диалога.

Запуск (без внешних зависимостей):
    python3 tests/test_rename.py
или через pytest, если установлен:
    python3 -m pytest tests/test_rename.py -v

Все тесты работают во временной папке (tempfile) — реальные файлы не трогаются.
"""
from __future__ import annotations

import datetime
import sys
import tempfile
from pathlib import Path

# Позволяем импортировать core.* при прямом запуске файла.
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from core.infra.filesystem import FileSystem  # noqa: E402


def _mkfile(folder: Path, name: str, content: str = "x") -> None:
    (folder / name).write_text(content, encoding="utf-8")


def test_basic_rename() -> None:
    """Обычное переименование двух файлов: оба на диске получают новое имя."""
    with tempfile.TemporaryDirectory() as d:
        folder = Path(d)
        _mkfile(folder, "IMG_001.jpg", "a")
        _mkfile(folder, "IMG_002.jpg", "b")
        res = FileSystem.apply_rename_mapping(
            folder,
            [
                {"old": "IMG_001.jpg", "new": "SKU_promo.jpg"},
                {"old": "IMG_002.jpg", "new": "SKU_vert.jpg"},
            ],
            write_log=False,
        )
        assert res["renamed"] == 2, res
        assert res["skipped"] == []
        assert res["errors"] == []
        assert (folder / "SKU_promo.jpg").read_text(encoding="utf-8") == "a"
        assert (folder / "SKU_vert.jpg").read_text(encoding="utf-8") == "b"
        assert not (folder / "IMG_001.jpg").exists()


def test_skip_missing_source() -> None:
    """Если исходного файла нет в папке — он уходит в skipped, остальные работают."""
    with tempfile.TemporaryDirectory() as d:
        folder = Path(d)
        _mkfile(folder, "here.jpg")
        res = FileSystem.apply_rename_mapping(
            folder,
            [
                {"old": "here.jpg", "new": "renamed.jpg"},
                {"old": "ghost.jpg", "new": "whatever.jpg"},
            ],
            write_log=False,
        )
        assert res["renamed"] == 1
        assert res["skipped"] == ["ghost.jpg"]
        assert (folder / "renamed.jpg").exists()


def test_collision_does_not_overwrite() -> None:
    """Если целевое имя уже занято другим файлом — не перезаписываем, пишем в errors."""
    with tempfile.TemporaryDirectory() as d:
        folder = Path(d)
        _mkfile(folder, "src.jpg", "src-content")
        _mkfile(folder, "taken.jpg", "existing-content")
        res = FileSystem.apply_rename_mapping(
            folder,
            [{"old": "src.jpg", "new": "taken.jpg"}],
            write_log=False,
        )
        assert res["renamed"] == 0
        assert len(res["errors"]) == 1
        assert "уже существует" in res["errors"][0]
        # Оба файла на месте, содержимое существующего не пострадало.
        assert (folder / "src.jpg").read_text(encoding="utf-8") == "src-content"
        assert (folder / "taken.jpg").read_text(encoding="utf-8") == "existing-content"


def test_empty_pairs_ignored() -> None:
    """Пары с пустыми old/new пропускаются молча (не skipped, не error)."""
    with tempfile.TemporaryDirectory() as d:
        folder = Path(d)
        _mkfile(folder, "a.jpg")
        res = FileSystem.apply_rename_mapping(
            folder,
            [
                {"old": "", "new": "x.jpg"},
                {"old": "a.jpg", "new": ""},
                {"old": "a.jpg", "new": "b.jpg"},
            ],
            write_log=False,
        )
        assert res["renamed"] == 1
        assert res["skipped"] == []
        assert res["errors"] == []
        assert (folder / "b.jpg").exists()


def test_rename_to_same_name_is_noop() -> None:
    """old == new — файл остаётся, считается применённым (не падаем на dst==src)."""
    with tempfile.TemporaryDirectory() as d:
        folder = Path(d)
        _mkfile(folder, "keep.jpg", "same")
        res = FileSystem.apply_rename_mapping(
            folder,
            [{"old": "keep.jpg", "new": "keep.jpg"}],
            write_log=False,
        )
        assert res["errors"] == []
        assert res["renamed"] == 1
        assert (folder / "keep.jpg").read_text(encoding="utf-8") == "same"


def test_log_written_with_sections() -> None:
    """При write_log=True рядом появляется rename_log_*.txt со всеми секциями."""
    with tempfile.TemporaryDirectory() as d:
        folder = Path(d)
        _mkfile(folder, "ok.jpg")
        _mkfile(folder, "dup.jpg")
        _mkfile(folder, "occupied.jpg")
        fixed = datetime.datetime(2026, 8, 19, 9, 0, 0)
        res = FileSystem.apply_rename_mapping(
            folder,
            [
                {"old": "ok.jpg", "new": "ok_renamed.jpg"},
                {"old": "missing.jpg", "new": "z.jpg"},
                {"old": "dup.jpg", "new": "occupied.jpg"},
            ],
            write_log=True,
            _now=fixed,
        )
        assert res["log_path"] is not None
        log_file = Path(res["log_path"])
        assert log_file.name == "rename_log_20260819_090000.txt"
        text = log_file.read_text(encoding="utf-8")
        assert "=== RENAMED ===" in text
        assert "ok.jpg\t->\tok_renamed.jpg" in text
        assert "=== SKIPPED (not found in folder) ===" in text
        assert "missing.jpg" in text
        assert "=== ERRORS ===" in text


def _run_standalone() -> int:
    """Мини-раннер для запуска без pytest: python3 tests/test_rename.py."""
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run_standalone())
