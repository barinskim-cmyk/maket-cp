"""Юнит-тесты записи ключевых слов в COS из Rate Setter (задача s1-16).

Покрывает дельту s1-16: RateSetterService.run(keywords=...) пишет ключевые
слова в .cos через CosRepository.update_keywords РЯДОМ с рейтингом. Проверяет
на реальных временных .cos файлах (XML C1), без внешних зависимостей.

Запуск:
    python3 tests/test_rate_setter_keywords.py
или через pytest, если установлен:
    python3 -m pytest tests/test_rate_setter_keywords.py -v

Все тесты работают во временной папке (tempfile) — реальные файлы не трогаются.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from core.infra.cos_repository import CosRepository  # noqa: E402
from core.services.rate_setter import RateSetterService  # noqa: E402


_COS_TEMPLATE = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<SODL><DL>{inner}</DL></SODL>'
)


def _mkcos(folder: Path, stem: str, rating: str = "0",
           keywords: list[str] | None = None) -> Path:
    """Создать минимальный валидный .cos (<stem>.CR3.cos) с рейтингом/КС."""
    inner = f'<E K="Basic_Rating" V="{rating}"/>'
    if keywords:
        ks = "".join(f'<K N="{k}" S="x"/>' for k in keywords)
        inner += f"<KeywordsContainer>{ks}</KeywordsContainer>"
    p = folder / f"{stem}.CR3.cos"
    p.write_text(_COS_TEMPLATE.format(inner=inner), encoding="utf-8")
    return p


def _read(cos: Path) -> dict:
    return CosRepository(cos.parent).read_metadata(cos)


def test_writes_keywords_and_rating() -> None:
    """keywords=[...] -> и рейтинг, и ключевые слова записаны; keyworded=1."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        cos = _mkcos(root, "IMG_0001", rating="0")
        svc = RateSetterService(rating="5")
        res = svc.run({"IMG_0001"}, root, log=lambda m: None,
                      keywords=["MaketCP", "card", "WB"])
        meta = _read(cos)
        assert meta["rating"] == 5, meta
        assert set(["MaketCP", "card", "WB"]).issubset(set(meta["keywords"])), meta
        assert res["updated"] == 1, res
        assert res["keyworded"] == 1, res
        assert res["errors"] == 0, res
        assert cos.with_suffix(cos.suffix + ".bak").exists(), "backup not written"


def test_backward_compat_no_keywords() -> None:
    """Без keywords поведение прежнее: рейтинг есть, КС-контейнер не создан."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        cos = _mkcos(root, "IMG_0002", rating="0")
        svc = RateSetterService(rating="5")
        res = svc.run({"IMG_0002"}, root, log=lambda m: None)
        meta = _read(cos)
        assert meta["rating"] == 5, meta
        assert meta["keywords"] == [], meta
        assert "keyworded" in res and res["keyworded"] == 0, res
        assert res["updated"] == 1, res


def test_keywords_union_no_dup() -> None:
    """union с существующими КС: старые сохранены, новые добавлены без дублей."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        cos = _mkcos(root, "IMG_0003", rating="5", keywords=["old"])
        svc = RateSetterService(rating="5")
        res = svc.run({"IMG_0003"}, root, log=lambda m: None,
                      keywords=["MaketCP", "old"])  # 'old' уже есть
        kws = _read(cos)["keywords"]
        assert kws.count("old") == 1, kws
        assert "MaketCP" in kws, kws
        assert res["keyworded"] == 1, res  # добавлен MaketCP -> файл изменён


def test_rerun_idempotent() -> None:
    """Повторный прогон с теми же КС и рейтингом: ничего не меняется."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _mkcos(root, "IMG_0004", rating="5", keywords=["MaketCP", "card"])
        svc = RateSetterService(rating="5")
        res = svc.run({"IMG_0004"}, root, log=lambda m: None,
                      keywords=["MaketCP", "card"])
        assert res["updated"] == 0, res
        assert res["unchanged"] == 1, res
        assert res["keyworded"] == 0, res


def test_rating_unchanged_but_keywords_added_counts_updated() -> None:
    """Рейтинг уже стоит, но добавлены КС -> файл изменён, updated=1."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        cos = _mkcos(root, "IMG_0005", rating="5")  # рейтинг уже = self.rating
        svc = RateSetterService(rating="5")
        res = svc.run({"IMG_0005"}, root, log=lambda m: None,
                      keywords=["MaketCP"])
        assert res["updated"] == 1, res
        assert res["unchanged"] == 0, res
        assert res["keyworded"] == 1, res
        assert "MaketCP" in _read(cos)["keywords"]


def test_dry_run_does_not_write_keywords() -> None:
    """dry_run=True с keywords: файл не тронут (ни рейтинг, ни КС, ни .bak)."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        cos = _mkcos(root, "IMG_0006", rating="0")
        before = cos.read_bytes()
        logs: list[str] = []
        svc = RateSetterService(rating="5")
        res = svc.run({"IMG_0006"}, root, log=logs.append, dry_run=True,
                      keywords=["MaketCP", "card"])
        assert cos.read_bytes() == before, "dry_run modified the .cos"
        assert not cos.with_suffix(cos.suffix + ".bak").exists(), "dry_run wrote .bak"
        assert res["updated"] == 1, res
        assert res["keyworded"] == 0, res
        # В лог dry-режима попадают ключевые слова (информативность).
        assert any("keywords:" in m for m in logs), logs


def test_missing_cos_counts_missing() -> None:
    """Стем без .cos -> missing, без побочных эффектов по КС."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        svc = RateSetterService(rating="5")
        res = svc.run({"NOPE"}, root, log=lambda m: None, keywords=["MaketCP"])
        assert res["missing"] == 1, res
        assert res["keyworded"] == 0, res


def test_empty_keyword_list_is_noop_for_keywords() -> None:
    """keywords=[] / [пустые строки] эквивалентно отсутствию КС."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        cos = _mkcos(root, "IMG_0007", rating="0")
        svc = RateSetterService(rating="5")
        res = svc.run({"IMG_0007"}, root, log=lambda m: None,
                      keywords=["", "  ", None])  # type: ignore[list-item]
        assert _read(cos)["keywords"] == [], "empty entries must not be written"
        assert res["keyworded"] == 0, res
        assert res["updated"] == 1, res  # рейтинг всё равно поставлен


def _run_standalone() -> int:
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run_standalone())
