"""Tests for scripts.utils.dates.

Uses freezegun to pin "today" deterministically so we don't get flaky
tests on week boundaries.
"""

from __future__ import annotations

from datetime import date

import pytest
from freezegun import freeze_time

from scripts.utils.dates import (
    iso_week_of,
    iso_week_string,
    last_n_days,
    parse_date,
    previous_full_iso_week,
    today,
    week_date_range,
    yesterday,
)


# ---------------------------------------------------------------------
# today / yesterday / parse_date
# ---------------------------------------------------------------------

@freeze_time("2026-04-21")
def test_today() -> None:
    assert today() == date(2026, 4, 21)


@freeze_time("2026-04-21")
def test_yesterday() -> None:
    assert yesterday() == date(2026, 4, 20)


def test_parse_date_ok() -> None:
    assert parse_date("2026-04-20") == date(2026, 4, 20)


@pytest.mark.parametrize(
    "bad",
    ["2026/04/20", "04-20-2026", "2026-4-20", "yesterday", "", "2026-13-01"],
)
def test_parse_date_rejects_junk(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_date(bad)


# ---------------------------------------------------------------------
# last_n_days
# ---------------------------------------------------------------------

@freeze_time("2026-04-21")
def test_last_n_days_default_end_is_yesterday() -> None:
    got = last_n_days(3)
    assert got == [date(2026, 4, 18), date(2026, 4, 19), date(2026, 4, 20)]


def test_last_n_days_explicit_end() -> None:
    got = last_n_days(3, end_date=date(2026, 4, 15))
    assert got == [date(2026, 4, 13), date(2026, 4, 14), date(2026, 4, 15)]


def test_last_n_days_one() -> None:
    assert last_n_days(1, end_date=date(2026, 4, 10)) == [date(2026, 4, 10)]


def test_last_n_days_rejects_zero() -> None:
    with pytest.raises(ValueError):
        last_n_days(0)


def test_last_n_days_rejects_negative() -> None:
    with pytest.raises(ValueError):
        last_n_days(-1)


# ---------------------------------------------------------------------
# ISO week helpers
# ---------------------------------------------------------------------

def test_iso_week_of_midweek() -> None:
    # Tuesday 2026-04-21 — ISO week 17 of 2026
    assert iso_week_of(date(2026, 4, 21)) == (2026, 17)


def test_iso_week_string_padding() -> None:
    assert iso_week_string(date(2026, 1, 5)) == "2026-W02"
    assert iso_week_string(date(2026, 4, 21)) == "2026-W17"


def test_iso_week_year_rollover() -> None:
    # 2024-12-30 is Monday of ISO 2025-W01
    assert iso_week_of(date(2024, 12, 30)) == (2025, 1)
    assert iso_week_string(date(2024, 12, 30)) == "2025-W01"


def test_week_date_range_basic() -> None:
    monday, sunday = week_date_range("2026-W17")
    assert monday == date(2026, 4, 20)
    assert sunday == date(2026, 4, 26)


def test_week_date_range_first_week_of_iso_year() -> None:
    # 2025-W01 starts on Mon 2024-12-30
    monday, sunday = week_date_range("2025-W01")
    assert monday == date(2024, 12, 30)
    assert sunday == date(2025, 1, 5)


@pytest.mark.parametrize(
    "bad",
    ["2026W17", "2026-17", "26-W17", "2026-W99", "2026-W00", "", "weekly"],
)
def test_week_date_range_rejects_junk(bad: str) -> None:
    with pytest.raises(ValueError):
        week_date_range(bad)


def test_week_date_range_roundtrip() -> None:
    # The ISO week label for each day of the range should equal the input.
    label = "2026-W17"
    monday, sunday = week_date_range(label)
    for i in range((sunday - monday).days + 1):
        d = date.fromordinal(monday.toordinal() + i)
        assert iso_week_string(d) == label


# ---------------------------------------------------------------------
# previous_full_iso_week
# ---------------------------------------------------------------------

@freeze_time("2026-04-21")  # Tuesday
def test_previous_full_iso_week_from_tuesday() -> None:
    # Last full week ended Sun 2026-04-19, which is W16.
    assert previous_full_iso_week() == "2026-W16"


@freeze_time("2026-04-20")  # Monday
def test_previous_full_iso_week_from_monday() -> None:
    # On Monday, the week that just ended Sunday 2026-04-19 = W16.
    assert previous_full_iso_week() == "2026-W16"


@freeze_time("2026-04-19")  # Sunday
def test_previous_full_iso_week_from_sunday() -> None:
    # Sunday evening: last *full* week ended the prior Sunday = W15.
    assert previous_full_iso_week() == "2026-W15"


@freeze_time("2026-04-26")  # Sunday (end of W17)
def test_previous_full_iso_week_year_edge() -> None:
    # Using explicit today_ to double-check override path works.
    assert previous_full_iso_week(date(2025, 1, 1)) == "2024-W52"
