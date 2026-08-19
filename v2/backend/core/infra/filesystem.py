"""FileSystem — утилиты для безопасной работы с файловой системой."""
from __future__ import annotations

import datetime
import json
import os
import shutil
from pathlib import Path


class FileSystem:
    """Атомарная запись, бэкапы, утилиты."""

    @staticmethod
    def atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
        """Записать текстовый файл атомарно (tmp → replace)."""
        tmp = path.with_suffix(path.suffix + ".tmp")
        try:
            tmp.write_text(content, encoding=encoding)
            tmp.replace(path)
        except Exception:
            if tmp.exists():
                tmp.unlink()
            raise

    @staticmethod
    def atomic_write_json(path: Path, data: dict, indent: int = 2) -> None:
        """Записать JSON атомарно."""
        content = json.dumps(data, ensure_ascii=False, indent=indent)
        FileSystem.atomic_write_text(path, content)

    @staticmethod
    def backup(path: Path, suffix: str = ".bak") -> Path | None:
        """Создать бэкап файла. Возвращает путь к бэкапу или None если файл не существует."""
        if not path.exists():
            return None
        bak = path.with_suffix(path.suffix + suffix)
        shutil.copy2(path, bak)
        return bak

    @staticmethod
    def ensure_dir(path: Path) -> Path:
        """Создать директорию если не существует."""
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def apply_rename_mapping(
        folder: Path,
        mapping: list[dict],
        write_log: bool = True,
        _now: datetime.datetime | None = None,
    ) -> dict:
        """Применить пары {old, new} к файлам внутри `folder` (чистая FS-операция, без UI).

        Для каждой пары:
          - пустые old/new пропускаются молча;
          - если `old` не найден в папке — уходит в `skipped`;
          - если целевой `new` уже существует и это не тот же файл — в `errors`
            (не перезаписываем — защита от потери данных, ср. инцидент 14.04);
          - иначе os.rename(old → new).

        При write_log пишет рядом лог `rename_log_<timestamp>.txt`.

        Args:
            folder: папка с файлами (Path, должна существовать).
            mapping: список dict с ключами "old" и "new".
            write_log: писать ли лог-файл рядом.
            _now: инъекция времени для детерминированных тестов.

        Returns:
            {renamed: int, skipped: [str], errors: [str],
             applied: [(old, new)], log_path: str|None}.
        """
        renamed = 0
        skipped: list[str] = []
        errors: list[str] = []
        applied_pairs: list[tuple[str, str]] = []

        for pair in mapping:
            old_name = (pair or {}).get("old")
            new_name = (pair or {}).get("new")
            if not old_name or not new_name:
                continue
            src = folder / old_name
            if not src.exists():
                skipped.append(old_name)
                continue
            dst = folder / new_name
            if dst.exists() and dst != src:
                errors.append(f"{old_name}: '{new_name}' уже существует — пропущен")
                continue
            try:
                os.rename(src, dst)
                renamed += 1
                applied_pairs.append((old_name, new_name))
            except Exception as e:  # noqa: BLE001 — сообщаем любую FS-ошибку в отчёт
                errors.append(f"{old_name}: {e}")

        log_path: str | None = None
        if write_log:
            ts = (_now or datetime.datetime.now()).strftime("%Y%m%d_%H%M%S")
            log_file = folder / f"rename_log_{ts}.txt"
            try:
                with log_file.open("w", encoding="utf-8") as f:
                    f.write(f"Rename log — {ts}\n")
                    f.write(f"Folder: {folder}\n")
                    f.write(
                        f"Total mapping: {len(mapping)}, renamed: {renamed}, "
                        f"skipped: {len(skipped)}, errors: {len(errors)}\n\n"
                    )
                    f.write("=== RENAMED ===\n")
                    for old, new in applied_pairs:
                        f.write(f"{old}\t->\t{new}\n")
                    if skipped:
                        f.write("\n=== SKIPPED (not found in folder) ===\n")
                        for s in skipped:
                            f.write(f"{s}\n")
                    if errors:
                        f.write("\n=== ERRORS ===\n")
                        for e in errors:
                            f.write(f"{e}\n")
                log_path = str(log_file)
            except Exception as e:  # noqa: BLE001 — лог не критичен
                errors.append(f"log write failed: {e}")

        return {
            "renamed": renamed,
            "skipped": skipped,
            "errors": errors,
            "applied": applied_pairs,
            "log_path": log_path,
        }
