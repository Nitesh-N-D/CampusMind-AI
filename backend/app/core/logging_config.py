"""
Structured logging setup. Every request gets a short request_id that's
included in both the access log line and any error log line, so a report
like "I got an error at 10:32" can actually be traced to a specific log
entry without needing to log full request bodies (which would risk logging
passwords, tokens, or chat message content).
"""
import logging
import sys

_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if root.handlers:
        return  # already configured (e.g. re-imported under a test runner)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    root.addHandler(handler)
    root.setLevel(level)

    # Quiet down noisy third-party loggers to keep signal high
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


logger = logging.getLogger("campusmind")
