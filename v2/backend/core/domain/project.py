"""Project — проект (съёмка)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .card import Card, CardTemplate


# ── Событие пайплайна ──

@dataclass
class StageEvent:
    """Запись о переходе между этапами пайплайна.

    stage_id    — id этапа (preselect, selection, client, color, ...)
    timestamp   — когда произошёл переход (ISO 8601)
    trigger     — что вызвало переход (описание триггера)
    note        — примечание (опционально)
    """

    stage_id: str
    timestamp: str = ""
    trigger: str = ""
    note: str = ""


@dataclass
class Project:
    """Один проект = одна съёмка.

    brand            — название бренда (EKONIKA, Rendez-Vous, ...)
    shoot_date       — дата съёмки (ISO 8601)
    template         — шаблон карточки для всего проекта
    cards            — список карточек товара
    categories       — список категорий товаров (из чек-листа съёмки)
    channels         — площадки публикации (WB, Ozon, Lamoda, сайт, соцсети)
    stage            — текущий индекс этапа пайплайна (0..7)
    stage_history    — журнал переходов между этапами
    """

    brand: str = ""
    shoot_date: str = ""
    template: CardTemplate = field(
        default_factory=lambda: CardTemplate.horizontal_plus_verticals(3)
    )
    cards: list[Card] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    channels: list[str] = field(default_factory=list)
    stage: int = 0
    stage_history: list[StageEvent] = field(default_factory=list)

    def add_card(self, category: str = "") -> Card:
        """Создать новую карточку по шаблону проекта."""
        card = Card.from_template(self.template, category=category)
        self.cards.append(card)
        return card

    def remove_card(self, card_id: str) -> bool:
        before = len(self.cards)
        self.cards = [c for c in self.cards if c.id != card_id]
        return len(self.cards) < before

    def get_card(self, card_id: str) -> Card | None:
        for c in self.cards:
            if c.id == card_id:
                return c
        return None

    def advance_stage(self, stage_id: str, trigger: str, note: str = "") -> StageEvent:
        """Зафиксировать переход на следующий этап."""
        event = StageEvent(
            stage_id=stage_id,
            timestamp=datetime.now().isoformat(),
            trigger=trigger,
            note=note,
        )
        self.stage_history.append(event)
        self.stage += 1
        return event

    def collect_photo_stems(self) -> set[str]:
        """Собрать все стемы фото из карточек (для Rate Setter)."""
        stems: set[str] = set()
        for card in self.cards:
            for photo in card.photos:
                stems.add(photo.stem)
        return stems

    @property
    def total_photos(self) -> int:
        return sum(len(c.photos) for c in self.cards)

    @property
    def stats(self) -> dict:
        by_status: dict[str, int] = {}
        for c in self.cards:
            by_status[c.status] = by_status.get(c.status, 0) + 1
        return {
            "total_cards": len(self.cards),
            "total_photos": self.total_photos,
            "by_status": by_status,
        }
