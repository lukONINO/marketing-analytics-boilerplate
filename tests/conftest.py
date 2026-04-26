"""Make the ``scripts`` package importable from tests.

We keep the repo layout flat (no ``src/``) so that CLI invocations like
``python scripts/pull_gsc.py`` work without a wrapper. Pytest, however,
doesn't automatically add the project root to ``sys.path`` unless there
is a pyproject/pytest config pointing at it — this shim does that.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
