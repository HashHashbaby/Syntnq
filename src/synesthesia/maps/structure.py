"""Structure map: self-similarity of the song's timbre and harmony (docs/ANALYSIS.md section 8)."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.maps.resample import resize_axis

Array = npt.NDArray[np.float64]

_EPS = 1e-12


def compute_structure(
    chroma: Array, mfcc_raw: Array, fps: float, config: Config
) -> npt.NDArray[np.float16]:
    """Cosine self-similarity of half-second blocks, resized to a fixed square.

    Each feature column is z-scored per song first so chroma (0..1) and MFCCs (tens) weigh
    equally (D-031); blocks are the mean over ``block_s`` seconds, then L2-normalized.

    Args:
        chroma: ``(T, 12)`` unsmoothed chroma.
        mfcc_raw: ``(T, 13)`` unsmoothed MFCCs.
        fps: frames per second.
        config: resolved configuration (``maps.structure``).

    Returns:
        ``(size, size)`` float16 in [-1, 1].
    """
    sc = config.maps.structure
    sources = {"chroma": chroma, "mfcc": mfcc_raw}
    x = np.column_stack([sources[name] for name in sc.features])
    std = x.std(axis=0)
    x = (x - x.mean(axis=0)) / np.where(std > _EPS, std, 1.0)

    per_block = max(1, int(round(sc.block_s * fps)))
    n_blocks = max(1, -(-x.shape[0] // per_block))
    pad = n_blocks * per_block - x.shape[0]
    xp = np.vstack([x, np.repeat(x[-1:], pad, axis=0)]) if pad else x
    blocks = xp.reshape(n_blocks, per_block, -1).mean(axis=1)
    norm = np.linalg.norm(blocks, axis=1, keepdims=True)
    unit = blocks / np.where(norm > _EPS, norm, 1.0)
    sim = np.clip(unit @ unit.T, -1.0, 1.0)

    resized = resize_axis(resize_axis(sim, sc.size, axis=0), sc.size, axis=1)
    return np.asarray(np.clip(resized, -1.0, 1.0), dtype=np.float16)
