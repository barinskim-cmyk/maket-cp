"""FileSystem — утилиты для безопасной работы с файловой системой."""
from __future__ import annotations

import json
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
