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

    # ── Read API (used by SessionWatcher) ──

    def read_metadata(self, cos_path: Path) -> dict:
        """Read rating + keywords from a .cos file.

        Returns a dict {"rating": int|None, "keywords": list[str]}. Robust to
        missing tags; never raises on parse error (returns the empty default).

        Schema (per docs/agents/dev/rate-setter-sync-fixes-proposal-2026-04-23.md):
        - Rating: <E K="Basic_Rating" V="N"/>
        - Keywords: <KeywordsContainer><K N="kw1" S="set"/>…</KeywordsContainer>
        Some C1 versions store keywords directly as <E K="Keywords" V="kw1; kw2"/> —
        we accept either form.
        """
        try:
            data = cos_path.read_bytes()
            root = ET.fromstring(data)
        except Exception:
            return {"rating": None, "keywords": []}

        rating: int | None = None
        for elem in root.iter("E"):
            if elem.get("K") == "Basic_Rating":
                try:
                    rating = int(elem.get("V") or "")
                except (TypeError, ValueError):
                    rating = None
                break

        keywords: list[str] = []
        # Form A: dedicated container
        container = root.find(".//KeywordsContainer")
        if container is not None:
            for k in container.findall("K"):
                name = k.get("N")
                if name:
                    keywords.append(name)
        # Form B: legacy single E tag (semicolon-joined)
        if not keywords:
            for elem in root.iter("E"):
                if elem.get("K") in ("Keywords", "IPTC_Keywords"):
                    raw = elem.get("V") or ""
                    keywords = [s.strip() for s in raw.split(";") if s.strip()]
                    break

        return {"rating": rating, "keywords": keywords}

    def update_keywords(self, cos_path: Path, keywords: list[str], backup: bool = True) -> bool:
        """Add keywords to a .cos file (union with existing).

        Used by HotkeyService to tag selected variants with `_card:<uuid>` and
        `_slot:<n>`. Never removes existing keywords. Returns True if file
        was modified.
        """
        if not keywords:
            return False
        data = cos_path.read_bytes()
        try:
            root = ET.fromstring(data)
        except ET.ParseError as e:
            raise RuntimeError(f"XML parse error in {cos_path}: {e}") from e

        container = root.find(".//KeywordsContainer")
        if container is None:
            dl = root.find(".//DL")
            if dl is None:
                raise RuntimeError(f"<DL> tag missing in {cos_path}")
            container = ET.SubElement(dl, "KeywordsContainer")

        existing = {k.get("N") for k in container.findall("K") if k.get("N")}
        changed = False
        for kw in keywords:
            if kw and kw not in existing:
                ET.SubElement(container, "K", {"N": kw, "S": "MaketCP"})
                existing.add(kw)
                changed = True

        if changed:
            if backup:
                bak = cos_path.with_suffix(cos_path.suffix + ".bak")
                if not bak.exists():
                    bak.write_bytes(data)
            cos_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
        return changed

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
