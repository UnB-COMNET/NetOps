#!/usr/bin/env python3
"""Main test runner for the project.

Runs all tests under the local `tests/` folder, streams output to stdout,

and simultaneously appends to `tests/pytest.log`. Exits with the same code
as pytest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = ROOT / "tests"
LOG_FILE = TESTS_DIR / "pytest.log"


def run_pytest(extra_args: list[str]) -> int:
    timestamp = dt.datetime.utcnow().isoformat() + "Z"
    cmd = [sys.executable, "-m", "pytest", "-s", str(TESTS_DIR)] + extra_args

    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as log:
        log.write(f"\n==== pytest run {timestamp} ====/n")
        log.flush()

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            log.write(line)
        returncode = process.wait()
        log.write(f"\n(exit code: {returncode})\n")
    return returncode


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Run all tests and log output.")
    parser.add_argument(
        "extra",
        nargs=argparse.REMAINDER,
        help="Any extra arguments passed to pytest after '--'.",
    )
    args = parser.parse_args(argv)
    # Allow optional "--" to separate pytest args
    extra = args.extra
    if extra and extra[0] == "--":
        extra = extra[1:]
    return run_pytest(extra)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
