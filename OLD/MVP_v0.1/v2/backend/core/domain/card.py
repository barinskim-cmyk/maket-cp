"""Card, Slot, SlotDef, CardTemplate, Comment — карточка товара и её компоненты."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from .photo import Photo


# ── Комментарий ──

@dataclass
class Comment:
    """Комментарий к карточке или слоту."""

    author: str  # "photographer" | "client" | "retoucher"
    text: str
    created_at: str | None = None  # ISO 8601


# ── Слот (позиция в карточке) ──

@dataclass
class Slot:
    """Позиция в карточке. Содержит варианты (опции) фото.

    position  — порядковый номер в карточке (0 = top)
    aspect    — пропорции ("3:2" | "2:3")
    options   — варианты фото для этой позиции
    selected  — выбор клиента (галочка)
    comment   — комментарий клиента ("хочу ещё вариант")
    """

    position: int
    aspect: str = "2:3"
    options: list[Photo] = field(default_factory=list)
    selected: Photo | None = None
    comment: str | None = None

    @property
    def current(self) -> Photo | None:
        """Текущее фото: выбранное клиентом или первое из опций."""
        if self.selected:
            return self.selected
        return self.options[0] if self.options else None

    @property
    def has_options(self) -> bool:
        return len(self.options) > 1

    def add_option(self, photo: Photo) -> None:
        self.options.append(photo)

    def remove_option(self, photo: Photo) -> None:
        self.options = [p for p in self.options if p.name != photo.name]
        if self.selected and self.selected.name == photo.name:
            self.selected = None

    def select(self, photo: Photo) -> None:
        self.selected = photo


# ── Определение слота в шаблоне ──

@dataclass
class SlotDef:
    """Определение слота в шаблоне карточки."""

    aspect: str = "2:3"  # "3:2" | "2:3"
    label: str | None = None  # "главное фото", "деталь" и т.п.


# ── Шаблон карточки ──

@dataclass
class CardTemplate:
    """Шаблон карточки — задаётся при создании проекта.

    Определяет сетку: rows x cols слотов с пропорциями.
    Вариативность: min_photos / max_photos — диапазон допустимого количества.

    Примеры:
    - «горизонт + 3 вертикали»  → slots: [SlotDef("3:2"), SlotDef("2:3") x 3]
    - «4 вертикали»             → slots: [SlotDef("2:3")] * 4
    - «гибкий 2x3..5»          → grid 2 rows, min 6, max 10 slots
    """

    name: str
    id: str = ""  # h3, v4, grid_2x3 и т.д.
    slots: list[SlotDef] = field(default_factory=list)
    rows: int = 0  # 0 = auto (top + bottom layout)
    cols: int = 0  # 0 = auto
    min_photos: int = 0  # 0 = без ограничения
    max_photos: int = 0  # 0 = без ограничения

    @property
    def total_slots(self) -> int:
        return len(self.slots)

    @property
    def is_flexible(self) -> bool:
        return self.min_photos != self.max_photos and self.max_photos > 0

    # ── Предустановки ──

    @classmethod
    def horizontal_plus_verticals(cls, n: int = 3) -> CardTemplate:
        """Горизонт + N вертикалей (стандартный шаблон)."""
        slots = [SlotDef(aspect="3:2", label="главное фото")]
        slots += [SlotDef(aspect="2:3") for _ in range(n)]
        return cls(name=f"горизонт + {n} вертикали", id=f"h{n}", slots=slots)

    @classmethod
    def all_vertical(cls, n: int = 4) -> CardTemplate:
        """N вертикальных фото."""
        return cls(
            name=f"{n} вертикалей",
            id=f"v{n}",
            slots=[SlotDef(aspect="2:3") for _ in range(n)],
        )

    @classmethod
    def grid(cls, rows: int, cols: int, aspect: str = "2:3") -> CardTemplate:
        """Произвольная сетка NxM."""
        total = rows * cols
        return cls(
            name=f"Сетка {rows}x{cols}",
            id=f"grid_{rows}x{cols}",
            rows=rows,
            cols=cols,
            slots=[SlotDef(aspect=aspect) for _ in range(total)],
        )

    @classmethod
    def flexible(cls, min_n: int, max_n: int, aspect: str = "2:3") -> CardTemplate:
        """Гибкий шаблон: от min до max фото."""
        return cls(
            name=f"от {min_n} до {max_n} фото",
            id=f"flex_{min_n}_{max_n}",
            slots=[SlotDef(aspect=aspect) for _ in range(max_n)],
            min_photos=min_n,
            max_photos=max_n,
        )


# ── Карточка товара ──

@dataclass
class Card:
    """Карточка товара — центральная сущность системы.

    Статусы:
    - draft     — черновик, фотограф заполняет
    - pending   — отправлена клиенту на согласование
    - approved  — клиент утвердил
    - done      — обработка завершена
    """

    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    category: str = ""
    slots: list[Slot] = field(default_factory=list)
    status: str = "draft"
    comments: list[Comment] = field(default_factory=list)

    @classmethod
    def from_template(cls, template: CardTemplate, category: str = "") -> Card:
        """Создать карточку по шаблону."""
        slots = [
            Slot(position=i, aspect=sd.aspect)
            for i, sd in enumerate(template.slots)
        ]
        return cls(category=category, slots=slots)

    @property
    def photos(self) -> list[Photo]:
        """Все текущие фото карточки (по одному из каждого слота)."""
        return [s.current for s in self.slots if s.current]

    @property
    def photo_names(self) -> list[str]:
        return [p.name for p in self.photos]

    def add_comment(self, author: str, text: str) -> Comment:
        c = Comment(author=author, text=text)
        self.comments.append(c)
        return c
