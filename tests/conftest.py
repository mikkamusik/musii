import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "remote_script"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest


@pytest.fixture
def mikka_home(tmp_path, monkeypatch):
    home = tmp_path / "mikka-home"
    home.mkdir()
    monkeypatch.setenv("MIKKA_HOME", str(home))
    return home
