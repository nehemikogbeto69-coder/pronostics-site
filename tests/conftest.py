"""Configuration de test : base de données temporaire, jamais la vraie."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# La variable doit être posée AVANT l'import de app.db, qui la lit au chargement.
_TMP = Path(tempfile.mkdtemp(prefix="prono-test-")) / "test.db"
os.environ["PRONOLAB_DB"] = str(_TMP)
os.environ["PRONOLAB_MODE"] = "demo"

from app import db  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    """Base vide avant chaque test."""
    db.init_db()
    db.reset_db()
    yield db
    db.reset_db()
