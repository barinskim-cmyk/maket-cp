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

Замечание про оформление на macOS: используются классические tk-виджеты
(не ttk) — именно они корректно отрисовываются в собранном .app. У полей
ввода задана явная рамка (highlightbackground), иначе на светлом фоне
белое поле сливается и его не видно. Приложение принудительно работает в
светлой теме (NSRequiresAquaSystemAppearance в Info.plist), чтобы поля не
становились тёмными по тёмному в Dark Mode.
"""
from __future__ import annotations

import re
import shutil
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

# Палитра. Рамки и заливка полей — то, что реально honor-ится классическим
# tk на macOS. Фон окна/подписей оставляем системным (светлым).
FIELD_BG = "#FFFFFF"     # заливка полей ввода
FIELD_FG = "#111111"     # текст в полях
FIELD_BORDER = "#8A8F98"  # рамка полей (видна на белом)
FIELD_FOCUS = "#2563EB"  # рамка при фокусе
FONT = ("Helvetica", 13)
FONT_BOLD = ("Helvetica", 13, "bold")


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
    """Окно утилиты на классическом tkinter.

    Раскладка на grid с одной растягивающейся колонкой: поля занимают всю
    ширину, кнопки выбора закреплены в фиксированной правой колонке вплотную
    к полю — поэтому не «ездят» при изменении размера окна. Поля ввода имеют
    явную серую рамку, чтобы быть видимыми на светлом фоне.
    """

    PAD = 16

    def __init__(self):
        super().__init__()
        self.title("Content Pulse · Rate Setter — 5* + SELECTED")
        self.geometry("760x660")
        self.minsize(660, 580)

        self.source_dir: Path | None = None
        self.session_root: Path | None = None
        self._stems: set[str] = set()
        self._keywords: list[str] = [KEYWORD_VALUE]

        self._build_ui()
        self.toggle_mode()
        self.names_text.focus_set()

    # ── Хелперы виджетов ──

    def _entry(self, parent) -> tk.Entry:
        return tk.Entry(parent, bg=FIELD_BG, fg=FIELD_FG, insertbackground=FIELD_FG,
                        relief="solid", bd=1, font=FONT,
                        highlightthickness=2, highlightbackground=FIELD_BORDER,
                        highlightcolor=FIELD_FOCUS)

    def _text(self, parent, height: int, wrap: str = "word") -> tk.Text:
        return tk.Text(parent, height=height, wrap=wrap,
                       bg=FIELD_BG, fg=FIELD_FG, insertbackground=FIELD_FG,
                       relief="solid", bd=1, font=FONT, padx=6, pady=6,
                       highlightthickness=2, highlightbackground=FIELD_BORDER,
                       highlightcolor=FIELD_FOCUS)

    @staticmethod
    def _label(parent, text: str, bold: bool = False) -> tk.Label:
        # Без переопределения цветов — дефолтный (чёрный в светлой теме) виден.
        return tk.Label(parent, text=text, font=(FONT_BOLD if bold else FONT), anchor="w")

    # ── Построение интерфейса ──

    def _build_ui(self):
        outer = tk.Frame(self, padx=self.PAD, pady=self.PAD)
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(5, weight=1)   # растягивается только лог

        # 1) Источник имён
        src = tk.LabelFrame(outer, text=" 1. Источник имён отобранных фото ",
                            font=FONT_BOLD, padx=12, pady=12)
        src.grid(row=0, column=0, sticky="ew")
        src.columnconfigure(0, weight=1)

        radios = tk.Frame(src)
        radios.grid(row=0, column=0, sticky="w")
        self.mode_var = tk.StringVar(value="list")
        tk.Radiobutton(radios, text="Из списка (текст)", variable=self.mode_var,
                       value="list", font=FONT, command=self.toggle_mode).pack(side="left")
        tk.Radiobutton(radios, text="Из папки", variable=self.mode_var,
                       value="folder", font=FONT, command=self.toggle_mode).pack(side="left", padx=(18, 0))

        self.strip_var = tk.BooleanVar(value=False)
        tk.Checkbutton(src, text="Убрать хвостики (_preview, _web, _copy и т.п.)",
                       variable=self.strip_var, font=FONT
                       ).grid(row=1, column=0, sticky="w", pady=(8, 10))

        # Контейнер-переключатель: список / папка
        self.swap = tk.Frame(src)
        self.swap.grid(row=2, column=0, sticky="nsew")
        self.swap.columnconfigure(0, weight=1)

        # режим «список»
        self.list_frame = tk.Frame(self.swap)
        self.list_frame.columnconfigure(0, weight=1)
        self._label(self.list_frame,
                    "Вставьте имена файлов — по одному на строку (можно с .jpg и без):"
                    ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 4))
        self.names_text = self._text(self.list_frame, height=8)
        self.names_text.grid(row=1, column=0, sticky="nsew")
        nsb = tk.Scrollbar(self.list_frame, orient="vertical", command=self.names_text.yview)
        nsb.grid(row=1, column=1, sticky="ns")
        self.names_text.configure(yscrollcommand=nsb.set)
        tbtns = tk.Frame(self.list_frame)
        tbtns.grid(row=2, column=0, columnspan=2, sticky="w", pady=(8, 0))
        tk.Button(tbtns, text="Вставить из буфера", command=self._paste_text).pack(side="left")
        tk.Button(tbtns, text="Загрузить .txt…", command=self._load_txt).pack(side="left", padx=(8, 0))
        tk.Button(tbtns, text="Очистить", command=lambda: self.names_text.delete("1.0", "end")).pack(side="left", padx=(8, 0))
        # Cmd+V: виртуальное событие <<Paste>> не зависит от раскладки (в т.ч.
        # русской), в отличие от <Command-v>. Это и чинит вставку списка.
        self.names_text.bind("<<Paste>>", self._paste_text)
        self.names_text.bind("<<SelectAll>>", self._select_all)
        for seq in ("<Command-v>", "<Command-V>", "<Control-v>"):
            self.names_text.bind(seq, self._paste_text)
        self.names_text.bind("<Command-a>", self._select_all)
        self.names_text.bind("<Control-a>", self._select_all)

        # режим «папка»
        self.folder_frame = tk.Frame(self.swap)
        self.folder_frame.columnconfigure(0, weight=1)
        self._label(self.folder_frame, "Папка с отобранными фотографиями:"
                    ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 4))
        self.src_entry = self._entry(self.folder_frame)
        self.src_entry.grid(row=1, column=0, sticky="ew", ipady=3)
        tk.Button(self.folder_frame, text="Выбрать…", command=self.pick_source
                  ).grid(row=1, column=1, padx=(8, 0))

        # Доп. кодовое слово (присваивается вместе с SELECTED)
        kwrow = tk.Frame(src)
        kwrow.grid(row=3, column=0, sticky="ew", pady=(12, 0))
        kwrow.columnconfigure(1, weight=1)
        self._label(kwrow, "Доп. кодовое слово (к SELECTED, необязательно):"
                    ).grid(row=0, column=0, sticky="w")
        self.extra_kw_entry = self._entry(kwrow)
        self.extra_kw_entry.grid(row=0, column=1, sticky="ew", padx=(8, 0), ipady=2)

        # 2) Папка сессии
        self._label(outer, "2. Папка сессии Capture One — где искать *.cos по подпапкам:"
                    ).grid(row=1, column=0, sticky="w", pady=(16, 4))
        sess = tk.Frame(outer)
        sess.grid(row=2, column=0, sticky="ew")
        sess.columnconfigure(0, weight=1)
        self.dst_entry = self._entry(sess)
        self.dst_entry.grid(row=0, column=0, sticky="ew", ipady=3)
        tk.Button(sess, text="Выбрать…", command=self.pick_target).grid(row=0, column=1, padx=(8, 0))

        # 3) Действия
        actions = tk.Frame(outer)
        actions.grid(row=3, column=0, sticky="ew", pady=(16, 12))
        actions.columnconfigure(2, weight=1)  # распорка перед «Выход»
        self.start_btn = tk.Button(actions, text="Старт: 5* + SELECTED",
                                   font=FONT_BOLD, command=self.start)
        self.start_btn.grid(row=0, column=0, sticky="w")
        tk.Button(actions, text="Очистить лог", command=self.clear_log
                  ).grid(row=0, column=1, sticky="w", padx=(8, 0))
        tk.Button(actions, text="Выход", command=self.destroy
                  ).grid(row=0, column=3, sticky="e")

        # 4) Лог
        self._label(outer, "Лог:").grid(row=4, column=0, sticky="w")
        logwrap = tk.Frame(outer)
        logwrap.grid(row=5, column=0, sticky="nsew", pady=(4, 0))
        logwrap.columnconfigure(0, weight=1)
        logwrap.rowconfigure(0, weight=1)
        self.log = self._text(logwrap, height=10, wrap="none")
        self.log.grid(row=0, column=0, sticky="nsew")
        lsb = tk.Scrollbar(logwrap, orient="vertical", command=self.log.yview)
        lsb.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=lsb.set, state="disabled")

        self.status = self._label(outer, "Готово.")
        self.status.grid(row=6, column=0, sticky="ew", pady=(8, 0))

    def _select_all(self, event=None):
        self.names_text.tag_add("sel", "1.0", "end-1c")
        return "break"

    # ── Переключение режима ──

    def toggle_mode(self):
        if self.mode_var.get() == "list":
            self.folder_frame.grid_remove()
            self.list_frame.grid(row=0, column=0, sticky="nsew")
        else:
            self.list_frame.grid_remove()
            self.folder_frame.grid(row=0, column=0, sticky="ew")

    # ── Текстовое поле ──

    def _paste_text(self, event=None):
        """Вставка из буфера — работает и внутри собранного .app на macOS."""
        try:
            text = self.clipboard_get()
            try:
                self.names_text.delete("sel.first", "sel.last")
            except tk.TclError:
                pass
            self.names_text.insert("insert", text)
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
        self.log.configure(state="normal")
        self.log.insert("end", s + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def set_running(self, running: bool):
        self.start_btn.configure(state=("disabled" if running else "normal"))

    # ── Запуск обработки ──

    def get_source_stems(self) -> set[str] | None:
        strip_tails = self.strip_var.get()
        if self.mode_var.get() == "folder":
            if not self.source_dir or not self.source_dir.exists():
                messagebox.showerror("Ошибка", "Не выбрана папка с отобранными фото (шаг 1).")
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
            messagebox.showerror("Ошибка", "Не выбрана папка сессии Capture One (шаг 2).")
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
        self.status.configure(text="Выполняется…")
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
        self.status.configure(text="Готово.")
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
        self.status.configure(text="Ошибка.")
        self.set_running(False)
        messagebox.showerror("Ошибка", msg)


if __name__ == "__main__":
    App().mainloop()
