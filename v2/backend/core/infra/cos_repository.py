"""CosRepository — поиск и обновление .cos файлов Capture One."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path


class CosRepository:
    """Работа с .cos файлами Capture One.

    .cos — XML-файлы с настройками обработки каждого кадра.
    Имя файла: <photo_stem>.<ext>.cos (например IMG_0001.CR3.cos).
    Содержат тег <E K="Basic_Rating" V="5"/> для рейтинга.
    """

    def __init__(self, session_root: Path):
        self.session_root = session_root
        self._index: dict[str, list[Path]] | None = None

    def build_index(self) -> dict[str, list[Path]]:
        """Построить индекс: photo_stem → list[cos_path].

        Кеширует результат. Вызвать invalidate() для пересборки.
        """
        if self._index is not None:
            return self._index

        idx: dict[str, list[Path]] = {}
        for cos in self.session_root.rglob("*.cos"):
            # IMG_0001.CR3.cos → stem "IMG_0001.CR3" → stem "IMG_0001"
            photo_stem = Path(cos.stem).stem
            idx.setdefault(photo_stem, []).append(cos)
        self._index = idx
        return idx

    def invalidate(self) -> None:
        """Сбросить кеш индекса."""
        self._index = None

    def find_by_stem(self, stem: str) -> list[Path]:
        """Найти .cos файлы по стему фотографии."""
        index = self.build_index()
        return index.get(stem, [])

    def update_rating(self, cos_path: Path, rating: str, backup: bool = True) -> bool:
        """Обновить Basic_Rating в .cos файле.

        Returns: True если файл был изменён, False если рейтинг уже стоял.
        """
        data = cos_path.read_bytes()
        try:
            root = ET.fromstring(data)
        except ET.ParseError as e:
            raise RuntimeError(f"XML parse error in {cos_path}: {e}") from e

        changed = False
        found = False

        for elem in root.iter("E"):
            if elem.get("K") == "Basic_Rating":
                found = True
                if elem.get("V") != rating:
                    elem.set("V", rating)
                    changed = True

        if not found:
            dl = root.find(".//DL")
            if dl is None:
                raise RuntimeError(f"Не найден тег <DL> в {cos_path}")
            dl.insert(0, ET.Element("E", {"K": "Basic_Rating", "V": rating}))
            changed = True

        if changed:
            if backup:
                bak = cos_path.with_suffix(cos_path.suffix + ".bak")
                if not bak.exists():
                    bak.write_bytes(data)
            cos_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))

        return changed
