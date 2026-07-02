#!/usr/bin/env python3
from __future__ import annotations

import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox
import xml.etree.ElementTree as ET

RATING_VALUE = "5"

import re

# Известные расширения фото/RAW — убираем всегда если встречаем в конце имени
KNOWN_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".gif", ".webp", ".heic", ".heif",
    ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf", ".dng", ".pef", ".srw",
    ".raw", ".psd", ".psb",
}

# Суффиксы-хвостики, которые убираем по галочке (без учёта регистра)
KNOWN_SUFFIXES = ["_preview", "_prev", "_web", "_small", "_thumb", "_lowres", "_copy", " copy"]


def strip_extension(name: str) -> str:
    """Убираем известное фото-расширение из имени файла, если оно есть.
    IMG_0001.jpeg -> IMG_0001
    IMG_0001.CR3  -> IMG_0001
    IMG_0001      -> IMG_0001  (без изменений)
    photo_jpg_v2  -> photo_jpg_v2  (не перепутает с расширением — нет точки)
    """
    p = Path(name)
    if p.suffix.lower() in KNOWN_EXTENSIONS:
        return p.stem
    return name


def strip_tail(stem: str) -> str:
    """Убираем известные хвостики из имени: IMG_0001_preview -> IMG_0001"""
    result = stem
    for suf in KNOWN_SUFFIXES:
        pattern = re.compile(re.escape(suf) + r'$', re.IGNORECASE)
        result = pattern.sub('', result)
    return result


def clean_name(name: str, strip_tails: bool = False) -> str:
    """Полная очистка имени: расширение (всегда) + хвостики (по флагу)."""
    result = strip_extension(name.strip())
    if strip_tails:
        result = strip_tail(result)
    return result


def parse_stems_from_text(text: str, strip_tails: bool = False) -> set[str]:
    """Парсим список имён фотографий из текста (по одному на строку)."""
    stems = set()
    for line in text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        stem = clean_name(line, strip_tails=strip_tails)
        if stem:
            stems.add(stem)
    return stems


def collect_source_stems(source_dir: Path, strip_tails: bool = False) -> set[str]:
    stems = set()
    for p in source_dir.iterdir():
        if p.is_file():
            stem = clean_name(p.name, strip_tails=strip_tails)
            stems.add(stem)
    return stems


def index_cos_by_photo_stem(root_dir: Path) -> dict[str, list[Path]]:
    idx: dict[str, list[Path]] = {}
    for cos in root_dir.rglob("*.cos"):
        without_cos = cos.stem               # 'IMG_0001.CR3'
        photo_stem = Path(without_cos).stem  # 'IMG_0001'
        idx.setdefault(photo_stem, []).append(cos)
    return idx


def update_basic_rating_in_cos(cos_path: Path, rating: str) -> bool:
    data = cos_path.read_bytes()
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise RuntimeError(f"XML parse error: {e}") from e

    changed = False
    found = False

    for e in root.iter("E"):
        if e.get("K") == "Basic_Rating":
            found = True
            if e.get("V") != rating:
                e.set("V", rating)
                changed = True

    if not found:
        dl = root.find(".//DL")
        if dl is None:
            raise RuntimeError("Не найден тег <DL> для вставки Basic_Rating")
        dl.insert(0, ET.Element("E", {"K": "Basic_Rating", "V": rating}))
        changed = True

    if changed:
        cos_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    return changed


def process(source_stems: set[str], session_root: Path, log):
    cos_index = index_cos_by_photo_stem(session_root)

    updated = unchanged = missing = errors = duplicates = 0

    for stem in sorted(source_stems):
        matches = cos_index.get(stem)
        if not matches:
            log(f"MISS {stem} — .cos не найден")
            missing += 1
            continue

        if len(matches) > 1:
            duplicates += 1

        for cos_path in matches:
            try:
                changed = update_basic_rating_in_cos(cos_path, RATING_VALUE)
                if changed:
                    log(f"OK   {stem} -> {cos_path.name} (Basic_Rating={RATING_VALUE})")
                    updated += 1
                else:
                    log(f"SKIP {stem} -> {cos_path.name} (уже {RATING_VALUE})")
                    unchanged += 1
            except Exception as e:
                log(f"ERR  {stem} -> {cos_path} ({e})")
                errors += 1

    return updated, unchanged, missing, duplicates, errors


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Capture One .cos — поставить 5★")
        self.geometry("900x620")

        self.source_dir: Path | None = None
        self.session_root: Path | None = None

        root = tk.Frame(self, padx=12, pady=12)
        root.pack(fill="both", expand=True)

        # === Режим выбора источника имён ===
        mode_frame = tk.LabelFrame(root, text="1) Источник имён фотографий", padx=8, pady=8)
        mode_frame.pack(fill="x", pady=(0, 10))

        self.mode_var = tk.StringVar(value="folder")

        # Радиокнопки
        radio_row = tk.Frame(mode_frame)
        radio_row.pack(fill="x", pady=(0, 6))
        tk.Radiobutton(radio_row, text="Из папки", variable=self.mode_var,
                        value="folder", command=self.toggle_mode).pack(side="left")
        tk.Radiobutton(radio_row, text="Из списка (текст)", variable=self.mode_var,
                        value="list", command=self.toggle_mode).pack(side="left", padx=(16, 0))

        # Панель «из папки»
        self.folder_frame = tk.Frame(mode_frame)
        self.folder_frame.pack(fill="x")
        self.src_entry = tk.Entry(self.folder_frame)
        self.src_entry.pack(side="left", fill="x", expand=True)
        tk.Button(self.folder_frame, text="Выбрать…", command=self.pick_source).pack(side="left", padx=(8, 0))

        # Панель «из списка»
        self.list_frame = tk.Frame(mode_frame)
        # не pack — покажем по переключению
        tk.Label(self.list_frame, text="Вставьте имена файлов (по одному на строку):").pack(anchor="w")
        self.names_text = tk.Text(self.list_frame, height=6, wrap="word")
        self.names_text.pack(fill="both", expand=True, pady=(4, 0))
        # Кнопки под текстовым полем
        txt_btns = tk.Frame(self.list_frame)
        txt_btns.pack(fill="x", pady=(4, 0))
        tk.Button(txt_btns, text="Вставить из буфера",
                  command=self._paste_text).pack(side="left")
        tk.Button(txt_btns, text="Загрузить .txt…", command=self._load_txt).pack(side="left", padx=(8, 0))
        tk.Button(txt_btns, text="Очистить", command=lambda: self.names_text.delete("1.0", "end")).pack(side="left", padx=(8, 0))
        # Cmd+V / Ctrl+V — нативная вставка macOS
        self.names_text.bind("<Command-v>", self._paste_text)
        self.names_text.bind("<Command-V>", self._paste_text)
        self.names_text.bind("<Control-v>", self._paste_text)
        self.names_text.focus_set()
        self.names_text.bind("<Command-a>", lambda e: self.names_text.tag_add("sel", "1.0", "end"))
        self.names_text.bind("<Control-a>", lambda e: self.names_text.tag_add("sel", "1.0", "end"))

        # Галочка «убрать хвостики»
        self.strip_var = tk.BooleanVar(value=False)
        tk.Checkbutton(mode_frame, text="Убрать хвостики (_preview, _web, _copy и т.п.)",
                        variable=self.strip_var).pack(anchor="w", pady=(4, 0))

        # === Папка сессии ===
        tk.Label(root, text="2) Папка сессии — где искать *.cos по подпапкам:").pack(anchor="w")
        row2 = tk.Frame(root)
        row2.pack(fill="x", pady=(4, 10))
        self.dst_entry = tk.Entry(row2)
        self.dst_entry.pack(side="left", fill="x", expand=True)
        tk.Button(row2, text="Выбрать…", command=self.pick_target).pack(side="left", padx=(8, 0))

        # === Кнопки ===
        btnrow = tk.Frame(root)
        btnrow.pack(fill="x", pady=(2, 10))
        self.start_btn = tk.Button(btnrow, text="Старт: поставить 5★", command=self.start)
        self.start_btn.pack(side="left")
        tk.Button(btnrow, text="Очистить лог", command=self.clear_log).pack(side="left", padx=(8, 0))
        tk.Button(btnrow, text="Выход", command=self.destroy).pack(side="right")

        # === Лог ===
        tk.Label(root, text="Лог:").pack(anchor="w")
        self.log = tk.Text(root, height=14, wrap="none")
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

        self.status = tk.Label(root, text="Готово.", anchor="w")
        self.status.pack(fill="x", pady=(8, 0))

    def _paste_text(self, event=None):
        try:
            self.tk.call('tk::mac::Paste', self.names_text)
        except Exception:
            try:
                self.names_text.event_generate("<<Paste>>")
            except Exception:
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

    def toggle_mode(self):
        mode = self.mode_var.get()
        if mode == "folder":
            self.list_frame.pack_forget()
            self.folder_frame.pack(fill="x")
        else:
            self.folder_frame.pack_forget()
            self.list_frame.pack(fill="both", expand=True)

    def pick_source(self):
        p = filedialog.askdirectory(title="Выберите папку со списком фотографий (JPEG)", mustexist=True)
        if p:
            self.source_dir = Path(p)
            self.src_entry.delete(0, "end")
            self.src_entry.insert(0, p)

    def pick_target(self):
        p = filedialog.askdirectory(title="Выберите папку сессии/корень для поиска .cos", mustexist=True)
        if p:
            self.session_root = Path(p)
            self.dst_entry.delete(0, "end")
            self.dst_entry.insert(0, p)

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

    def get_source_stems(self) -> set[str] | None:
        """Получаем список stems в зависимости от выбранного режима."""
        mode = self.mode_var.get()
        strip_tails = self.strip_var.get()
        if mode == "folder":
            if not self.source_dir or not self.source_dir.exists():
                messagebox.showerror("Ошибка", "Не выбрана папка 1 (источник имён).")
                return None
            stems = collect_source_stems(self.source_dir, strip_tails=strip_tails)
            self.append_log(f"Режим: папка — найдено {len(stems)} имён в {self.source_dir}")
        else:
            text = self.names_text.get("1.0", "end")
            stems = parse_stems_from_text(text, strip_tails=strip_tails)
            if not stems:
                messagebox.showerror("Ошибка", "Список имён пуст. Вставьте имена файлов.")
                return None
            self.append_log(f"Режим: список — {len(stems)} имён")
        self.append_log("Расширения (.jpeg, .cr3, .dng и т.п.) убираются автоматически")
        if strip_tails:
            self.append_log("Хвостики убраны (_preview, _web, _copy и т.п.)")
        return stems

    def start(self):
        stems = self.get_source_stems()
        if stems is None:
            return
        if not self.session_root or not self.session_root.exists():
            messagebox.showerror("Ошибка", "Не выбрана папка 2 (где искать .cos).")
            return

        self.append_log("=== Старт ===")
        self.append_log("Совет: закройте Capture One на время обработки.\n")
        self.status.configure(text="Выполняется…")
        self.set_running(True)

        # Сохраняем stems для передачи в поток
        self._stems = stems
        t = threading.Thread(target=self.run_job, daemon=True)
        t.start()

    def run_job(self):
        try:
            res = process(self._stems, self.session_root, log=self.append_log)
            self.after(0, lambda: self.finish(*res))
        except Exception as e:
            self.after(0, lambda: self.fail(str(e)))

    def finish(self, updated, unchanged, missing, duplicates, errors):
        self.append_log("\n=== Готово ===")
        self.append_log(f"Обновлено .cos: {updated}")
        self.append_log(f"Без изменений : {unchanged}")
        self.append_log(f"Не найдено    : {missing}")
        self.append_log(f"Дубликаты     : {duplicates}")
        self.append_log(f"Ошибки        : {errors}")
        self.status.configure(text="Готово.")
        self.set_running(False)
        messagebox.showinfo("Готово", f"Обновлено: {updated}\nНе найдено: {missing}\nОшибки: {errors}")

    def fail(self, msg: str):
        self.append_log("\n=== Ошибка ===\n" + msg)
        self.status.configure(text="Ошибка.")
        self.set_running(False)
        messagebox.showerror("Ошибка", msg)


if __name__ == "__main__":
    App().mainloop()
