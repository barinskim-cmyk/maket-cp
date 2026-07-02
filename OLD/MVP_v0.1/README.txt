Maket CP -- MVP v0.1
=====================
Дата: 28 марта 2026
Автор: Masha + Claude

Первая рабочая версия проекта.

Что работает:
- Создание съёмок с шаблонами карточек
- Три режима раскладки: landscape (заглавная V), portrait (заглавная H), equal
- Редактор шаблонов: drag-and-drop между рядами, клик для смены ориентации, "+" в рядах
- Layout engine v3: JS-sizing, равные высоты рядов, overflow на полную ширину
- Перетаскивание фото из превью-панели в слоты карточки
- Undo история
- Rate Setter (запись рейтингов в XMP/COS)
- Пайплайн по триггерам
- Работает в браузере без Python (browser fallback)

Запуск:
- Desktop: cd v2/backend && python3 main.py
- Браузер: открыть v2/frontend/index.html

Git tag: v0.1-mvp
