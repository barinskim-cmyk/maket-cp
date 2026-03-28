"""CardService — операции над карточками."""
from __future__ import annotations

from ..domain.card import Card, CardTemplate, Slot
from ..domain.photo import Photo


class CardService:
    """Бизнес-логика работы с карточками."""

    def create_card(self, template: CardTemplate, category: str = "") -> Card:
        """Создать карточку по шаблону."""
        return Card.from_template(template, category=category)

    def add_photo_to_slot(self, card: Card, slot_index: int, photo: Photo) -> None:
        """Добавить фото как опцию в слот."""
        if 0 <= slot_index < len(card.slots):
            card.slots[slot_index].add_option(photo)

    def remove_photo_from_slot(self, card: Card, slot_index: int, photo: Photo) -> None:
        """Удалить опцию из слота."""
        if 0 <= slot_index < len(card.slots):
            card.slots[slot_index].remove_option(photo)

    def swap_slots(self, card: Card, idx_a: int, idx_b: int) -> None:
        """Поменять содержимое двух слотов местами."""
        slots = card.slots
        if 0 <= idx_a < len(slots) and 0 <= idx_b < len(slots):
            slots[idx_a].options, slots[idx_b].options = slots[idx_b].options, slots[idx_a].options
            slots[idx_a].selected, slots[idx_b].selected = slots[idx_b].selected, slots[idx_a].selected

    def select_option(self, card: Card, slot_index: int, photo: Photo) -> None:
        """Клиент выбирает вариант в слоте."""
        if 0 <= slot_index < len(card.slots):
            card.slots[slot_index].select(photo)

    def set_slot_comment(self, card: Card, slot_index: int, comment: str) -> None:
        """Клиент оставляет комментарий к слоту."""
        if 0 <= slot_index < len(card.slots):
            card.slots[slot_index].comment = comment

    def approve_card(self, card: Card) -> None:
        """Клиент утверждает карточку."""
        card.status = "approved"

    def reject_card(self, card: Card, reason: str = "") -> None:
        """Клиент возвращает карточку на доработку."""
        card.status = "draft"
        if reason:
            card.add_comment("client", reason)
