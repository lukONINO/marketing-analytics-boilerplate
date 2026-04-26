"""Date helpers.

All functions are pure and timezone-naive by default (we operate on
calendar dates, not instants). If you need wall-clock timezone logic,
pass an explicit `tz` — but the default matches how GSC/GA4 expose
dates (they report per calendar day in the property's timezone).

ISO week format used throughout the pipeline: ``YYYY-Www`` (e.g.
``2026-W17``). This is what aggregate_weekly.py consumes.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Optional

# Match YYYY-MM-DD with strict zero-padding. strptime alone accepts
# unpadded values ("2026-4-20") which would break our filename joins
# because data/raw/<source>/<date>.json must be byte-identical across
# runs.
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------------------------------------------------------------------
# Simple day helpers
# ---------------------------------------------------------------------

def today() -> date:
    """Return today's date (local)."""
    return date.today()


def yesterday() -> date:
    """Return yesterday's date (local)."""
    return date.today() - timedelta(days=1)


def parse_date(s: str) -> date:
    """Parse ``YYYY-MM-DD`` into a :class:`date`.

    Strict: requires 4-digit year and zero-padded month/day. Anything
    else raises :class:`ValueError`. This is stricter than
    :func:`datetime.strptime` (which accepts ``2026-4-20``) so that
    filename joins across runs stay byte-identical.
    """
    if not isinstance(s, str) or not _ISO_DATE_RE.match(s):
        raise ValueError(
            f"Expected date in strict YYYY-MM-DD format, got {s!r}"
        )
    return datetime.strptime(s, "%Y-%m-%d").date()


def last_n_days(n: int, end_date: Optional[date] = None) -> list[date]:
    """Return the last ``n`` days ending on ``end_date`` (inclusive).

    ``end_date`` defaults to :func:`yesterday` because that is the
    canonical "freshest complete day" for analytics backends. The
    returned list is sorted oldest → newest.
    """
    if n <= 0:
        raise ValueError("n must be positive")
    end = end_date or yesterday()
    return [end - timedelta(days=i) for i in range(n - 1, -1, -1)]


# ---------------------------------------------------------------------
# ISO week helpers
# ---------------------------------------------------------------------

def iso_week_of(d: date) -> tuple[int, int]:
    """Return ``(iso_year, iso_week)`` for ``d``.

    Note: ISO weeks belong to the year containing their Thursday, so
    Dec 31 2024 is in ISO 2025-W01. This matches ``%G-W%V``.
    """
    iso = d.isocalendar()
    return iso.year, iso.week


def iso_week_string(d: date) -> str:
    """Return ISO week label ``YYYY-Www`` (zero-padded) for ``d``."""
    y, w = iso_week_of(d)
    return f"{y:04d}-W{w:02d}"


def week_date_range(iso_week_str: str) -> tuple[date, date]:
    """Return (monday, sunday) dates for an ISO week string ``YYYY-Www``.

    Validates the format strictly — ``2026-W17`` yes, ``2026-17`` no.
    """
    if len(iso_week_str) != 8 or iso_week_str[4:6] != "-W":
        raise ValueError(
            f"Expected ISO week string 'YYYY-Www', got {iso_week_str!r}"
        )
    try:
        year = int(iso_week_str[:4])
        week = int(iso_week_str[6:])
    except ValueError as e:
        raise ValueError(
            f"Expected ISO week string 'YYYY-Www', got {iso_week_str!r}"
        ) from e
    if not (1 <= week <= 53):
        raise ValueError(f"ISO week out of range: {week}")

    # %G-%V-%u → ISO year / week / weekday (1 = Mon)
    monday = datetime.strptime(f"{year}-W{week:02d}-1", "%G-W%V-%u").date()
    sunday = monday + timedelta(days=6)
    return monday, sunday


def previous_full_iso_week(today_: Optional[date] = None) -> str:
    """Return the ISO week label for the most recent fully-complete week.

    "Full" = Monday through Sunday has entirely elapsed. So on a
    Monday, we return the week *ending yesterday*. On any other day
    of the week, we return the week ending on the most recent Sunday.
    """
    t = today_ or today()
    # Subtract weekday+1 days to get the previous Sunday (Mon=0..Sun=6).
    # weekday() gives 0 for Monday; so on Monday, -1 gives yesterday (Sun).
    days_back = t.weekday() + 1
    last_sunday = t - timedelta(days=days_back)
    return iso_week_string(last_sunday)
