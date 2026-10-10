"""Companion maps (docs/ANALYSIS.md section 8): structure, rhythm, dynamics, feature grids."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from synesthesia.config import Config
from synesthesia.features import FrameFeatures
from synesthesia.maps.dynamics import Dynamics, compute_dynamics
from synesthesia.maps.rhythm import RhythmMap, compute_rhythm
from synesthesia.maps.structure import compute_structure


@dataclass(frozen=True)
class CompanionMaps:
    """The time-based companion maps of one song (fixed shapes regardless of length)."""

    structure: npt.NDArray[np.float16]  # (size, size) in [-1, 1]
    rhythm: RhythmMap
    dynamics: Dynamics


def compute_companion_maps(feats: FrameFeatures, config: Config) -> CompanionMaps:
    """Structure, rhythm and dynamics maps from frame features."""
    return CompanionMaps(
        structure=compute_structure(feats.chroma_raw, feats.mfcc_raw, feats.fps, config),
        rhythm=compute_rhythm(feats.onset, config),
        dynamics=compute_dynamics(feats.loudness_raw, feats.fps, config),
    )


__all__ = ["CompanionMaps", "Dynamics", "RhythmMap", "compute_companion_maps"]
