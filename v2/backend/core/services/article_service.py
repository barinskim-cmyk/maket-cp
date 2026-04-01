"""ArticleService — парсинг чек-листов артикулов из PDF/Excel/CSV.

Использует pdfplumber для извлечения текста и изображений из PDF.
Результат: список артикулов [{sku, category, color, refImage}].
refImage — base64 data:image/jpeg;base64,... для каталожного фото.
"""
from __future__ import annotations

import base64
import csv
import io
import json
import re
from pathlib import Path
from typing import Any


# ── SKU regex: типичные артикулы (буквы+цифры+дефисы, минимум 5 символов) ──
_SKU_RE = re.compile(r'[A-Za-z]{1,5}\d[\w\-]{4,}')

# ── Слова-стоп: исключить из SKU-кандидатов ──
_STOP_WORDS = {'color', 'image', 'photo', 'article', 'style', 'size'}


def _is_sku(text: str) -> bool:
    """Проверить, похожа ли строка на артикул."""
    if len(text) < 5 or len(text) > 60:
        return False
    if text.lower() in _STOP_WORDS:
        return False
    return bool(_SKU_RE.fullmatch(text))


class ArticleService:
    """Парсинг артикулов из разных форматов файлов."""

    def parse_pdf(self, file_path: str) -> dict[str, Any]:
        """Извлечь артикулы с изображениями из PDF.

        Использует pdfplumber:
        1. Извлекает текст с координатами — находит артикулы
        2. Извлекает изображения с координатами
        3. Сопоставляет каждый артикул с ближайшим изображением по Y-позиции

        Returns:
            {"articles": [...], "total": int} или {"error": "..."}
        """
        try:
            import pdfplumber
        except ImportError:
            return {"error": "pdfplumber не установлен. Выполните: pip install pdfplumber"}

        try:
            from PIL import Image
        except ImportError:
            return {"error": "Pillow не установлен. Выполните: pip install Pillow"}

        pdf_path = Path(file_path)
        if not pdf_path.exists():
            return {"error": f"Файл не найден: {file_path}"}

        articles: list[dict] = []
        seen_skus: set[str] = set()

        try:
            with pdfplumber.open(str(pdf_path)) as pdf:
                for page_idx, page in enumerate(pdf.pages):
                    page_articles = self._extract_page_articles(page, page_idx)
                    for art in page_articles:
                        if art['sku'] not in seen_skus:
                            seen_skus.add(art['sku'])
                            articles.append(art)
        except Exception as e:
            return {"error": f"Ошибка чтения PDF: {e}"}

        return {"articles": articles, "total": len(articles)}

    def _extract_page_articles(self, page, page_idx: int) -> list[dict]:
        """Извлечь артикулы и изображения с одной страницы PDF."""
        from PIL import Image

        # 1. Извлечь текстовые элементы с координатами
        chars = page.chars or []
        lines = self._group_chars_to_lines(chars)

        # 2. Найти SKU-кандидаты с Y-позициями
        sku_items: list[dict] = []
        for line_y, line_text in lines:
            # Попробовать извлечь артикул из строки
            tokens = re.split(r'[\s,;|/]+', line_text.strip())
            for token in tokens:
                token = token.strip()
                if _is_sku(token):
                    # Извлечь категорию из контекста строки (если есть)
                    category = self._guess_category(line_text, token)
                    sku_items.append({
                        'sku': token,
                        'y': line_y,
                        'category': category,
                        'line': line_text,
                    })
                    break  # одна строка = один артикул

        if not sku_items:
            return []

        # 3. Извлечь изображения с координатами
        images_data = self._extract_page_images(page)

        # 4. Сопоставить артикулы с ближайшими изображениями
        result: list[dict] = []
        for item in sku_items:
            ref_image = ''
            if images_data:
                # Найти ближайшее изображение по Y-позиции
                best_img = min(images_data, key=lambda img: abs(img['y'] - item['y']))
                # Если изображение не слишком далеко (в пределах 200pt)
                if abs(best_img['y'] - item['y']) < 200:
                    ref_image = best_img.get('base64', '')

            result.append({
                'sku': item['sku'],
                'category': item['category'],
                'color': self._extract_color(item['sku']),
                'refImage': ref_image,
            })

        return result

    def _group_chars_to_lines(self, chars: list) -> list[tuple[float, str]]:
        """Сгруппировать символы в строки по Y-позиции.

        Returns:
            [(y_position, line_text), ...]
        """
        if not chars:
            return []

        # Сортировать по top (Y), затем по x0
        sorted_chars = sorted(chars, key=lambda c: (round(c['top'], 1), c['x0']))

        lines: list[tuple[float, str]] = []
        current_y = sorted_chars[0]['top']
        current_text = ''
        threshold = 3.0  # порог группировки по Y (в пунктах)

        for ch in sorted_chars:
            if abs(ch['top'] - current_y) > threshold:
                if current_text.strip():
                    lines.append((current_y, current_text.strip()))
                current_y = ch['top']
                current_text = ch['text']
            else:
                current_text += ch['text']

        if current_text.strip():
            lines.append((current_y, current_text.strip()))

        return lines

    def _extract_page_images(self, page) -> list[dict]:
        """Извлечь изображения со страницы с координатами и base64.

        Returns:
            [{"y": float, "base64": "data:image/jpeg;base64,..."}]
        """
        from PIL import Image

        result: list[dict] = []
        try:
            images = page.images or []
        except Exception:
            return result

        for img_info in images:
            try:
                # pdfplumber image info содержит top, x0, x1, bottom
                y_pos = img_info.get('top', 0)

                # Получить изображение через crop
                x0 = img_info.get('x0', 0)
                top = img_info.get('top', 0)
                x1 = img_info.get('x1', x0 + 100)
                bottom = img_info.get('bottom', top + 100)

                # Crop region из страницы
                cropped = page.crop((x0, top, x1, bottom))
                pil_img = cropped.to_image(resolution=150).original

                # Конвертировать в JPEG base64
                buf = io.BytesIO()
                if pil_img.mode in ('RGBA', 'P'):
                    pil_img = pil_img.convert('RGB')
                pil_img.save(buf, format='JPEG', quality=75)
                b64 = base64.b64encode(buf.getvalue()).decode('ascii')

                result.append({
                    'y': y_pos,
                    'base64': f'data:image/jpeg;base64,{b64}',
                })
            except Exception:
                continue

        return result

    def _guess_category(self, line: str, sku: str) -> str:
        """Попробовать определить категорию по контексту строки."""
        lower = line.lower()
        if any(w in lower for w in ('shoe', 'обувь', 'boot', 'sneaker', 'sandal')):
            return 'shoes'
        if any(w in lower for w in ('bag', 'сумк', 'рюкзак', 'clutch', 'tote')):
            return 'bag'
        if any(w in lower for w in ('glass', 'очки', 'sunglass')):
            return 'glasses'
        if any(w in lower for w in ('accessor', 'аксессуар', 'belt', 'scarf', 'ремень')):
            return 'accessory'
        return ''

    def _extract_color(self, sku: str) -> str:
        """Извлечь цвет из SKU (часто последний сегмент через дефис)."""
        parts = sku.split('-')
        if len(parts) >= 3:
            candidate = parts[-2].lower() if parts[-1].isdigit() or len(parts[-1]) <= 3 else parts[-1].lower()
            colors = {
                'black', 'white', 'red', 'blue', 'green', 'brown', 'beige',
                'grey', 'gray', 'pink', 'navy', 'cream', 'tan', 'nude',
                'silver', 'gold', 'bordeaux', 'camel', 'ivory', 'cognac',
                'sand', 'taupe', 'olive', 'coral', 'mint', 'lavender',
            }
            if candidate in colors:
                return candidate
            # Проверить ещё один сегмент
            for p in parts:
                if p.lower() in colors:
                    return p.lower()
        return ''

    def parse_csv(self, file_path: str) -> dict[str, Any]:
        """Парсить CSV/TXT файл с артикулами."""
        path = Path(file_path)
        if not path.exists():
            return {"error": f"Файл не найден: {file_path}"}

        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            text = path.read_text(encoding='cp1251')

        articles: list[dict] = []
        # Определить разделитель
        first_line = text.split('\n')[0] if text else ''
        if '\t' in first_line:
            delimiter = '\t'
        elif ';' in first_line:
            delimiter = ';'
        else:
            delimiter = ','

        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        header = None
        sku_col = 0
        cat_col = -1
        color_col = -1

        for row in reader:
            if not row:
                continue
            if header is None:
                # Проверить, заголовок ли это
                lower_row = [c.lower().strip() for c in row]
                if any(h in lower_row for h in ('sku', 'article', 'артикул', 'art')):
                    header = lower_row
                    for i, h in enumerate(header):
                        if h in ('sku', 'article', 'артикул', 'art'):
                            sku_col = i
                        elif h in ('category', 'категория', 'cat'):
                            cat_col = i
                        elif h in ('color', 'цвет', 'colour'):
                            color_col = i
                    continue

            sku = row[sku_col].strip() if sku_col < len(row) else ''
            if not sku:
                continue
            articles.append({
                'sku': sku,
                'category': row[cat_col].strip() if cat_col >= 0 and cat_col < len(row) else '',
                'color': row[color_col].strip() if color_col >= 0 and color_col < len(row) else '',
                'refImage': '',
            })

        return {"articles": articles, "total": len(articles)}

    def parse_json(self, file_path: str) -> dict[str, Any]:
        """Парсить JSON файл с артикулами."""
        path = Path(file_path)
        if not path.exists():
            return {"error": f"Файл не найден: {file_path}"}

        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except Exception as e:
            return {"error": f"Ошибка JSON: {e}"}

        raw = data if isinstance(data, list) else data.get('articles', [])
        articles: list[dict] = []
        for item in raw:
            sku = str(item.get('sku', item.get('article', item.get('артикул', '')))).strip()
            if not sku:
                continue
            articles.append({
                'sku': sku,
                'category': item.get('category', item.get('категория', '')),
                'color': item.get('color', item.get('цвет', '')),
                'refImage': item.get('refImage', item.get('ref', item.get('image', ''))),
            })

        return {"articles": articles, "total": len(articles)}

    def parse_file(self, file_path: str) -> dict[str, Any]:
        """Универсальный парсер — определяет формат по расширению."""
        ext = Path(file_path).suffix.lower()
        if ext == '.pdf':
            return self.parse_pdf(file_path)
        elif ext == '.json':
            return self.parse_json(file_path)
        elif ext in ('.csv', '.txt', '.tsv'):
            return self.parse_csv(file_path)
        elif ext in ('.xlsx', '.xls'):
            return self._parse_excel(file_path)
        else:
            return {"error": f"Неподдерживаемый формат: {ext}"}

    def _parse_excel(self, file_path: str) -> dict[str, Any]:
        """Парсить Excel файл (опционально, если openpyxl установлен)."""
        try:
            import openpyxl
        except ImportError:
            return {"error": "openpyxl не установлен. Выполните: pip install openpyxl"}

        path = Path(file_path)
        if not path.exists():
            return {"error": f"Файл не найден: {file_path}"}

        try:
            wb = openpyxl.load_workbook(str(path), read_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            wb.close()
        except Exception as e:
            return {"error": f"Ошибка Excel: {e}"}

        if not rows:
            return {"articles": [], "total": 0}

        # Определить колонки по заголовку
        header = [str(c or '').lower().strip() for c in rows[0]]
        sku_col = 0
        cat_col = -1
        color_col = -1
        start = 0

        if any(h in header for h in ('sku', 'article', 'артикул', 'art')):
            start = 1
            for i, h in enumerate(header):
                if h in ('sku', 'article', 'артикул', 'art'):
                    sku_col = i
                elif h in ('category', 'категория', 'cat'):
                    cat_col = i
                elif h in ('color', 'цвет', 'colour'):
                    color_col = i

        articles: list[dict] = []
        for row in rows[start:]:
            if not row or sku_col >= len(row):
                continue
            sku = str(row[sku_col] or '').strip()
            if not sku:
                continue
            articles.append({
                'sku': sku,
                'category': str(row[cat_col] or '').strip() if cat_col >= 0 and cat_col < len(row) else '',
                'color': str(row[color_col] or '').strip() if color_col >= 0 and color_col < len(row) else '',
                'refImage': '',
            })

        return {"articles": articles, "total": len(articles)}
