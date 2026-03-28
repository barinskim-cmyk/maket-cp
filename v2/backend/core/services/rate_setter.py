"""RateSetterService — бизнес-логика выставления рейтингов в Capture One."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from ..infra.cos_repository import CosRepository


KNOWN_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".gif", ".webp",
    ".heic", ".heif", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2",
    ".raf", ".dng", ".pef", ".srw", ".raw", ".psd", ".psb",
}

KNOWN_SUFFIXES = ["_preview", "_prev", "_web", "_small", "_thumb", "_lowres", "_copy", " copy"]


class RateSetterService:
    """Сервис без UI — вызывается из web-интерфейса через bridge."""

    def __init__(self, rating: str = "5"):
        self.rating = rating

    # ── Очистка имён ──

    @staticmethod
    def strip_extension(name: str) -> str:
        p = Path(name)
        return p.stem if p.suffix.lower() in KNOWN_EXTENSIONS else name

    @staticmethod
    def strip_tail(stem: str) -> str:
        result = stem
        for suf in KNOWN_SUFFIXES:
            result = re.sub(re.escape(suf) + r"$", "", result, flags=re.IGNORECASE)
        return result

    def clean_name(self, name: str, strip_tails: bool = False) -> str:
        result = self.strip_extension(name.strip())
        if strip_tails:
            result = self.strip_tail(result)
        return result

    def parse_stems_from_text(self, text: str, strip_tails: bool = False) -> set[str]:
        stems = set()
        for line in text.strip().splitlines():
            line = line.strip()
            if line:
                stem = self.clean_name(line, strip_tails=strip_tails)
                if stem:
                    stems.add(stem)
        return stems

    def collect_source_stems(self, source_dir: Path, strip_tails: bool = False) -> set[str]:
        stems = set()
        for p in source_dir.iterdir():
            if p.is_file():
                stems.add(self.clean_name(p.name, strip_tails=strip_tails))
        return stems

    # ── Основной метод ──

    def run(
        self,
        stems: set[str],
        session_root: Path,
        log: Callable[[str], None] | None = None,
        dry_run: bool = False,
    ) -> dict:
        """Запуск обработки.

        Args:
            stems: множество имён (без расширений) для выставления рейтинга
            session_root: корневая папка сессии Capture One
            log: callback для вывода строк прогресса
            dry_run: если True — только показать что будет сделано, без записи

        Returns:
            dict с ключами: updated, unchanged, missing, duplicates, errors
        """
        if log is None:
            log = print

        repo = CosRepository(session_root)
        cos_index = repo.build_index()

        updated = unchanged = missing = errors = duplicates = 0

        for stem in sorted(stems):
            matches = cos_index.get(stem)
            if not matches:
                log(f"MISS {stem} — .cos не найден")
                missing += 1
                continue

            if len(matches) > 1:
                duplicates += 1

            for cos_path in matches:
                try:
                    if dry_run:
                        log(f"DRY  {stem} -> {cos_path.name}")
                        updated += 1
                    else:
                        changed = repo.update_rating(cos_path, self.rating)
                        if changed:
                            log(f"OK   {stem} -> {cos_path.name} (Basic_Rating={self.rating})")
                            updated += 1
                        else:
                            log(f"SKIP {stem} -> {cos_path.name} (уже {self.rating})")
                            unchanged += 1
                except Exception as e:
                    log(f"ERR  {stem} -> {cos_path} ({e})")
                    errors += 1

        return {
            "updated": updated,
            "unchanged": unchanged,
            "missing": missing,
            "duplicates": duplicates,
            "errors": errors,
        }
