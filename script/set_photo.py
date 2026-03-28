#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
import tkinter as tk
from tkinter import filedialog
import xml.etree.ElementTree as ET

RATING_VALUE = "5"

def choose_folder(title: str) -> Path:
    root = tk.Tk()
    root.withdraw()
    root.update()
    path = filedialog.askdirectory(title=title, mustexist=True)
    root.destroy()
    if not path:
        print(f"Папка не выбрана: {title}", file=sys.stderr)
        sys.exit(1)
    return Path(path)

def collect_source_stems(source_dir: Path) -> set[str]:
    # берём базовые имена без расширения: IMG_0001 из IMG_0001.jpeg
    return {p.stem for p in source_dir.iterdir() if p.is_file()}

def index_cos_by_photo_stem(root_dir: Path) -> dict[str, list[Path]]:
    """
    Индексируем .cos по "базовому имени фото", т.е.:
    'IMG_0001.CR3.cos' -> photo_stem = 'IMG_0001'
    """
    idx: dict[str, list[Path]] = {}
    for cos in root_dir.rglob("*.cos"):
        # снимаем только ".cos"
        without_cos = cos.stem          # 'IMG_0001.CR3'
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

def main() -> None:
    source_dir = choose_folder("1) Папка со списком (JPEG) — берём имена")
    session_root = choose_folder("2) Папка сессии — ищем *.cos по подпапкам")

    source_stems = collect_source_stems(source_dir)
    cos_index = index_cos_by_photo_stem(session_root)

    updated = unchanged = missing = errors = duplicates = 0

    for stem in sorted(source_stems):
        matches = cos_index.get(stem)
        if not matches:
            missing += 1
            continue

        if len(matches) > 1:
            duplicates += 1  # обновим все найденные

        for cos_path in matches:
            try:
                changed = update_basic_rating_in_cos(cos_path, RATING_VALUE)
                if changed:
                    print(f"OK   {stem} -> {cos_path.name} (Basic_Rating={RATING_VALUE})")
                    updated += 1
                else:
                    unchanged += 1
            except Exception as e:
                print(f"ERR  {cos_path} ({e})", file=sys.stderr)
                errors += 1

    print("\nИтог:")
    print(f"  обновлено .cos: {updated}")
    print(f"  без изменений : {unchanged}")
    print(f"  не найдено    : {missing}")
    print(f"  дубликаты     : {duplicates}")
    print(f"  ошибки        : {errors}")

if __name__ == "__main__":
    main()