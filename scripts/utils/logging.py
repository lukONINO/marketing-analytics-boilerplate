"""Structured logging for the pipeline.

Each log record is a single JSON object with timestamp, level, logger
name, message, and any extra fields passed via ``extra={...}``. This
makes the log stream easy to grep by source, date, URL, or error
category — useful both for tail-following and for later aggregation.

Usage:
    from scripts.utils import get_logger
    log = get_logger(__name__)
    log.info("pulled GSC data", extra={"date": "2026-04-20", "rows": 1243})
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any


# Fields injected by the logging module that we never want to emit.
# `extra=` keys land directly on the LogRecord, so we whitelist rather
# than blacklist when serializing.
_STANDARD_RECORD_FIELDS = frozenset({
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "asctime", "message", "taskName",
})


class _JsonFormatter(logging.Formatter):
    """Emit each record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Merge `extra=` fields
        for key, value in record.__dict__.items():
            if key in _STANDARD_RECORD_FIELDS or key.startswith("_"):
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = repr(value)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


_CONFIGURED: set[str] = set()


def get_logger(name: str) -> logging.Logger:
    """Return a configured JSON logger for ``name``.

    Level is read from the ``LOG_LEVEL`` env var (default INFO). Safe
    to call multiple times — each logger is configured at most once.
    """
    logger = logging.getLogger(name)
    if name in _CONFIGURED:
        return logger

    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logger.setLevel(level)

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_JsonFormatter())
    logger.addHandler(handler)
    logger.propagate = False

    _CONFIGURED.add(name)
    return logger
