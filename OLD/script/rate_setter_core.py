#!/usr/bin/env python3
"""Ядро Rate Setter — вся логика без GUI."""
from __future__ import annotations

import re
from pathlib import Path
import xml.etree.ElementTree as ET

RATING_VALUE = "5"

KNOWN_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".gif", ".webp", ".heic", ".heif",
    ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf", ".dng", ".pef", ".srw",
    ".raw", ".psd", ".psb",
}

KNOWN_SUFFIXES = ["_preview", "_prev", "_web", "_small", "_thumb", "_lowres", "_copy", " copy"]


def strip_extension(name: str) -> str:
    p = Path(name)
    if p.suffix.lower() in KNOWN_EXTENSIONS:
        return p.stem
    return name


def strip_tail(stem: str) -> str:
    result = stem
    for suf in KNOWN_SUFFIXES:
        pattern = re.compile(re.escape(suf) + r'$', re.IGNORECASE)
        result = pattern.sub('', result)
    return result


def clean_name(name: str, strip_tails: bool = False) -> str:
    result = strip_extension(name.strip())
    if strip_tails:
        result = strip_tail(result)
    return result


def parse_stems_from_text(text: str, strip_tails: bool = False) -> set[str]:
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
        without_cos = cos.stem
        photo_stem = Path(without_cos).stem
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


def process(source_stems: set[str], session_root: Path, log=None):
    """Запуск обработки. log — callable(str) для вывода строк."""
    if log is None:
        log = print

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

    return {
        "updated": updated,
        "unchanged": unchanged,
        "missing": missing,
        "duplicates": duplicates,
        "errors": errors,
    }
