"""ProjectService — загрузка, сохранение, сериализация проекта."""
from __future__ import annotations

import json
from pathlib import Path

from ..domain.project import Project
from ..domain.card import Card, CardTemplate, Slot, SlotDef, Comment
from ..domain.photo import Photo


class ProjectService:
    """Работа с проектом: load/save в JSON."""

    def create(self, brand: str, shoot_date: str, template: CardTemplate) -> Project:
        return Project(brand=brand, shoot_date=shoot_date, template=template)

    # ── Сериализация ──

    def to_dict(self, project: Project) -> dict:
        """Проект → словарь (для JSON)."""
        return {
            "brand": project.brand,
            "shoot_date": project.shoot_date,
            "template": {
                "name": project.template.name,
                "slots": [
                    {"aspect": sd.aspect, "label": sd.label}
                    for sd in project.template.slots
                ],
            },
            "cards": [self._card_to_dict(c) for c in project.cards],
        }

    def from_dict(self, data: dict) -> Project:
        """Словарь → проект."""
        tmpl_data = data.get("template", {})
        template = CardTemplate(
            name=tmpl_data.get("name", ""),
            slots=[
                SlotDef(aspect=s.get("aspect", "2:3"), label=s.get("label"))
                for s in tmpl_data.get("slots", [])
            ],
        )
        project = Project(
            brand=data.get("brand", ""),
            shoot_date=data.get("shoot_date", ""),
            template=template,
        )
        for cd in data.get("cards", []):
            project.cards.append(self._card_from_dict(cd))
        return project

    # ── Файловые операции ──

    def save(self, project: Project, path: Path) -> None:
        """Сохранить проект в JSON-файл."""
        data = self.to_dict(project)
        # Атомарная запись: tmp → rename
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def load(self, path: Path) -> Project:
        """Загрузить проект из JSON-файла."""
        data = json.loads(path.read_text(encoding="utf-8"))
        return self.from_dict(data)

    # ── Приватные хелперы ──

    def _card_to_dict(self, card: Card) -> dict:
        return {
            "id": card.id,
            "category": card.category,
            "status": card.status,
            "slots": [
                {
                    "position": s.position,
                    "aspect": s.aspect,
                    "options": [{"name": p.name, "stem": p.stem} for p in s.options],
                    "selected": s.selected.name if s.selected else None,
                    "comment": s.comment,
                }
                for s in card.slots
            ],
            "comments": [
                {"author": c.author, "text": c.text, "created_at": c.created_at}
                for c in card.comments
            ],
        }

    def _card_from_dict(self, data: dict) -> Card:
        card = Card(
            id=data.get("id", ""),
            category=data.get("category", ""),
            status=data.get("status", "draft"),
        )
        for sd in data.get("slots", []):
            options = [Photo.from_name(p["name"]) for p in sd.get("options", [])]
            selected_name = sd.get("selected")
            selected = next((p for p in options if p.name == selected_name), None) if selected_name else None
            slot = Slot(
                position=sd.get("position", 0),
                aspect=sd.get("aspect", "2:3"),
                options=options,
                selected=selected,
                comment=sd.get("comment"),
            )
            card.slots.append(slot)
        for cd in data.get("comments", []):
            card.comments.append(Comment(**cd))
        return card
