// Typed view of params.json, which scripts/make_web_fixtures.py exports from config/default.yaml
// (the single source of parameters). Do not edit params.json by hand.
import raw from "./params.json";

export interface RippleParams {
  onset_threshold: number;
  speed_cells_per_s: number;
  decay_s: number;
  width_cells: number;
  amplitude: number;
  max_concurrent: number;
}

export interface LiveParams {
  fps: number;
  beat_latency_s: number;
  blur_renormalize: boolean;
  attack_ms: number;
  release_ms: number;
  diffusion_rate: number;
  diffusion_passes: number;
  glow_sigma_cells: [number, number];
  live_mix_max: number;
  max_lightness: number;
  live_lightness_boost: number;
  global_mix: number;
  global_lightness_swing: number;
  live_chroma_gain: number;
  ripple: RippleParams;
  trail: { length_s: number; width_cells: number; opacity: number };
  reduced_motion: { ripples: boolean; diffusion: boolean; release_ms: number };
}

export interface Params {
  grid: { size: number };
  live: LiveParams;
  color: {
    hue: { from_deg: number; to_deg: number };
    chroma: { min: number; max: number };
    lightness: { min: number; max: number };
  };
  render: {
    display_grid: number;
    margin_cells: number;
    background: string;
    node: { style: string; dot: { radius_ratio: number; glow_sigma_ratio: number; glow_opacity: number } };
  };
  preview: { fps: number };
  api: { page_size_default: number; page_size_max: number };
}

export const params = raw as unknown as Params;
