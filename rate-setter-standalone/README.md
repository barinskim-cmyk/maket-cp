# Content Pulse Rate Setter — переехал

Rate Setter живёт в отдельном репозитории, чтобы его можно было
отдавать коллегам без доступа к основному продукту:

- Репозиторий: https://github.com/barinskim-cmyk/content-pulse-rate-setter
- Готовые сборки (Mac + Windows + инструкция):
  https://github.com/barinskim-cmyk/content-pulse-rate-setter/releases/tag/latest
- Пересборка: пуш в main того репо или `gh workflow run build.yml -R barinskim-cmyk/content-pulse-rate-setter`

Файлы в этой папке (кроме этого README) не отслеживаются git —
это локальная рабочая копия для ручных сборок через build.sh.
Правки исходника вносить в отдельном репозитории.
