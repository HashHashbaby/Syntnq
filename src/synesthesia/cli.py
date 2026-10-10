"""Command line interface: ``syn analyze | render | preview | compare | config-hash``."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from synesthesia import PIPELINE_VERSION
from synesthesia.config import Config, calibration_hash, load_config
from synesthesia.errors import SynError

_NOT_YET = {"compare": "M9"}
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

    v = sub.add_parser("preview", help="liquid-grid MP4 preview with audio")
    v.add_argument("source", help="audio file to analyze, or an analyzed song_id (needs --audio)")
    v.add_argument("--audio", type=Path, default=None, help="audio for a song_id source")
    v.add_argument("--out", type=Path, default=Path(_DEFAULT_OUT))
    v.add_argument("--start", type=float, default=None, help="start in seconds (default 30)")
    v.add_argument("--seconds", type=float, default=None)
    v.add_argument("--fps", type=int, default=None)
    v.add_argument("--px", type=int, default=None)
    v.add_argument("--reduced-motion", action="store_true")
    v.add_argument("--overlay", action="store_true", help="frame counter + beat flash (sync check)")
    v.add_argument("--name", default=None, help="output file name (default: preview_<start>_<s>)")

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

    result = analyze(args.file, config, calibration_hash=calibration_hash(args.config))
    song_dir = write_result(result, args.out, config)
    if not args.no_render:
        _render_song(song_dir, config, config.render.preview_px)
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


def _render_song(song_dir: Path, config: Config, px: int) -> list[Path]:
    """Write ``renders/``: the sound map and every companion map, from the stored arrays."""
    from synesthesia.io import read_arrays, read_signature
    from synesthesia.maps.render_maps import render_all
    from synesthesia.render import render_sound_map, save_png

    sig = read_signature(song_dir / "signature.json")
    arrays = read_arrays(song_dir / "arrays.npz")
    meta = {
        "song_id": sig["song"]["id"],
        "pipeline_version": sig["pipeline_version"],
        "config_hash": sig["config_hash"].removeprefix("sha256:"),
    }
    images = {"sound_map": render_sound_map(arrays["color_srgb"], config, px)}
    images.update(render_all(arrays, sig, config, px))
    paths = []
    for stem in sorted(images):
        target = song_dir / "renders" / f"{stem}.png"
        save_png(images[stem], target, meta)
        paths.append(target)
    return paths


def _cmd_render(args: argparse.Namespace, config: Config) -> int:
    for path in _render_song(args.out / args.song_id, config, args.px or config.render.preview_px):
        _write(str(path))
    return 0


def _cmd_preview(args: argparse.Namespace, config: Config) -> int:
    import numpy as np

    from synesthesia.io import read_arrays, read_signature, write_result
    from synesthesia.live import build_live_stream
    from synesthesia.pipeline import analyze
    from synesthesia.preview import iter_frames, write_preview

    source = Path(args.source)
    if source.is_file():
        result = analyze(source, config, calibration_hash=calibration_hash(args.config))
        song_dir = write_result(result, args.out, config)
        stream = build_live_stream(result, config)
        prototypes = result.prototypes.astype(np.float16).astype(np.float64)
        static_oklch = result.colors.oklch
        audio = source
        duration = result.ingest.duration_s
        song_id = result.song_id
    else:
        song_dir = args.out / args.source
        from synesthesia.io import decode_live_bin, decode_proto_bin

        stream, _ = decode_live_bin((song_dir / "live.bin").read_bytes())
        prototypes = decode_proto_bin((song_dir / "proto.bin").read_bytes()).astype(np.float64)
        static_oklch = read_arrays(song_dir / "arrays.npz")["color_oklch"].astype(np.float64)
        sig = read_signature(song_dir / "signature.json")
        stream = type(stream)(
            stream.fps, stream.tau, stream.x, stream.bmu, stream.loud, stream.onset,
            stream.color, stream.beat_times, float(sig.get("live", {}).get("audio_offset_s", 0.0)),
        )  # fmt: skip
        audio = args.audio
        duration = float(sig["song"]["duration_s"])
        song_id = args.source

    seconds = args.seconds if args.seconds is not None else config.preview.default_seconds
    fps = args.fps or config.preview.fps
    px = args.px or config.preview.px
    start = args.start if args.start is not None else min(30.0, max(0.0, duration - seconds))
    start = max(0.0, min(start, duration - seconds))
    name = args.name or f"preview_{start:g}_{seconds:g}{'_reduced' if args.reduced_motion else ''}"
    target = song_dir / f"{name}.mp4"
    frames = iter_frames(
        stream, prototypes, static_oklch, config,
        start_s=start, seconds=seconds, fps=fps, px=px,
        reduced_motion=args.reduced_motion, overlay=args.overlay,
    )  # fmt: skip
    write_preview(
        target, frames, config, audio_path=audio,
        audio_start_s=start + stream.audio_offset_s, seconds=seconds, fps=fps, px=px,
    )  # fmt: skip
    _write(f"song_id  {song_id}")
    _write(f"preview  {target}  ({seconds:g}s from {start:g}s, {fps} fps, {px} px)")
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
        if args.command == "preview":
            return _cmd_preview(args, config)
        return _cmd_render(args, config)
    except SynError as err:
        sys.stderr.write(f"{err.code.value}: {err.user_message}\n")
        if err.detail:
            sys.stderr.write(f"  detail: {err.detail}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
