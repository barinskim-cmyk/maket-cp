# Релизный конвейер standalone-инструментов Content Pulse

Как собираются, публикуются, проверяются и самообновляются Cardboard и Rate Setter. Единый справочник: на этот файл можно ссылаться из любой сессии («смотри docs/tool-release-pipeline.md»).

Актуально на 06.07.2026. Всё описанное настроено, проверено вживую и работает.

## Карта

| | Cardboard | Rate Setter |
|---|---|---|
| Разработка (источник правды) | `maket-cp/cardboard-standalone/` | публичный репо (локальная копия `rate-setter-standalone/` устарела) |
| Публичный репо (сборки) | `barinskim-cmyk/content-pulse-cardboard` | `barinskim-cmyk/content-pulse-rate-setter` |
| Скачивание (без аккаунта GitHub) | github.com/barinskim-cmyk/content-pulse-cardboard/releases/latest | github.com/barinskim-cmyk/content-pulse-rate-setter/releases/latest |
| Артефакты релиза | macOS.zip, Windows.exe, их .sha256.txt, version.txt, INSTALL.md | macOS.zip, Windows.exe, их .sha256.txt, instruction.html |
| Самообновление | Mac: да (с 1.2.1); Windows: уведомление + ссылка (exe нельзя подменить на лету) | нет (пока) |

Релиз-тег в обоих репо — скользящий `latest`: каждая сборка заменяет файлы в одном и том же релизе.

## Как устроена сборка

Пуш в `main` публичного репо (или ручной запуск workflow) → GitHub Actions на macOS-раннере: PyInstaller собирает .app из исходников репо → ad-hoc codesign → ditto-zip → SHA-256 → `version.txt` (из Info.plist) → **аттестация происхождения** (`actions/attest-build-provenance@v2`) → публикация в релиз `latest`. Занимает 2–4 минуты. Файлы: `.github/workflows/build.yml` в каждом репо.

## Три уровня проверки подлинности (для получателей)

1. **Аттестация**: GitHub криптографически подтверждает, что файл собран его сервером из исходников репо. Проверка: `gh attestation verify <файл> -R barinskim-cmyk/<репо>` (нужен GitHub CLI).
2. **Контрольная сумма**: `shasum -a 256 <файл>` должен совпасть с `.sha256.txt` из релиза.
3. **VirusTotal**: перетащить zip на virustotal.com (~70 антивирусов).

Инструкция для коллег по установке и обходу Gatekeeper — `INSTALL.md` (в репо Cardboard и в его релизе): Sequoia — «Готово» → Настройки → Конфиденциальность → «Открыть всё равно»; Sonoma — правый клик → Открыть; «повреждено» — `xattr -cr`.

## Самообновление Cardboard

Раз в сутки (и через Справка → «Проверить обновления») приложение читает `version.txt` из релиза. Новее — окно «Доступна версия X → Обновить сейчас»: автосейв → Python скачивает zip (без карантина Gatekeeper, т.к. качает не браузер) → распаковка → подмена .app с откатом через `.old` при ошибке → перезапуск без диалогов закрытия. Версия приложения живёт в ДВУХ местах: `CB_VERSION` в index.html и `CFBundleShortVersionString` в Cardboard.spec — **бампить вместе**.

## Как выпустить новую версию Cardboard (чеклист)

1. Изменения в `maket-cp/cardboard-standalone/` (разработка всегда тут), прогнать смоук.
2. Бампнуть версию в двух местах (index.html + spec).
3. Синхронизировать зеркало: скопировать `main.py index.html Cardboard.spec README.md INSTALL.md make_release.sh` в клон публичного репо (`git clone https://github.com/barinskim-cmyk/content-pulse-cardboard`), закоммитить, запушить.
4. Подождать CI (2–4 мин), проверить: `curl -sL .../releases/latest/download/version.txt` — CDN может отдавать 404 ещё ~минуту после сборки.
5. Всё: приложения у пользователей предложат обновление в течение суток.

## Грабли (уже собранные, не наступать)

- **certifi**: python.org-Python не доверяет ни одному HTTPS без certifi → самообновление падало с CERTIFICATE_VERIFY_FAILED. certifi обязан быть в `_ensure_deps`, `hiddenimports` спека и `pip install` CI.
- **WKWebView + PyInstaller**: не грузит file:// по симлинку (белое окно) — `find_frontend()` делает `.resolve()`; `private_mode=False` + `storage_path`, иначе стирается localStorage.
- **TCC**: без NS*FolderUsageDescription в Info.plist macOS молча запрещает чтение Загрузок/Документов — «файл не найден» на всё.
- **Скользящий тег latest**: ссылка `releases/latest/download/<файл>` стабильна, но обновляется с задержкой CDN.
- **Двойной дом Cardboard**: правки только в maket-cp, публичный репо — зеркало для сборок. Не редактировать зеркало напрямую.

## Что дальше (не сделано)

- **Телеметрия**: код в Cardboard 1.1.0+ готов и спит (CB_TOOLS_DB пуст). Нужен отдельный Supabase-проект: таблицы `cardboard_logs` (anon INSERT-only) и `app_versions` (anon SELECT-only), вписать url+ключ, пересобрать. Согласие спрашивается при первом запуске.
- **Developer ID + нотаризация** (99$/год): убирает предупреждения Gatekeeper совсем. Решение отложено до раздачи инструментов наружу.
- **Самообновление Rate Setter** — по той же схеме, когда понадобится.
