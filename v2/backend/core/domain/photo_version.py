"""PhotoVersion — версия фото на этапе постпродакшна.

Одно фото может иметь несколько версий на каждом этапе пайплайна:
- color_correction: варианты ЦК (CC 1, CC 2, CC 3...)
- retouch: варианты ретуши
- grading: варианты грейдинга

Каждая версия = превью JPEG + полный COS-файл (все настройки Capture One,
включая локальные маски). COS хранится как файл в Supabase Storage.
Восстановление: скачать COS → положить на диск → Capture One подхватит.

Версии загружаются последовательно, но лежат параллельно для выбора.
Не у всех фото есть несколько вариантов — у большинства один.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


# Допустимые этапы постпродакшна
POSTPROD_STAGES = ("color_correction", "retouch", "grading")


@dataclass
class PhotoVersion:
    """Одна версия фото на этапе постпродакшна.

    photo_name    — имя исходного файла (IMG_0001.CR3)
    project_id    — id проекта в Supabase (uuid строкой)
    stage         — этап: color_correction | retouch | grading
    version_num   — порядковый номер версии (1, 2, 3...)
    preview_path  — путь к превью JPEG в Supabase Storage
    cos_path      — путь к COS-файлу в Supabase Storage
    selected      — заказчик выбрал этот вариант
    created_at    — когда версия была загружена (ISO 8601)
    """

    photo_name: str
    project_id: str
    stage: str
    version_num: int
    preview_path: str = ""
    cos_path: str = ""
    selected: bool = False
    created_at: str = ""

    def __post_init__(self) -> None:
        if self.stage not in POSTPROD_STAGES:
            raise ValueError(
                f"Недопустимый этап '{self.stage}'. "
                f"Допустимые: {POSTPROD_STAGES}"
            )
        if not self.created_at:
            self.created_at = datetime.now().isoformat()

    @property
    def label(self) -> str:
        """Человекочитаемая метка: CC 1, RT 2, GR 3."""
        prefix_map = {
            "color_correction": "CC",
            "retouch": "RT",
            "grading": "GR",
        }
        return f"{prefix_map[self.stage]} {self.version_num}"

    @property
    def storage_prefix(self) -> str:
        """Префикс пути в Supabase Storage.

        Формат: {project_id}/{photo_stem}/{stage}_{version_num}
        Пример: abc-123/IMG_0001/color_correction_2
        """
        from pathlib import Path
        stem = Path(self.photo_name).stem
        return f"{self.project_id}/{stem}/{self.stage}_{self.version_num}"
