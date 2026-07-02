# C1 Rate Setter — standalone

Отдельная утилита Rate Setter, вынесенная из Maket CP, чтобы делиться с коллегами.
Ставит рейтинг 5★ и ключевое слово `SELECTED` в `.cos`-файлы Capture One для отобранных кадров.

## Состав папки

- `C1_RateSetter.py` — приложение (один файл, только стандартная библиотека Python + tkinter).
- `C1 Rate Setter.spec` — PyInstaller spec для сборки `.app`.
- `build.sh` — сборка одной командой.
- `icon.icns` — иконка приложения.
- `Инструкция для коллег.txt` — кладётся в ZIP вместе с собранным `.app`.

## Важно: Tk 8.6

Сборку и запуск из исходника нужно делать Python-ом с **Tk 8.6**.
Системный macOS Python 3.9 идёт с Tk 8.5.9, который на macOS НЕ отрисовывает
виджеты (пустое окно). Подходит Python с python.org (там Tk 8.6).
`build.sh` сам находит правильный Python.

Проверить версию Tk: `python3 -c "import tkinter; print(tkinter.TkVersion)"`.

## Запуск из исходника (для разработки)

```bash
# Python с Tk 8.6 (пример — python.org framework build)
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 C1_RateSetter.py
```

## Сборка .app (macOS)

```bash
cd rate-setter-standalone
./build.sh
```

Готовое приложение: `dist/C1 Rate Setter.app`.
Для раздачи коллегам: запаковать `.app` в ZIP вместе с `Инструкция для коллег.txt`
(готовый архив — `share/C1 Rate Setter.zip`).

> Сборка возможна только на Mac (PyInstaller собирает под текущую ОС).
> `.app` не подписан — у коллег первый запуск через правый клик → «Открыть»
> (подробности в инструкции).

## Что и как меняется

Пишем в ДВА места, потому что Capture One показывает метаданные из базы сессии:

1. `.cos` (per-variant): в слое `<AL>` ставится `Basic_Rating=5` и
   `<E K="Content_Keywords" V="SELECTED||0">`. Сопоставление по `stem`.
   Бэкап `*.cos.bak`.
2. `.cosessiondb` (SQLite база сессии): `ZVARIANTMETADATA.ZBASIC_RATING=5` и
   `ZCONTENT_KEYWORDS="SELECTED||0"` для слоёв `ZADJUSTMENTLAYER` и
   `ZCOMBINEDSETTINGS` каждого варианта; ключевое слово добавляется в
   библиотеку `ZKEYWORD`. Бэкап `*.cosessiondb.bak`. Схема читается из базы
   в рантайме (через `ZENTITIES`/`PRAGMA`) — совместимо между версиями C1;
   если схема незнакома, запись в базу пропускается, `.cos` всё равно пишется.

Capture One должен быть ЗАКРЫТ во время работы (база занята, если он открыт).

## Расхождение с боевым сервисом

Логика согласована с `v2/backend/core/services/rate_setter.py` и `cos_repository.py`
(индекс по двойному `.stem`, бэкап `.bak`, латест-значение `Basic_Rating`).
В standalone намеренно убраны: настраиваемый рейтинг, кастомные префиксы/суффиксы,
dry-run — для простоты интерфейса. Зафиксированный набор: режимы папка/список,
галочка хвостиков, рейтинг 5 + `SELECTED`.
