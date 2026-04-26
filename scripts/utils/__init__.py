"""Shared utilities for the marketing-analytics scripts.

Keep each helper small, pure, and well-tested. Scripts in `scripts/`
import from here. Anything that talks to the outside world (network,
filesystem writes, subprocess) belongs in the script, not here.
"""

from .dates import (  # noqa: F401
    iso_week_of,
    iso_week_string,
    last_n_days,
    parse_date,
    previous_full_iso_week,
    today,
    week_date_range,
    yesterday,
)
from .urls import (  # noqa: F401
    extract_host,
    find_normalization_duplicates,
    is_same_host,
    match_llm_referrer,
    normalize_url,
)
from .logging import get_logger  # noqa: F401
