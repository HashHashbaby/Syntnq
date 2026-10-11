"""Valence / arousal regressor and its use in the colour mapping (D-036).

A small ridge regression from 24 clip-level acoustic summaries to perceived valence and arousal in
[-1, 1]. The model file (``config/emotion_model.json``) is trained by
``scripts/moodo_emotion_fit.py`` and its hash is stored in every output that used it. Until a
larger set (DEAM) is available it is trained on the owner-supplied Moodo development half only;
see ``docs/DECISIONS.md`` D-035 / D-036.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from synesthesia.features import FrameFeatures

Array = npt.NDArray[np.float64]

EMOTION_MODEL_FILENAME = "emotion_model.json"
_N_MFCC = 13
_SCALE_EPS = 1e-9
_COLOR_FEATURES = ("brightness", "loudness", "noisiness", "harmonicity", "change")
FEATURE_NAMES: tuple[str, ...] = (
    *(f"{k}_{s}" for k in _COLOR_FEATURES for s in ("mean", "std")),
    *(f"mfcc{i}_mean" for i in range(1, _N_MFCC + 1)),
    "onset_mean",
)


def clip_features(feats: FrameFeatures) -> Array:
    """24 clip-level summaries of frame features.

    Args:
        feats: frame features of a clip or a whole song.

    Returns:
        ``(24,)`` float64: mean and std of brightness, loudness, noisiness, harmonicity, change
        (physical units, smoothed), the 13 mean MFCCs, and the mean onset strength.
    """
    cols = feats.color_matrix()  # (T, 5)
    ms = np.column_stack([cols.mean(axis=0), cols.std(axis=0)]).ravel()
    return np.concatenate([ms, feats.mfcc.mean(axis=0), [feats.onset.mean()]]).astype(np.float64)


@dataclass(frozen=True)
class EmotionModel:
    """Standardize, then ``y = x @ weights + intercept`` for (valence, arousal).

    Attributes:
        mean: ``(24,)`` training feature means.
        scale: ``(24,)`` training feature standard deviations.
        weights: ``(24, 2)`` ridge weights on standardized features.
        intercept: ``(2,)`` training target means.
        alpha: ridge penalty chosen by leave-one-out on the training set.
        n_train: training clips.
    """

    mean: Array
    scale: Array
    weights: Array
    intercept: Array
    alpha: float
    n_train: int

    def predict(self, x: Array) -> Array:
        """Predict (valence, arousal) in [-1, 1] for ``(n, 24)`` or ``(24,)`` features."""
        z = (np.atleast_2d(x) - self.mean) / self.scale
        y = np.clip(z @ self.weights + self.intercept, -1.0, 1.0)
        return y[0] if np.ndim(x) == 1 else y


def fit_ridge(
    x: Array, y: Array, alphas: tuple[float, ...]
) -> tuple[EmotionModel, Array, dict[float, float]]:
    """Ridge regression with the penalty chosen by leave-one-out (closed form).

    Args:
        x: ``(n, 24)`` training features.
        y: ``(n, 2)`` targets (valence, arousal).
        alphas: candidate penalties.

    Returns:
        ``(model, loo_predictions (n, 2), loo_mse by alpha)``.
    """
    mean = x.mean(axis=0)
    scale = np.maximum(x.std(axis=0), _SCALE_EPS)
    z = (x - mean) / scale
    y0 = y.mean(axis=0)
    yc = y - y0
    n, d = z.shape
    best: tuple[float, float, Array] | None = None
    scores: dict[float, float] = {}
    for a in alphas:
        hat = z @ np.linalg.solve(z.T @ z + a * np.eye(d), z.T)  # (n, n)
        resid = yc - hat @ yc
        loo = resid / (1.0 - np.diag(hat))[:, None]
        mse = float(np.mean(loo**2))
        scores[a] = mse
        if best is None or mse < best[1]:
            best = (a, mse, y - loo)
    assert best is not None
    alpha, _, loo_pred = best
    w = np.linalg.solve(z.T @ z + alpha * np.eye(d), z.T @ yc)
    return EmotionModel(mean, scale, w, y0, alpha, n), np.clip(loo_pred, -1.0, 1.0), scores


def save_model(model: EmotionModel, path: Path) -> None:
    doc = {
        "feature_names": list(FEATURE_NAMES),
        "mean": model.mean.tolist(),
        "scale": model.scale.tolist(),
        "weights": model.weights.tolist(),
        "intercept": model.intercept.tolist(),
        "alpha": model.alpha,
        "n_train": model.n_train,
    }
    path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_model(path: Path) -> EmotionModel:
    doc = json.loads(path.read_text(encoding="utf-8"))
    if tuple(doc["feature_names"]) != FEATURE_NAMES:
        raise ValueError("emotion model was trained with different features")
    return EmotionModel(
        mean=np.array(doc["mean"]),
        scale=np.array(doc["scale"]),
        weights=np.array(doc["weights"]),
        intercept=np.array(doc["intercept"]),
        alpha=float(doc["alpha"]),
        n_train=int(doc["n_train"]),
    )


def model_hash(path: Path) -> str:
    """SHA-256 of the canonical JSON of the model file."""
    text = json.dumps(
        json.loads(path.read_text(encoding="utf-8")), sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
