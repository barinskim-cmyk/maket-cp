"""Photo — базовая сущность системы."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Photo:
    """Одна фотография.

    name     — исходное имя файла (IMG_0001.CR3)
    stem     — имя без расширения/суффиксов (IMG_0001)
    path     — полный путь к файлу (опционально, может быть None для preview-режима)
    rating   — рейтинг из XMP (0-5, 0 = не задан)
    rotation — поворот в UI (0, 90, 180, 270). Сигнал ретушёру.
    tags     — теги площадок публикации (WB, Ozon, соцсети, баннер и т.д.)
    source   — источник отбора: "card" | "extra" | None
    """

    name: str
    stem: str
    path: Path | None = None
    rating: int = 0
    rotation: int = 0
    tags: list[str] = field(default_factory=list)
    source: str | None = None

    # ── Фабрика ──

    @classmethod
    def from_path(cls, path: Path) -> Photo:
        """Создать Photo из пути к файлу."""
        return cls(name=path.name, stem=path.stem, path=path)

    @classmethod
    def from_name(cls, name: str) -> Photo:
        """Создать Photo только по имени (без пути)."""
        stem = Path(name).stem
        return cls(name=name, stem=stem, path=None)
