"""Command line interface: ``syn analyze | render | preview | compare | config-hash``."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from synesthesia import PIPELINE_VERSION
from synesthesia.config import load_config

_NOT_YET = {
    "analyze": "M1",
    "render": "M1",
    "preview": "M3",
    "compare": "M9",
}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="syn", description="SYNESTHESIA analysis CLI")
    parser.add_argument("--config", help="path to a config YAML (default: config/default.yaml)")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in _NOT_YET:
        p = sub.add_parser(name, help=f"available in {_NOT_YET[name]}")
        p.add_argument("target", nargs="*")
        p.add_argument("--seconds", type=float, default=None)
    sub.add_parser("config-hash", help="print the SHA-256 of the resolved config")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point for the ``syn`` command; returns the process exit code."""
    args = _build_parser().parse_args(argv)
    config = load_config(args.config)
    if args.command == "config-hash":
        sys.stdout.write(f"{config.hash()}\n")
        return 0
    sys.stderr.write(
        f"syn {args.command} is not implemented yet "
        f"(arrives in {_NOT_YET[args.command]}; pipeline {PIPELINE_VERSION})\n"
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
