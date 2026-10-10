"""Command line interface: ``syn analyze | render | preview | compare | config-hash``."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from synesthesia import PIPELINE_VERSION
from synesthesia.config import Config, calibration_hash, load_config
from synesthesia.errors import SynError

_NOT_YET = {"preview": "M3", "compare": "M9"}
_DEFAULT_OUT = "out"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="syn", description="SYNESTHESIA analysis CLI")
    parser.add_argument("--config", help="path to a config YAML (default: config/default.yaml)")
    sub = parser.add_subparsers(dest="command", required=True)

    a = sub.add_parser("analyze", help="analyze an audio file into out/<song_id>/")
    a.add_argument("file", type=Path)
    a.add_argument("--out", type=Path, default=Path(_DEFAULT_OUT))
    a.add_argument("--no-render", action="store_true", help="skip renders/sound_map.png")

    r = sub.add_parser("render", help="render sound_map.png for an analyzed song")
    r.add_argument("song_id")
    r.add_argument("--out", type=Path, default=Path(_DEFAULT_OUT))
    r.add_argument("--px", type=int, default=None)

    for name in _NOT_YET:
        p = sub.add_parser(name, help=f"available in {_NOT_YET[name]}")
        p.add_argument("target", nargs="*")
        p.add_argument("--seconds", type=float, default=None)
    sub.add_parser("config-hash", help="print the SHA-256 of the resolved config")
    return parser


def _write(line: str) -> None:
    sys.stdout.write(line + "\n")


def _cmd_analyze(args: argparse.Namespace, config: Config) -> int:
    from synesthesia.io import write_result
    from synesthesia.pipeline import analyze
    from synesthesia.render import render_sound_map, save_png

    result = analyze(args.file, config, calibration_hash=calibration_hash(args.config))
    song_dir = write_result(result, args.out, config.grid.size)
    if not args.no_render:
        img = render_sound_map(result.colors.srgb, config)
        save_png(
            img,
            song_dir / "renders" / "sound_map.png",
            {
                "song_id": result.song_id,
                "pipeline_version": result.pipeline_version,
                "config_hash": result.config_hash,
            },
        )
    som = result.som
    _write(f"song_id            {result.song_id}")
    _write(f"duration_s         {result.ingest.duration_s:.1f}  frames {result.n_frames}")
    _write(
        f"lufs measured      {result.ingest.measured_lufs:.2f}"
        f"  gain {result.ingest.applied_gain_db:.2f} dB"
    )
    _write(f"orientation        {result.orientation}")
    _write(f"quantization_error {som.quantization_error:.4f}")
    _write(f"topographic_error  {som.topographic_error:.4f}")
    _write(f"empty_units        {som.empty_units:.4f}")
    _write("timings_s          " + "  ".join(f"{k} {v:.2f}" for k, v in result.timings.items()))
    _write(f"total_s            {sum(result.timings.values()):.2f}")
    _write(f"output             {song_dir}")
    return 0


def _cmd_render(args: argparse.Namespace, config: Config) -> int:
    from synesthesia.io import read_arrays, read_signature
    from synesthesia.render import render_sound_map, save_png

    song_dir = args.out / args.song_id
    sig = read_signature(song_dir / "signature.json")
    arrays = read_arrays(song_dir / "arrays.npz")
    img = render_sound_map(arrays["color_srgb"], config, args.px)
    target = song_dir / "renders" / "sound_map.png"
    save_png(
        img,
        target,
        {
            "song_id": sig["song"]["id"],
            "pipeline_version": sig["pipeline_version"],
            "config_hash": sig["config_hash"].removeprefix("sha256:"),
        },
    )
    _write(str(target))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point for the ``syn`` command; returns the process exit code."""
    args = _build_parser().parse_args(argv)
    config = load_config(args.config)
    if args.command == "config-hash":
        _write(config.hash())
        return 0
    if args.command in _NOT_YET:
        sys.stderr.write(
            f"syn {args.command} is not implemented yet "
            f"(arrives in {_NOT_YET[args.command]}; pipeline {PIPELINE_VERSION})\n"
        )
        return 2
    try:
        if args.command == "analyze":
            return _cmd_analyze(args, config)
        return _cmd_render(args, config)
    except SynError as err:
        sys.stderr.write(f"{err.code.value}: {err.user_message}\n")
        if err.detail:
            sys.stderr.write(f"  detail: {err.detail}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
