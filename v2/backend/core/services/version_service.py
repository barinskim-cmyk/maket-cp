"""VersionService — управление версиями фото на этапах постпродакшна.

Отвечает за:
- Сбор COS-файла с диска для конкретного фото
- Чтение превью JPEG (экспортированного пользователем)
- Подготовку данных для загрузки в Supabase Storage
- Восстановление COS-файла на диск из загруженных данных
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Optional

from ..domain.photo_version import PhotoVersion, POSTPROD_STAGES
from ..infra.cos_repository import CosRepository


class VersionService:
    """Сервис версий фото для постпродакшна.

    Работает с локальной файловой системой (desktop).
    Загрузка в Supabase происходит на стороне JS через API.
    """

    def __init__(self) -> None:
        self._cos_repo: Optional[CosRepository] = None
        self._session_root: Optional[Path] = None

    def set_session_root(self, path: Path) -> None:
        """Установить корень сессии Capture One для поиска COS."""
        self._session_root = path
        self._cos_repo = CosRepository(path)

    def collect_cos_for_photo(self, photo_stem: str) -> Optional[dict]:
        """Найти COS-файл для фото и вернуть его содержимое как base64.

        Returns:
            dict с ключами: cos_base64, cos_filename, cos_size_bytes
            или None если COS не найден.
        """
        if not self._cos_repo:
            return None

        cos_paths = self._cos_repo.find_by_stem(photo_stem)
        if not cos_paths:
            return None

        # Берём первый найденный COS (обычно один на фото)
        cos_path = cos_paths[0]
        cos_bytes = cos_path.read_bytes()

        return {
            "cos_base64": base64.b64encode(cos_bytes).decode("ascii"),
            "cos_filename": cos_path.name,
            "cos_size_bytes": len(cos_bytes),
        }

    def read_preview_jpeg(self, jpeg_path: str) -> Optional[dict]:
        """Прочитать JPEG превью с диска и вернуть как base64.

        Args:
            jpeg_path: полный путь к JPEG файлу (экспортированному из C1)

        Returns:
            dict с ключами: preview_base64, filename, size_bytes
            или None если файл не найден.
        """
        p = Path(jpeg_path)
        if not p.exists() or not p.is_file():
            return None

        data = p.read_bytes()
        return {
            "preview_base64": base64.b64encode(data).decode("ascii"),
            "filename": p.name,
            "size_bytes": len(data),
        }

    def restore_cos_to_disk(
        self, photo_stem: str, cos_base64: str, target_dir: Optional[str] = None
    ) -> Optional[str]:
        """Восстановить COS-файл на диск из base64.

        Если target_dir не указан — кладёт рядом с оригинальным COS.
        Capture One подхватит файл автоматически.

        Returns:
            Путь к восстановленному файлу или None при ошибке.
        """
        cos_bytes = base64.b64decode(cos_base64)

        if target_dir:
            out_dir = Path(target_dir)
        elif self._cos_repo:
            # Ищем оригинальный COS чтобы положить рядом
            existing = self._cos_repo.find_by_stem(photo_stem)
            if existing:
                out_dir = existing[0].parent
            elif self._session_root:
                out_dir = self._session_root
            else:
                return None
        else:
            return None

        out_dir.mkdir(parents=True, exist_ok=True)

        # Имя файла: {photo_stem}.cos (или оригинальное если есть)
        if self._cos_repo:
            existing = self._cos_repo.find_by_stem(photo_stem)
            if existing:
                out_path = existing[0]
            else:
                out_path = out_dir / f"{photo_stem}.cos"
        else:
            out_path = out_dir / f"{photo_stem}.cos"

        # Бэкап текущего COS перед перезаписью
        if out_path.exists():
            bak = out_path.with_suffix(out_path.suffix + ".bak")
            if not bak.exists():
                bak.write_bytes(out_path.read_bytes())

        out_path.write_bytes(cos_bytes)

        # Инвалидировать кеш COS-репозитория
        if self._cos_repo:
            self._cos_repo.invalidate()

        return str(out_path)

    def create_version(
        self,
        photo_name: str,
        project_id: str,
        stage: str,
        version_num: int,
        preview_path: str = "",
        cos_path: str = "",
    ) -> PhotoVersion:
        """Создать объект PhotoVersion.

        Не сохраняет в базу — это делает JS через Supabase SDK.
        """
        return PhotoVersion(
            photo_name=photo_name,
            project_id=project_id,
            stage=stage,
            version_num=version_num,
            preview_path=preview_path,
            cos_path=cos_path,
        )
