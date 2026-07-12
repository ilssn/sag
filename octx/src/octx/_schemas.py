from __future__ import annotations

import json
from functools import cache
from importlib import resources
from pathlib import Path
from typing import Any


@cache
def load_schema(name: str) -> dict[str, Any]:
    embedded = resources.files("octx").joinpath("schemas", "1.0", name)
    if embedded.is_file():
        return json.loads(embedded.read_text(encoding="utf-8"))
    project_schema = Path(__file__).resolve().parents[2] / "schemas" / "1.0" / name
    return json.loads(project_schema.read_text(encoding="utf-8"))
