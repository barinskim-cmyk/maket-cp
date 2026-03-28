"""PreviewService — сканирование папок и генерация миниатюр.

Desktop: работает с файловой системой + Pillow.
Web (будущее): заменяется на Supabase Storage с тем же интерфейсом.

Каждое превью: {name, path, thumb, rating} где thumb — base64 JPEG миниатюра.
Оригиналы остаются на диске, в памяти только миниатюры.
Рейтинг читается из XMP: встроенный в файл или sidecar (.xmp).
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

# Pillow — опциональная зависимость, фолбэк через base64 без ресайза
try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False

THUMB_MAX_SIZE = 300  # макс. сторона миниатюры (px)
THUMB_QUALITY = 70  # JPEG качество
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp", ".heic"}

# XMP namespace
XMP_NS = "http://ns.adobe.com/xap/1.0/"
XMP_RATING_RE = re.compile(r'xmp:Rating[=">\s]*(\d)', re.IGNORECASE)


@dataclass
class PreviewItem:
    """Одно превью в пуле."""

    name: str  # имя файла
    path: str  # абсолютный путь к оригиналу
    thumb: str = ""  # base64 JPEG миниатюра (data:image/jpeg;base64,...)
    width: int = 0  # ширина оригинала
    height: int = 0  # высота оригинала
    rating: int = 0  # рейтинг 0–5 из XMP

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "path": self.path,
            "thumb": self.thumb,
            "w": self.width,
            "h": self.height,
            "rating": self.rating,
        }


@dataclass
class PreviewFolder:
    """Результат сканирования папки."""

    folder_path: str
    items: list[PreviewItem] = field(default_factory=list)
    total_files: int = 0
    loaded: int = 0

    def to_dict(self) -> dict:
        return {
            "folder": self.folder_path,
            "total": self.total_files,
            "loaded": self.loaded,
            "items": [item.to_dict() for item in self.items],
        }


class PreviewService:
    """Сканирование папки + генерация миниатюр.

    Интерфейс одинаковый для desktop и web:
        scan_folder(path) → список превью с миниатюрами
        get_full_image(path) → base64 полного изображения
    """

    def __init__(self):
        self._thumb_cache: dict[str, str] = {}  # path → thumb base64

    def scan_folder(self, folder_path: str, on_progress=None) -> PreviewFolder:
        """Сканировать папку, вернуть список превью с миниатюрами.

        Args:
            folder_path: путь к папке с превью
            on_progress: callback(loaded, total) для прогресса

        Returns:
            PreviewFolder с миниатюрами
        """
        folder = Path(folder_path)
        if not folder.is_dir():
            return PreviewFolder(folder_path=folder_path)

        # Собираем все изображения
        files = sorted(
            [
                f
                for f in folder.iterdir()
                if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
            ],
            key=lambda f: f.name.lower(),
        )

        result = PreviewFolder(
            folder_path=folder_path, total_files=len(files)
        )

        for i, filepath in enumerate(files):
            item = self._make_preview(filepath)
            if item:
                result.items.append(item)
            result.loaded = i + 1

            if on_progress:
                on_progress(result.loaded, result.total_files)

        return result

    def get_full_image(self, path: str) -> str | None:
        """Получить base64 полного изображения (для карточки/экспорта).

        Returns:
            data:image/...;base64,... строка или None
        """
        filepath = Path(path)
        if not filepath.is_file():
            return None

        ext = filepath.suffix.lower()
        mime = "image/jpeg"
        if ext == ".png":
            mime = "image/png"
        elif ext == ".webp":
            mime = "image/webp"

        data = filepath.read_bytes()
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{b64}"

    def _make_preview(self, filepath: Path) -> PreviewItem | None:
        """Создать превью для одного файла."""
        str_path = str(filepath)
        rating = self._read_xmp_rating(filepath)

        # Кеш миниатюр
        if str_path in self._thumb_cache:
            thumb = self._thumb_cache[str_path]
            return PreviewItem(
                name=filepath.name, path=str_path, thumb=thumb, rating=rating
            )

        if HAS_PIL:
            item = self._make_preview_pil(filepath)
        else:
            item = self._make_preview_raw(filepath)

        if item:
            item.rating = rating
        return item

    def _make_preview_pil(self, filepath: Path) -> PreviewItem | None:
        """Генерация миниатюры через Pillow (оптимальный путь)."""
        try:
            img = Image.open(filepath)
            img.load()
            orig_w, orig_h = img.size

            # Ресайз
            ratio = min(THUMB_MAX_SIZE / orig_w, THUMB_MAX_SIZE / orig_h, 1.0)
            new_w = max(1, int(orig_w * ratio))
            new_h = max(1, int(orig_h * ratio))

            if ratio < 1.0:
                img = img.resize((new_w, new_h), Image.LANCZOS)

            # Конвертируем в RGB (для JPEG)
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")

            # Сохраняем в буфер
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=THUMB_QUALITY, optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            thumb = f"data:image/jpeg;base64,{b64}"

            self._thumb_cache[str(filepath)] = thumb

            return PreviewItem(
                name=filepath.name,
                path=str(filepath),
                thumb=thumb,
                width=orig_w,
                height=orig_h,
            )
        except Exception:
            return None

    def _make_preview_raw(self, filepath: Path) -> PreviewItem | None:
        """Фолбэк без Pillow — base64 оригинала (тяжелее, но работает)."""
        try:
            data = filepath.read_bytes()
            ext = filepath.suffix.lower()
            mime = "image/jpeg"
            if ext == ".png":
                mime = "image/png"
            elif ext == ".webp":
                mime = "image/webp"

            b64 = base64.b64encode(data).decode("ascii")
            thumb = f"data:{mime};base64,{b64}"

            self._thumb_cache[str(filepath)] = thumb

            return PreviewItem(
                name=filepath.name, path=str(filepath), thumb=thumb
            )
        except Exception:
            return None

    # ── Чтение рейтинга из XMP ──

    def _read_xmp_rating(self, filepath: Path) -> int:
        """Прочитать рейтинг (0–5) из XMP метаданных.

        Приоритет:
          1. Sidecar .xmp файл (рядом с изображением)
          2. Встроенный XMP в самом файле (JPEG/TIFF)
          3. Pillow getxmp() если доступен

        Returns:
            int 0–5
        """
        # 1. Sidecar .xmp
        rating = self._read_sidecar_xmp(filepath)
        if rating > 0:
            return rating

        # 2. Встроенный XMP (ищем блок в бинарном файле)
        rating = self._read_embedded_xmp(filepath)
        if rating > 0:
            return rating

        # 3. Pillow getxmp (Pillow 7.2+)
        if HAS_PIL:
            rating = self._read_pillow_xmp(filepath)
            if rating > 0:
                return rating

        return 0

    def _read_sidecar_xmp(self, filepath: Path) -> int:
        """Читаем рейтинг из sidecar .xmp файла."""
        # Пробуем несколько вариантов имени sidecar-файла
        xmp_paths = [
            filepath.with_suffix(".xmp"),           # IMG_001.xmp
            filepath.with_suffix(".XMP"),           # IMG_001.XMP
            filepath.parent / (filepath.stem + ".xmp"),
        ]
        for xmp_path in xmp_paths:
            if xmp_path.is_file():
                try:
                    text = xmp_path.read_text(encoding="utf-8", errors="ignore")
                    return self._parse_xmp_rating(text)
                except Exception:
                    pass
        return 0

    def _read_embedded_xmp(self, filepath: Path) -> int:
        """Извлекаем XMP-блок из бинарного файла (JPEG/TIFF).

        Читаем только первые 256KB — XMP всегда в начале файла.
        """
        try:
            with open(filepath, "rb") as f:
                data = f.read(256 * 1024)
            # XMP хранится между маркерами
            start_marker = b"<x:xmpmeta"
            end_marker = b"</x:xmpmeta>"

            start = data.find(start_marker)
            if start < 0:
                # Альтернативный формат
                start_marker = b"<rdf:RDF"
                end_marker = b"</rdf:RDF>"
                start = data.find(start_marker)

            if start < 0:
                return 0

            end = data.find(end_marker, start)
            if end < 0:
                return 0

            xmp_bytes = data[start : end + len(end_marker)]
            text = xmp_bytes.decode("utf-8", errors="ignore")
            return self._parse_xmp_rating(text)
        except Exception:
            return 0

    def _read_pillow_xmp(self, filepath: Path) -> int:
        """Читаем рейтинг через Pillow getxmp() (7.2+)."""
        try:
            img = Image.open(filepath)
            if hasattr(img, "getxmp"):
                xmp = img.getxmp()
                # xmp — dict, рейтинг в xmp['xmpmeta']['RDF']['Description']
                desc = xmp.get("xmpmeta", {})
                if isinstance(desc, dict):
                    rdf = desc.get("RDF", {})
                    if isinstance(rdf, dict):
                        d = rdf.get("Description", {})
                        if isinstance(d, dict):
                            r = d.get("Rating", d.get("rating", 0))
                            return max(0, min(5, int(r)))
            img.close()
        except Exception:
            pass
        return 0

    def _parse_xmp_rating(self, xmp_text: str) -> int:
        """Извлекает xmp:Rating из XMP-текста."""
        # Быстрый regex
        m = XMP_RATING_RE.search(xmp_text)
        if m:
            return max(0, min(5, int(m.group(1))))

        # XML-парсинг как запасной вариант
        try:
            root = ET.fromstring(xmp_text)
            # Ищем атрибут xmp:Rating в любом элементе
            for elem in root.iter():
                # Как атрибут
                for attr_name, attr_val in elem.attrib.items():
                    if "Rating" in attr_name:
                        return max(0, min(5, int(attr_val)))
                # Как дочерний элемент
                if "Rating" in (elem.tag or ""):
                    if elem.text and elem.text.strip().isdigit():
                        return max(0, min(5, int(elem.text.strip())))
        except Exception:
            pass

        return 0

    def clear_cache(self):
        """Очистить кеш миниатюр."""
        self._thumb_cache.clear()
