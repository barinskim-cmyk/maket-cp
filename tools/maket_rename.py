#!/usr/bin/env python3
"""
Maket CP — Скрипт переименования фотографий по CSV-списку.

Использование:
  1. Экспортируйте CSV-список из Maket CP (вкладка Артикулы → Список на переименование)
  2. Положите этот скрипт (или .exe) в папку с фотографиями
  3. Запустите скрипт — он найдёт CSV-файл и переименует фотографии

CSV-формат:
  old_name,new_name
  DSC_0042.jpg,PL01056CN-13-black-26S_01.jpg
  DSC_0043.jpg,PL01056CN-13-black-26S_02.jpg

Особенности:
  - Автоматически находит rename_*.csv в текущей папке
  - Показывает предпросмотр перед переименованием
  - Создаёт лог rename_log.txt с результатами
  - Если файл с новым именем уже существует — пропускает (не перезаписывает)
  - Поддерживает вложенные папки (ищет файлы рекурсивно)

(c) Maket CP — maket-cp.com
"""

import os
import sys
import glob
import csv
import datetime


def find_csv_file():
    """Найти CSV-файл со списком переименования в текущей папке."""
    # Сначала ищем rename_*.csv
    csvs = glob.glob("rename_*.csv")
    if csvs:
        return csvs[0]
    # Потом любой .csv
    csvs = glob.glob("*.csv")
    if len(csvs) == 1:
        return csvs[0]
    elif len(csvs) > 1:
        print("\nНайдено несколько CSV-файлов:")
        for i, f in enumerate(csvs, 1):
            print(f"  {i}. {f}")
        choice = input(f"\nВыберите номер (1-{len(csvs)}): ").strip()
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(csvs):
                return csvs[idx]
        except ValueError:
            pass
        print("Неверный выбор.")
        return None
    return None


def find_file_recursive(name, base_dir="."):
    """Найти файл по имени, включая вложенные папки."""
    # Сначала в текущей папке
    if os.path.exists(os.path.join(base_dir, name)):
        return os.path.join(base_dir, name)
    # Потом рекурсивно
    for root, dirs, files in os.walk(base_dir):
        if name in files:
            return os.path.join(root, name)
    return None


def read_rename_list(csv_path):
    """Прочитать CSV-файл со списком переименования."""
    pairs = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        # Проверить заголовок
        if header and len(header) >= 2:
            h0 = header[0].strip().lower()
            h1 = header[1].strip().lower()
            # Если первая строка — данные, а не заголовок
            if h0 not in ("old_name", "old", "source", "from", "original") and "." in h0:
                pairs.append((header[0].strip(), header[1].strip()))

        for row in reader:
            if len(row) >= 2:
                old = row[0].strip()
                new = row[1].strip()
                if old and new:
                    pairs.append((old, new))
    return pairs


def main():
    print("=" * 50)
    print("  Maket CP — Переименование фотографий")
    print("=" * 50)

    # Найти CSV
    csv_path = find_csv_file()
    if not csv_path:
        print("\nCSV-файл не найден.")
        print("Положите rename_*.csv в эту папку и запустите снова.")
        input("\nНажмите Enter для выхода...")
        sys.exit(1)

    print(f"\nCSV-файл: {csv_path}")

    # Прочитать список
    pairs = read_rename_list(csv_path)
    if not pairs:
        print("CSV-файл пуст или имеет неправильный формат.")
        input("\nНажмите Enter для выхода...")
        sys.exit(1)

    # Проверить какие файлы существуют
    found = []
    not_found = []
    skipped = []

    for old_name, new_name in pairs:
        old_path = find_file_recursive(old_name)
        if not old_path:
            not_found.append((old_name, new_name))
            continue

        # Целевой путь — в той же папке что и оригинал
        target_dir = os.path.dirname(old_path) or "."
        new_path = os.path.join(target_dir, new_name)

        if os.path.exists(new_path):
            skipped.append((old_name, new_name, "файл с новым именем уже существует"))
            continue

        found.append((old_path, new_path, old_name, new_name))

    # Статистика без подтверждения (сопоставление уже сделано в Maket CP)
    print(f"\nФайлов для переименования: {len(found)}")
    if not_found:
        print(f"Не найдено: {len(not_found)}")
    if skipped:
        print(f"Пропущено (конфликт): {len(skipped)}")

    if not found:
        print("\nНет файлов для переименования.")
        if not_found:
            print("\nОтсутствующие файлы:")
            for old, new in not_found[:10]:
                print(f"  {old}")
            if len(not_found) > 10:
                print(f"  ... и ещё {len(not_found) - 10}")
        input("\nНажмите Enter для выхода...")
        sys.exit(0)

    print("\nПереименовываю...")  # сразу работаем

    # Переименование
    success = 0
    errors = []
    log_lines = []
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_lines.append(f"Maket CP Rename Log — {timestamp}")
    log_lines.append(f"CSV: {csv_path}")
    log_lines.append(f"Всего в списке: {len(pairs)}")
    log_lines.append("")

    for old_path, new_path, old_name, new_name in found:
        try:
            os.rename(old_path, new_path)
            success += 1
            log_lines.append(f"OK: {old_name} -> {new_name}")
        except Exception as e:
            errors.append((old_name, str(e)))
            log_lines.append(f"FAIL: {old_name} -> {new_name} ({e})")

    # Результаты
    print(f"\nГотово! Переименовано: {success} из {len(found)}")
    if errors:
        print(f"Ошибки: {len(errors)}")
        for name, err in errors[:5]:
            print(f"  {name}: {err}")
    if not_found:
        log_lines.append("")
        log_lines.append(f"Не найдено ({len(not_found)}):")
        for old, new in not_found:
            log_lines.append(f"  {old}")
    if skipped:
        log_lines.append("")
        log_lines.append(f"Пропущено ({len(skipped)}):")
        for old, new, reason in skipped:
            log_lines.append(f"  {old} -> {new} ({reason})")

    log_lines.append("")
    log_lines.append(f"Итого переименовано: {success}")

    # Записать лог
    log_path = "rename_log.txt"
    try:
        with open(log_path, "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
        print(f"Лог записан: {log_path}")
    except Exception:
        pass

    input("\nНажмите Enter для выхода...")


if __name__ == "__main__":
    main()
