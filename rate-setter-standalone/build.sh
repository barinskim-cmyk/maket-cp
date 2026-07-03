#!/bin/bash
# Сборка Content Pulse Rate Setter.app под macOS.
# Запуск из этой папки:  ./build.sh
#
# ВАЖНО: собирать нужно Python-ом с Tk 8.6. Системный Python 3.9 идёт с
# Tk 8.5.9, который на macOS не отрисовывает виджеты (пустое окно). Скрипт
# сам ищет подходящий Python с Tk >= 8.6.
set -e
cd "$(dirname "$0")"

pick_python() {
    for p in \
        /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 \
        /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
        /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
        python3.14 python3.13 python3.12 python3; do
        if command -v "$p" >/dev/null 2>&1; then
            ver=$("$p" -c 'import tkinter; print(tkinter.TkVersion)' 2>/dev/null || echo 0)
            if [ "$ver" = "8.6" ] || [ "$ver" = "9.0" ]; then
                echo "$p"; return 0
            fi
        fi
    done
    return 1
}

echo "==> Ищу Python с Tk 8.6…"
PY="$(pick_python || true)"
if [ -z "$PY" ]; then
    echo "ОШИБКА: не найден Python с Tk 8.6."
    echo "Поставьте Python с python.org (там Tk 8.6) и повторите."
    exit 1
fi
echo "    Использую: $PY (Tk $("$PY" -c 'import tkinter; print(tkinter.TkVersion)'))"

echo "==> Ставлю PyInstaller (если нет)…"
"$PY" -m pip install --quiet --upgrade pyinstaller

echo "==> Чищу прошлую сборку…"
rm -rf build dist

echo "==> Собираю .app…"
"$PY" -m PyInstaller --noconfirm "C1 Rate Setter.spec"

xattr -dr com.apple.quarantine "dist/Content Pulse Rate Setter.app" 2>/dev/null || true

echo ""
echo "==> Готово. Приложение: dist/Content Pulse Rate Setter.app"
echo "    Для коллег: запакуйте его в ZIP и отправьте."
