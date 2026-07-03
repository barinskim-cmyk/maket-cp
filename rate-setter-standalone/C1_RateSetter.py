#!/usr/bin/env python3
"""Capture One Rate Setter — standalone-утилита.

Ставит рейтинг 5 звёзд и ключевое слово SELECTED в .cos-файлы Capture One
для фотографий, отобранных заказчиком/ретушёром.

Источник имён — папка с отобранными файлами ИЛИ список имён текстом.
Список работает и с расширением на конце (IMG_0001.jpg), и без него
(IMG_0001) — известные расширения убираются автоматически. Также
снимается Finder-овский маркер копии " (2)".
Хвостики (_preview, _web, _copy …) — по галочке.

Перед записью создаётся резервная копия .cos.bak (один раз на файл).

Зависимостей нет — только стандартная библиотека Python (tkinter).

Оформление: тёмная тема «Content Pulse» (палитра дизайн-системы,
style.css :root). Используются классические tk-виджеты (не ttk) — именно
они корректно отрисовываются в собранном .app. Все цвета задаются явно
на каждом виджете, поэтому системная светлая/тёмная тема не влияет.
Кнопки — кастомные (tk.Label): нативные tk.Button на macOS игнорируют bg.

Cmd+V/C/X/A: у frozen-приложения нет меню «Правка», поэтому системные
шорткаты не доходили до Tk (особенно на русской раскладке). Решение:
меню «Правка» с акселераторами (macOS обрабатывает их на уровне
приложения, независимо от раскладки) + фолбэк по физическим keycode.
"""
from __future__ import annotations

import re
import shutil
import sys
import sqlite3
import threading
import xml.etree.ElementTree as ET
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox

# ── Константы обработки ──

RATING_VALUE = "5"          # рейтинг, который проставляется
KEYWORD_VALUE = "SELECTED"  # ключевое слово, которое добавляется
KEYWORD_SOURCE = "ContentPulse"  # атрибут источника ключевого слова в C1

# Известные фото/RAW-расширения — убираются из имени всегда, если есть.
KNOWN_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".gif", ".webp", ".heic", ".heif",
    ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf", ".dng", ".pef", ".srw",
    ".raw", ".psd", ".psb",
}

# Хвостики, которые убираются по галочке (без учёта регистра).
KNOWN_SUFFIXES = ["_preview", "_prev", "_web", "_small", "_thumb", "_lowres", "_copy", " copy"]

# Маркер дубликата Finder в конце имени: " (2)", " (3)" — например
# "IMG_0001.jpg (2)". Снимается всегда, до разбора расширения.
FINDER_DUP_RE = re.compile(r"\s*\(\d+\)$")

# Палитра «тёмная плёнка» — токены дизайн-системы Content Pulse
# (v2/frontend/css/style.css :root, тёмная тема).
BG           = "#191919"  # фон окна
FIELD_BG     = "#242424"  # заливка полей ввода
FIELD_FG     = "#f2f2f2"  # текст в полях
FIELD_BORDER = "#383838"  # рамка полей
FIELD_FOCUS  = "#c9956b"  # рамка при фокусе (акцент)
LOG_BG       = "#141414"  # фон лога (--photo-bg)
ACCENT       = "#c9956b"
TEXT         = "#f2f2f2"
TEXT_2       = "#b5b5b5"
TEXT_3       = "#8f8f8f"
META         = "#707070"
LINE         = "#333333"
INVERT_BG    = "#f2f2f2"  # инверт-кнопка (как .btn-primary)
INVERT_FG    = "#1a1a1a"
DANGER       = "#c96b6b"

FONT      = ("Helvetica Neue", 13)
FONT_BOLD = ("Helvetica Neue", 13, "bold")
MONO      = ("Menlo", 12)
MONO_S    = ("Menlo", 10)


# ── Очистка имён ──

def strip_extension(name: str) -> str:
    """Убрать известное фото-расширение, если оно есть в конце имени.

    IMG_0001.jpg -> IMG_0001   (расширение из списка известных)
    IMG_0001     -> IMG_0001   (расширения нет — имя без изменений)
    """
    p = Path(name)
    return p.stem if p.suffix.lower() in KNOWN_EXTENSIONS else name


def strip_tail(stem: str) -> str:
    """Убрать известные хвостики из конца имени: IMG_0001_preview -> IMG_0001."""
    result = stem
    for suf in KNOWN_SUFFIXES:
        result = re.sub(re.escape(suf) + r"$", "", result, flags=re.IGNORECASE)
    return result


def clean_name(name: str, strip_tails: bool = False) -> str:
    """Полная очистка имени: дубль Finder + расширение (всегда) + хвостики (по флагу).

    Порядок важен: сначала снимаем " (2)" ("IMG_0001.jpg (2)" -> "IMG_0001.jpg"),
    потом расширение, потом — по флагу — хвостики.
    """
    result = FINDER_DUP_RE.sub("", name.strip())
    result = strip_extension(result)
    if strip_tails:
        result = strip_tail(result)
    return result


def parse_stems_from_text(text: str, strip_tails: bool = False) -> set[str]:
    """Разобрать список имён из текста (по одному имени на строку).

    Работает одинаково для строк с расширением и без него.
    """
    stems: set[str] = set()
    for line in text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        stem = clean_name(line, strip_tails=strip_tails)
        if stem:
            stems.add(stem)
    return stems


def collect_source_stems(source_dir: Path, strip_tails: bool = False) -> set[str]:
    """Собрать имена (без расширений) из всех файлов в папке."""
    stems: set[str] = set()
    for p in source_dir.iterdir():
        if p.is_file():
            stems.add(clean_name(p.name, strip_tails=strip_tails))
    return stems


# ── Работа с .cos ──

def index_cos_by_photo_stem(root_dir: Path) -> dict[str, list[Path]]:
    """Индекс: имя фото (без расширений) -> список путей к .cos.

    Имя .cos: <stem>.<ext>.cos, например IMG_0001.CR3.cos.
    Двойной .stem убирает и .cos, и расширение фото.
    """
    idx: dict[str, list[Path]] = {}
    for cos in root_dir.rglob("*.cos"):
        photo_stem = Path(cos.stem).stem
        idx.setdefault(photo_stem, []).append(cos)
    return idx


def _settings_layer(root: ET.Element) -> ET.Element | None:
    """Найти слой настроек, куда Capture One пишет рейтинг и ключевые слова.

    Структура .cos: <IMG>/<SLO> -> <VAR> -> {<DL>, <AL>, <SL>}.
      DL — базовый слой (дефолты, рейтинг 0),
      AL — активный слой: тут реальные рейтинг и Content_Keywords,
      SL — слой стиля.
    Эмпирически (по .cos, записанному самим C1) рейтинг и ключевые слова
    лежат в AL. Предпочитаем AL, затем DL.
    """
    var = root.find(".//VAR")
    if var is not None:
        for tag in ("AL", "DL"):
            el = var.find(tag)
            if el is not None:
                return el
    return root.find(".//DL")


def _merge_keywords(raw: str, keywords: list[str]) -> tuple[str, bool]:
    """Дописать ключевые слова к строке Content_Keywords.

    Формат, как пишет сам Capture One: токены "<имя>||N" через ЗАПЯТУЮ,
    например "SELECTED||0,HERO||0". Существующие токены сохраняем как есть
    (вместе с их суффиксом ||N), новые добавляем с ||0. Строка нормализуется
    к запятой — это чинит и старые записи, где по ошибке стояла ";".
    Возвращает (новая_строка, изменилось_ли).
    """
    raw = raw or ""
    # старые записи могли быть через ";" — поэтому делим и по ",", и по ";", и по переводу строки
    parts = [t.strip() for t in re.split(r"[,;\n]", raw) if t.strip()]
    names = [t.split("||")[0].strip() for t in parts]
    added = False
    for kw in keywords:
        if kw and kw not in names:
            parts.append(f"{kw}||0")
            names.append(kw)
            added = True
    new = ",".join(parts)
    changed = added or new != raw.strip()
    return new, changed


def update_cos(cos_path: Path, rating: str, keywords: list[str], backup: bool = True) -> tuple[bool, bool]:
    """Проставить рейтинг и добавить ключевые слова в один .cos.

    Пишет в слой AL (как сам Capture One). Чтение и запись — один раз.
    Перед изменением создаётся .bak. Возвращает (рейтинг_изменён, ключевые_добавлены).
    """
    data = cos_path.read_bytes()
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise RuntimeError(f"XML parse error: {e}") from e

    layer = _settings_layer(root)
    if layer is None:
        raise RuntimeError("Не найден слой настроек (VAR/AL/DL) в .cos")

    # 1) Рейтинг — Basic_Rating в активном слое.
    rating_changed = False
    rating_elem = next((e for e in layer.findall("E") if e.get("K") == "Basic_Rating"), None)
    if rating_elem is None:
        layer.insert(0, ET.Element("E", {"K": "Basic_Rating", "V": rating}))
        rating_changed = True
    elif rating_elem.get("V") != rating:
        rating_elem.set("V", rating)
        rating_changed = True

    # 2) Ключевые слова — Content_Keywords в активном слое.
    keyword_added = False
    if keywords:
        kw_elem = next((e for e in layer.findall("E") if e.get("K") == "Content_Keywords"), None)
        raw = (kw_elem.get("V") if kw_elem is not None else "") or ""
        new_val, keyword_added = _merge_keywords(raw, keywords)
        if keyword_added:
            if kw_elem is None:
                ET.SubElement(layer, "E", {"K": "Content_Keywords", "V": new_val})
            else:
                kw_elem.set("V", new_val)

    if rating_changed or keyword_added:
        if backup:
            bak = cos_path.with_suffix(cos_path.suffix + ".bak")
            if not bak.exists():
                bak.write_bytes(data)
        cos_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))

    return rating_changed, keyword_added


def process(source_stems: set[str], session_root: Path, log, keywords: list[str] | None = None) -> dict:
    """Обработать все имена. log — callable(str) для вывода прогресса.

    keywords — список ключевых слов (по умолчанию [SELECTED])."""
    if keywords is None:
        keywords = [KEYWORD_VALUE]
    cos_index = index_cos_by_photo_stem(session_root)

    updated = unchanged = missing = errors = duplicates = tagged = 0

    for stem in sorted(source_stems):
        matches = cos_index.get(stem)
        if not matches:
            log(f"НЕТ   {stem} — .cos не найден")
            missing += 1
            continue

        if len(matches) > 1:
            duplicates += 1

        for cos_path in matches:
            try:
                rating_changed, keyword_added = update_cos(
                    cos_path, RATING_VALUE, keywords
                )
                if keyword_added:
                    tagged += 1
                if rating_changed or keyword_added:
                    parts = []
                    if rating_changed:
                        parts.append(f"рейтинг={RATING_VALUE}")
                    if keyword_added:
                        parts.append("+".join(keywords))
                    log(f"OK    {stem} -> {cos_path.name} ({', '.join(parts)})")
                    updated += 1
                else:
                    log(f"ПРОП  {stem} -> {cos_path.name} (уже отмечен)")
                    unchanged += 1
            except Exception as e:
                log(f"ОШИБ  {stem} -> {cos_path} ({e})")
                errors += 1

    return {
        "updated": updated,
        "unchanged": unchanged,
        "missing": missing,
        "duplicates": duplicates,
        "errors": errors,
        "tagged": tagged,
    }


# ── Запись в базу сессии (.cosessiondb) ──
#
# Capture One держит метаданные в базе сессии (SQLite) и читает их оттуда,
# а .cos перечитывает лениво — поэтому одной правки .cos мало. Пишем и в базу.
# Схема (проверено на реальной базе C1 16.x):
#   ZIMAGE(ZDISPLAYNAME=имя без расширения) -> ZVARIANT(ZIMAGE) ->
#   слои ZADJUSTMENTLAYER и ZCOMBINEDSETTINGS -> ZVARIANTLAYER(ZMETADATA) ->
#   ZVARIANTMETADATA(ZBASIC_RATING, ZCONTENT_KEYWORDS="имя||0").
#   Библиотека ключевых слов — ZKEYWORD (имя без ||0, nested-set ZLEFT/ZRIGHT,
#   Z_ENT берём из ZENTITIES по имени 'Keyword' — устойчиво между версиями).
# Всё читается из базы в рантайме; если схема незнакома — пропускаем (только .cos).


def find_session_db(session_root: Path) -> Path | None:
    cands = list(session_root.glob("*.cosessiondb"))
    if not cands:
        cands = list(session_root.rglob("*.cosessiondb"))
    return cands[0] if cands else None


def _cols(con: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info('{table}')")}


def _ensure_keyword_lib(con: sqlite3.Connection, keyword: str, tabs: set[str]) -> None:
    """Добавить ключевое слово в библиотеку ZKEYWORD, если его там нет."""
    cur = con.cursor()
    if cur.execute("SELECT Z_PK FROM ZKEYWORD WHERE ZNAME=?", (keyword,)).fetchone():
        return
    ent = None
    if "ZENTITIES" in tabs:
        r = cur.execute("SELECT Z_ENT FROM ZENTITIES WHERE ZNAME='Keyword'").fetchone()
        ent = r[0] if r else None
    if ent is None:
        r = cur.execute("SELECT Z_ENT FROM ZKEYWORD LIMIT 1").fetchone()
        ent = r[0] if r else 44
    maxpk = cur.execute("SELECT COALESCE(MAX(Z_PK),0) FROM ZKEYWORD").fetchone()[0]
    maxright = cur.execute("SELECT COALESCE(MAX(ZRIGHT),0) FROM ZKEYWORD").fetchone()[0]
    cols = _cols(con, "ZKEYWORD")
    vals = {"Z_ENT": ent, "Z_PK": maxpk + 1, "ZNAME": keyword, "ZPARENT": None,
            "ZLEFT": maxright + 1, "ZRIGHT": maxright + 2, "ZISEXPORTABLE": 1}
    vals = {k: v for k, v in vals.items() if k in cols}
    cur.execute(
        f"INSERT INTO ZKEYWORD ({','.join(vals)}) VALUES ({','.join('?' * len(vals))})",
        list(vals.values()),
    )


def update_session_db(session_root: Path, stems: set[str], rating: str, keywords: list[str], log) -> dict:
    """Записать рейтинг и ключевые слова в .cosessiondb. Безопасно: бэкап,
    транзакция, самоадаптация под схему. Требует закрытого Capture One."""
    res = {"db": None, "db_updated": 0, "db_missing": 0, "db_skipped": None}
    db = find_session_db(session_root)
    if db is None:
        res["db_skipped"] = "база сессии (.cosessiondb) не найдена"
        log("  " + res["db_skipped"] + " — записан только .cos")
        return res
    res["db"] = str(db)

    bak = db.with_suffix(db.suffix + ".bak")
    if not bak.exists():
        shutil.copy2(db, bak)

    try:
        con = sqlite3.connect(str(db), timeout=3)
    except sqlite3.OperationalError as e:
        res["db_skipped"] = f"база занята ({e})"
        log(f"  база занята — закройте Capture One. Записан только .cos")
        return res

    try:
        tabs = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"ZIMAGE", "ZVARIANT", "ZVARIANTLAYER", "ZVARIANTMETADATA"}.issubset(tabs):
            res["db_skipped"] = "схема базы не распознана"
            log("  схема базы не распознана — записан только .cos")
            return res
        meta_cols = _cols(con, "ZVARIANTMETADATA")
        if "ZBASIC_RATING" not in meta_cols or "ZCONTENT_KEYWORDS" not in meta_cols:
            res["db_skipped"] = "нет полей рейтинга/ключевых слов в базе"
            log("  нет нужных полей в базе — записан только .cos")
            return res
        var_cols = _cols(con, "ZVARIANT")
        layer_fields = [c for c in ("ZADJUSTMENTLAYER", "ZCOMBINEDSETTINGS") if c in var_cols]
        if not layer_fields:
            res["db_skipped"] = "нет слоёв AL/Combined в базе"
            log("  нет слоёв AL/Combined в базе — записан только .cos")
            return res

        if keywords and "ZKEYWORD" in tabs:
            for kw in keywords:
                try:
                    _ensure_keyword_lib(con, kw, tabs)
                except Exception as e:
                    log(f"  библиотеку ключевых слов обновить не удалось ({e}) — продолжаю")

        cur = con.cursor()
        updated = missing = 0
        for stem in sorted(stems):
            imgs = cur.execute(
                "SELECT Z_PK FROM ZIMAGE WHERE ZDISPLAYNAME=? OR ZIMAGEFILENAME LIKE ?",
                (stem, stem + ".%"),
            ).fetchall()
            if not imgs:
                missing += 1
                continue
            touched = False
            for (img_pk,) in imgs:
                variants = cur.execute(
                    f"SELECT {','.join(layer_fields)} FROM ZVARIANT WHERE ZIMAGE=?", (img_pk,)
                ).fetchall()
                for layer_row in variants:
                    for layer_pk in layer_row:
                        if layer_pk is None:
                            continue
                        md = cur.execute(
                            "SELECT ZMETADATA FROM ZVARIANTLAYER WHERE Z_PK=?", (layer_pk,)
                        ).fetchone()
                        if not md or md[0] is None:
                            continue
                        md_pk = md[0]
                        row = cur.execute(
                            "SELECT ZCONTENT_KEYWORDS FROM ZVARIANTMETADATA WHERE Z_PK=?", (md_pk,)
                        ).fetchone()
                        if row is None:
                            continue
                        new_kw, _ = _merge_keywords(row[0], keywords) if keywords else (row[0] or "", False)
                        cur.execute(
                            "UPDATE ZVARIANTMETADATA SET ZBASIC_RATING=?, ZCONTENT_KEYWORDS=? WHERE Z_PK=?",
                            (int(rating), new_kw, md_pk),
                        )
                        touched = True
            if touched:
                updated += 1
            else:
                missing += 1
        con.commit()
        res["db_updated"] = updated
        res["db_missing"] = missing
        log(f"  база сессии обновлена: {updated} (не найдено в базе: {missing})")
    except Exception as e:
        con.rollback()
        res["db_skipped"] = f"ошибка записи: {e}"
        log(f"  ошибка записи в базу: {e} — база не тронута (есть бэкап .bak)")
    finally:
        con.close()
    return res


# ── GUI ──


class App(tk.Tk):
    """Окно утилиты в стиле дизайн-системы Content Pulse («тёмная плёнка»).

    Раскладка на grid с одной растягивающейся колонкой. Секции разделены
    волосяными линиями (как на лендинге), заголовки секций — моноширинные
    капс-подписи с акцентной стрелкой. Кнопки — кастомные tk.Label:
    нативные tk.Button на macOS игнорируют цвет фона и остались бы белыми.
    """

    PAD = 20

    def __init__(self):
        super().__init__()
        self.title("Content Pulse · Rate Setter — 5* + SELECTED")
        self.geometry("780x700")
        self.minsize(680, 600)
        self.configure(bg=BG)

        self.source_dir: Path | None = None
        self.session_root: Path | None = None
        self._stems: set[str] = set()
        self._keywords: list[str] = [KEYWORD_VALUE]
        self._running = False

        self._build_ui()
        self._install_edit_shortcuts()
        self.toggle_mode()
        self.names_text.focus_set()

    # ── Хелперы виджетов ──

    def _entry(self, parent) -> tk.Entry:
        return tk.Entry(parent, bg=FIELD_BG, fg=FIELD_FG, insertbackground=FIELD_FG,
                        relief="flat", bd=0, font=MONO,
                        highlightthickness=1, highlightbackground=FIELD_BORDER,
                        highlightcolor=FIELD_FOCUS,
                        selectbackground="#3a3a3a", selectforeground=TEXT)

    def _text(self, parent, height: int, wrap: str = "word", bg: str = FIELD_BG) -> tk.Text:
        return tk.Text(parent, height=height, wrap=wrap,
                       bg=bg, fg=FIELD_FG, insertbackground=FIELD_FG,
                       relief="flat", bd=0, font=MONO, padx=10, pady=8,
                       highlightthickness=1, highlightbackground=FIELD_BORDER,
                       highlightcolor=FIELD_FOCUS,
                       selectbackground="#3a3a3a", selectforeground=TEXT)

    @staticmethod
    def _label(parent, text: str, fg: str = TEXT_2, font=FONT) -> tk.Label:
        return tk.Label(parent, text=text, font=font, anchor="w", bg=BG, fg=fg)

    def _hairline(self, parent, row: int, pady=(18, 14)):
        """Волосяная линия-разделитель секций (как .cp-hairline на лендинге)."""
        line = tk.Frame(parent, bg=LINE, height=1)
        line.grid(row=row, column=0, sticky="ew", pady=pady)

    def _section_head(self, parent, num: str, text: str) -> tk.Frame:
        """Моно-заголовок секции: акцентная стрелка + номер + капс."""
        head = tk.Frame(parent, bg=BG)
        tk.Label(head, text="▸", font=MONO_S, bg=BG, fg=ACCENT).pack(side="left")
        tk.Label(head, text=f" {num} · {text}", font=MONO_S, bg=BG, fg=TEXT_3
                 ).pack(side="left")
        return head

    def _btn(self, parent, text: str, command, primary: bool = False) -> tk.Label:
        """Кастомная кнопка. primary — инверт (как .btn-primary),
        иначе — моно-аутлайн (как .ds-btn-mono)."""
        if primary:
            b = tk.Label(parent, text=text, bg=INVERT_BG, fg=INVERT_FG,
                         font=("Helvetica Neue", 13, "bold"), padx=18, pady=8, cursor="hand2")
            normal = (INVERT_BG, INVERT_FG)
            hover = ("#ffffff", "#000000")
        else:
            b = tk.Label(parent, text=text.upper(), bg=BG, fg=TEXT_2,
                         font=MONO_S, padx=12, pady=6, cursor="hand2",
                         highlightthickness=1, highlightbackground=FIELD_BORDER)
            normal = (BG, TEXT_2)
            hover = (BG, TEXT)
        b._enabled = True

        def on_click(_e):
            if b._enabled:
                command()

        def on_enter(_e):
            if b._enabled:
                b.configure(bg=hover[0], fg=hover[1])

        def on_leave(_e):
            if b._enabled:
                b.configure(bg=normal[0], fg=normal[1])

        b.bind("<Button-1>", on_click)
        b.bind("<Enter>", on_enter)
        b.bind("<Leave>", on_leave)
        b._colors = (normal, hover)
        return b

    def _btn_set_enabled(self, b: tk.Label, enabled: bool, primary: bool = False):
        b._enabled = enabled
        if enabled:
            b.configure(bg=b._colors[0][0], fg=b._colors[0][1], cursor="hand2")
        else:
            if primary:
                b.configure(bg="#4a4a4a", fg="#8a8a8a", cursor="arrow")
            else:
                b.configure(fg=META, cursor="arrow")

    # ── Построение интерфейса ──

    def _build_ui(self):
        outer = tk.Frame(self, padx=self.PAD, pady=self.PAD, bg=BG)
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(10, weight=1)   # растягивается только лог

        # 0) Шапка-логотип
        head = tk.Frame(outer, bg=BG)
        head.grid(row=0, column=0, sticky="ew")
        tk.Label(head, text="C O N T E N T   P U L S E", font=("Helvetica Neue", 14),
                 bg=BG, fg=TEXT).pack(side="left")
        tk.Label(head, text="   RATE SETTER · 5* + SELECTED", font=MONO_S,
                 bg=BG, fg=META).pack(side="left", pady=(3, 0))

        self._hairline(outer, 1, pady=(14, 14))

        # 1) Источник имён
        src = tk.Frame(outer, bg=BG)
        src.grid(row=2, column=0, sticky="ew")
        src.columnconfigure(0, weight=1)

        top = tk.Frame(src, bg=BG)
        top.grid(row=0, column=0, sticky="ew")
        self._section_head(top, "01", "ИСТОЧНИК ИМЁН ОТОБРАННЫХ ФОТО").pack(side="left")

        # режим: список / папка — моно-переключатель
        self.mode_var = tk.StringVar(value="list")
        tabs = tk.Frame(top, bg=BG)
        tabs.pack(side="right")
        self.tab_list = tk.Label(tabs, text="СПИСОК", font=MONO_S, bg=BG, fg=META,
                                 cursor="hand2", padx=8)
        self.tab_folder = tk.Label(tabs, text="ПАПКА", font=MONO_S, bg=BG, fg=META,
                                   cursor="hand2", padx=8)
        self.tab_list.pack(side="left")
        tk.Label(tabs, text="/", font=MONO_S, bg=BG, fg=LINE).pack(side="left")
        self.tab_folder.pack(side="left")
        self.tab_list.bind("<Button-1>", lambda e: self._set_mode("list"))
        self.tab_folder.bind("<Button-1>", lambda e: self._set_mode("folder"))

        # чекбокс «убрать хвостики» — кастомный, моно
        self.strip_var = tk.BooleanVar(value=False)
        self.strip_check = tk.Label(
            src, text="", font=MONO_S, bg=BG, fg=TEXT_2, cursor="hand2", anchor="w")
        self.strip_check.grid(row=1, column=0, sticky="w", pady=(10, 10))
        self.strip_check.bind("<Button-1>", self._toggle_strip)
        self._refresh_strip()

        # Контейнер-переключатель: список / папка
        self.swap = tk.Frame(src, bg=BG)
        self.swap.grid(row=2, column=0, sticky="nsew")
        self.swap.columnconfigure(0, weight=1)

        # режим «список»
        self.list_frame = tk.Frame(self.swap, bg=BG)
        self.list_frame.columnconfigure(0, weight=1)
        self._label(self.list_frame,
                    "Вставьте имена файлов — по одному на строку (можно с .jpg и без):",
                    fg=TEXT_2).grid(row=0, column=0, sticky="w", pady=(0, 6))
        self.names_text = self._text(self.list_frame, height=8)
        self.names_text.grid(row=1, column=0, sticky="nsew")
        tbtns = tk.Frame(self.list_frame, bg=BG)
        tbtns.grid(row=2, column=0, sticky="w", pady=(10, 0))
        self._btn(tbtns, "Вставить из буфера", self._paste_text).pack(side="left")
        self._btn(tbtns, "Загрузить .txt…", self._load_txt).pack(side="left", padx=(8, 0))
        self._btn(tbtns, "Очистить",
                  lambda: self.names_text.delete("1.0", "end")).pack(side="left", padx=(8, 0))

        # режим «папка»
        self.folder_frame = tk.Frame(self.swap, bg=BG)
        self.folder_frame.columnconfigure(0, weight=1)
        self._label(self.folder_frame, "Папка с отобранными фотографиями:",
                    fg=TEXT_2).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 6))
        self.src_entry = self._entry(self.folder_frame)
        self.src_entry.grid(row=1, column=0, sticky="ew", ipady=5)
        self._btn(self.folder_frame, "Выбрать…", self.pick_source
                  ).grid(row=1, column=1, padx=(8, 0))

        # Доп. кодовое слово
        kwrow = tk.Frame(src, bg=BG)
        kwrow.grid(row=3, column=0, sticky="ew", pady=(14, 0))
        kwrow.columnconfigure(1, weight=1)
        self._label(kwrow, "Доп. кодовое слово (к SELECTED, необязательно):",
                    fg=TEXT_2).grid(row=0, column=0, sticky="w")
        self.extra_kw_entry = self._entry(kwrow)
        self.extra_kw_entry.grid(row=0, column=1, sticky="ew", padx=(10, 0), ipady=4)

        self._hairline(outer, 3)

        # 2) Папка сессии
        self._section_head(outer, "02", "ПАПКА СЕССИИ CAPTURE ONE").grid(
            row=4, column=0, sticky="w")
        self._label(outer, "Корень сессии — *.cos ищутся по всем подпапкам:",
                    fg=TEXT_2).grid(row=5, column=0, sticky="w", pady=(8, 6))
        sess = tk.Frame(outer, bg=BG)
        sess.grid(row=6, column=0, sticky="ew")
        sess.columnconfigure(0, weight=1)
        self.dst_entry = self._entry(sess)
        self.dst_entry.grid(row=0, column=0, sticky="ew", ipady=5)
        self._btn(sess, "Выбрать…", self.pick_target).grid(row=0, column=1, padx=(8, 0))

        self._hairline(outer, 7)

        # 3) Действия
        actions = tk.Frame(outer, bg=BG)
        actions.grid(row=8, column=0, sticky="ew", pady=(0, 14))
        actions.columnconfigure(2, weight=1)  # распорка перед «Выход»
        self.start_btn = self._btn(actions, "Старт — 5* + SELECTED", self.start, primary=True)
        self.start_btn.grid(row=0, column=0, sticky="w")
        self._btn(actions, "Очистить лог", self.clear_log
                  ).grid(row=0, column=1, sticky="w", padx=(10, 0))
        self._btn(actions, "Выход", self.destroy).grid(row=0, column=3, sticky="e")

        # 4) Лог
        self._section_head(outer, "03", "ЛОГ").grid(row=9, column=0, sticky="w", pady=(0, 6))
        logwrap = tk.Frame(outer, bg=BG)
        logwrap.grid(row=10, column=0, sticky="nsew")
        logwrap.columnconfigure(0, weight=1)
        logwrap.rowconfigure(0, weight=1)
        self.log = self._text(logwrap, height=10, wrap="none", bg=LOG_BG)
        self.log.configure(font=("Menlo", 11), fg=TEXT_2)
        self.log.grid(row=0, column=0, sticky="nsew")
        self.log.configure(state="disabled")
        # подсветка статусов в логе
        self.log.tag_configure("err", foreground=DANGER)
        self.log.tag_configure("miss", foreground=ACCENT)
        self.log.tag_configure("ok", foreground=TEXT)

        self.status = tk.Label(outer, text="● ГОТОВО", font=MONO_S,
                               bg=BG, fg=META, anchor="w")
        self.status.grid(row=11, column=0, sticky="ew", pady=(10, 0))

    # ── Шорткаты Cmd+V/C/X/A ──
    #
    # У frozen-приложения нет меню «Правка», поэтому Cmd+V не работал:
    # Tk-шные class-биндинги ищут keysym «v», а на русской раскладке
    # приходит «Cyrillic_em». Меню с акселераторами обрабатывается самим
    # macOS независимо от раскладки — это основной фикс. Фолбэк по
    # физическим keycode ловит случаи, когда меню не перехватило.

    def _install_edit_shortcuts(self):
        acc = "Command" if sys.platform == "darwin" else "Ctrl"
        menubar = tk.Menu(self)
        edit = tk.Menu(menubar, tearoff=0)
        edit.add_command(label="Вырезать", accelerator=f"{acc}+X",
                         command=lambda: self._edit_action("cut"))
        edit.add_command(label="Копировать", accelerator=f"{acc}+C",
                         command=lambda: self._edit_action("copy"))
        edit.add_command(label="Вставить", accelerator=f"{acc}+V",
                         command=lambda: self._edit_action("paste"))
        edit.add_separator()
        edit.add_command(label="Выделить всё", accelerator=f"{acc}+A",
                         command=lambda: self._edit_action("selectall"))
        menubar.add_cascade(label="Правка", menu=edit)
        self.config(menu=menubar)

        if sys.platform == "darwin":
            # Фолбэк: физические keycode клавиш V/C/X/A на macOS
            # (не зависят от раскладки). Латинские keysym пропускаем —
            # их обрабатывает меню или родной биндинг (иначе двойная вставка).
            self.bind_all("<Command-KeyPress>", self._on_cmd_key, add="+")

    _MAC_KEYCODES = {9: "paste", 8: "copy", 7: "cut", 0: "selectall"}

    def _on_cmd_key(self, event):
        if event.keysym.lower() in ("v", "c", "x", "a"):
            return None  # латиница — обработает меню/класс-биндинг
        action = self._MAC_KEYCODES.get(event.keycode)
        if action:
            self._edit_action(action)
            return "break"
        return None

    def _edit_action(self, action: str):
        w = self.focus_get()
        if w is None:
            return
        is_text = isinstance(w, tk.Text)
        is_entry = isinstance(w, tk.Entry)
        if not (is_text or is_entry):
            return
        try:
            if action == "paste":
                try:
                    txt = self.clipboard_get()
                except tk.TclError:
                    return
                if is_text and str(w.cget("state")) == "disabled":
                    return
                try:
                    w.delete("sel.first", "sel.last")
                except tk.TclError:
                    pass
                w.insert("insert", txt)
                if is_text:
                    w.see("insert")
            elif action in ("copy", "cut"):
                try:
                    if is_text:
                        sel = w.get("sel.first", "sel.last")
                    else:
                        sel = w.get()[w.index("sel.first"):w.index("sel.last")]
                except tk.TclError:
                    return
                self.clipboard_clear()
                self.clipboard_append(sel)
                if action == "cut" and not (is_text and str(w.cget("state")) == "disabled"):
                    try:
                        w.delete("sel.first", "sel.last")
                    except tk.TclError:
                        pass
            elif action == "selectall":
                if is_text:
                    w.tag_add("sel", "1.0", "end-1c")
                else:
                    w.select_range(0, "end")
        except tk.TclError:
            pass

    # ── Переключение режима и чекбокс ──

    def _set_mode(self, value: str):
        self.mode_var.set(value)
        self.toggle_mode()

    def toggle_mode(self):
        if self.mode_var.get() == "list":
            self.folder_frame.grid_remove()
            self.list_frame.grid(row=0, column=0, sticky="nsew")
            self.tab_list.configure(fg=TEXT, font=("Menlo", 10, "underline"))
            self.tab_folder.configure(fg=META, font=MONO_S)
        else:
            self.list_frame.grid_remove()
            self.folder_frame.grid(row=0, column=0, sticky="ew")
            self.tab_folder.configure(fg=TEXT, font=("Menlo", 10, "underline"))
            self.tab_list.configure(fg=META, font=MONO_S)

    def _toggle_strip(self, _event=None):
        self.strip_var.set(not self.strip_var.get())
        self._refresh_strip()

    def _refresh_strip(self):
        mark = "x" if self.strip_var.get() else " "
        self.strip_check.configure(
            text=f"[{mark}] УБРАТЬ ХВОСТИКИ (_PREVIEW, _WEB, _COPY И Т.П.)",
            fg=(TEXT if self.strip_var.get() else TEXT_2))

    # ── Текстовое поле ──

    def _paste_text(self, event=None):
        """Вставка из буфера в поле списка (кнопка «Вставить из буфера»)."""
        try:
            text = self.clipboard_get()
            try:
                self.names_text.delete("sel.first", "sel.last")
            except tk.TclError:
                pass
            self.names_text.insert("insert", text)
            self.names_text.see("insert")
        except tk.TclError:
            pass
        return "break"

    def _load_txt(self):
        path = filedialog.askopenfilename(
            title="Выберите текстовый файл со списком фотографий",
            filetypes=[("Текстовые файлы", "*.txt"), ("Все файлы", "*.*")],
        )
        if path:
            try:
                text = Path(path).read_text(encoding="utf-8")
                self.names_text.delete("1.0", "end")
                self.names_text.insert("1.0", text)
            except Exception as e:
                messagebox.showerror("Ошибка", f"Не удалось прочитать файл:\n{e}")

    def pick_source(self):
        p = filedialog.askdirectory(title="Папка с отобранными фотографиями", mustexist=True)
        if p:
            self.source_dir = Path(p)
            self.src_entry.delete(0, "end")
            self.src_entry.insert(0, p)

    def pick_target(self):
        p = filedialog.askdirectory(title="Папка сессии Capture One (корень для поиска .cos)", mustexist=True)
        if p:
            self.session_root = Path(p)
            self.dst_entry.delete(0, "end")
            self.dst_entry.insert(0, p)

    # ── Лог ──

    def clear_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def append_log(self, s: str):
        tag = ()
        if s.startswith("ОШИБ") or s.startswith("=== Ошибка"):
            tag = ("err",)
        elif s.startswith("НЕТ"):
            tag = ("miss",)
        elif s.startswith("OK"):
            tag = ("ok",)
        self.log.configure(state="normal")
        self.log.insert("end", s + "\n", tag)
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_running(self, running: bool):
        self._running = running
        self._btn_set_enabled(self.start_btn, not running, primary=True)

    # ── Запуск обработки ──

    def get_source_stems(self) -> set[str] | None:
        strip_tails = self.strip_var.get()
        if self.mode_var.get() == "folder":
            if not self.source_dir or not self.source_dir.exists():
                messagebox.showerror("Ошибка", "Не выбрана папка с отобранными фото (шаг 01).")
                return None
            stems = collect_source_stems(self.source_dir, strip_tails=strip_tails)
            self.append_log(f"Режим: папка — найдено {len(stems)} имён в {self.source_dir}")
        else:
            stems = parse_stems_from_text(self.names_text.get("1.0", "end"), strip_tails=strip_tails)
            if not stems:
                messagebox.showerror("Ошибка", "Список имён пуст. Вставьте имена файлов.")
                return None
            self.append_log(f"Режим: список — {len(stems)} имён")
        self.append_log("Расширения (.jpg, .cr3, .dng и т.п.) убираются автоматически")
        if strip_tails:
            self.append_log("Хвостики убраны (_preview, _web, _copy и т.п.)")
        return stems

    def start(self):
        stems = self.get_source_stems()
        if stems is None:
            return
        if not self.session_root or not self.session_root.exists():
            messagebox.showerror("Ошибка", "Не выбрана папка сессии Capture One (шаг 02).")
            return

        # ключевые слова: SELECTED всегда + доп. слово, если введено
        keywords = [KEYWORD_VALUE]
        extra = self.extra_kw_entry.get().strip()
        if extra and extra != KEYWORD_VALUE:
            keywords.append(extra)
        self._keywords = keywords

        self.append_log("=== Старт ===")
        self.append_log(f"Ключевые слова: {', '.join(keywords)}")
        self.append_log("ВАЖНО: Capture One должен быть ЗАКРЫТ (пишем в базу сессии).\n")
        self.status.configure(text="● ВЫПОЛНЯЕТСЯ…", fg=ACCENT)
        self.set_running(True)

        self._stems = stems
        threading.Thread(target=self.run_job, daemon=True).start()

    def run_job(self):
        try:
            res = process(self._stems, self.session_root, log=self.append_log, keywords=self._keywords)
            self.append_log("\n--- база сессии (.cosessiondb) ---")
            db_res = update_session_db(
                self.session_root, self._stems, RATING_VALUE, self._keywords, log=self.append_log
            )
            res.update(db_res)
            self.after(0, lambda: self.finish(res))
        except Exception as e:
            msg = str(e)
            self.after(0, lambda: self.fail(msg))

    def finish(self, res: dict):
        self.append_log("\n=== Готово ===")
        kw_label = ", ".join(self._keywords)
        self.append_log(f"Обновлено .cos      : {res['updated']}")
        self.append_log(f"Ключевые слова ({kw_label}): {res['tagged']}")
        self.append_log(f"Без изменений       : {res['unchanged']}")
        self.append_log(f"Не найдено          : {res['missing']}")
        self.append_log(f"Дубликаты           : {res['duplicates']}")
        self.append_log(f"Ошибки              : {res['errors']}")
        if res.get("db_skipped"):
            self.append_log(f"База сессии          : пропущена ({res['db_skipped']})")
        else:
            self.append_log(f"База сессии (.cosessiondb): обновлено {res.get('db_updated', 0)}")
        self.status.configure(text="● ГОТОВО", fg=META)
        self.set_running(False)
        db_line = (f"\nБаза сессии: пропущена ({res['db_skipped']})"
                   if res.get("db_skipped")
                   else f"\nБаза сессии: обновлено {res.get('db_updated', 0)}")
        messagebox.showinfo(
            "Готово",
            f"Обновлено .cos: {res['updated']}\n"
            f"Ключевые слова ({', '.join(self._keywords)}): {res['tagged']}\n"
            f"Не найдено: {res['missing']}\n"
            f"Ошибки: {res['errors']}"
            + db_line,
        )

    def fail(self, msg: str):
        self.append_log("\n=== Ошибка ===\n" + msg)
        self.status.configure(text="● ОШИБКА", fg=DANGER)
        self.set_running(False)
        messagebox.showerror("Ошибка", msg)


if __name__ == "__main__":
    App().mainloop()
