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
  flow: FlowParams;
}

/** River-ripple wave field for the 3D chips (config live.flow, D-056). */
export interface FlowParams {
  substep_hz: number;
  wave_speed: number;
  damping: number;
  sponge_cells: number;
  sponge_damping: number;
  source_gain: number;
  source_sigma_cells: number;
  source_scale: number;
  beat_gain: number;
  beat_scale: number;
  current_dir: [number, number];
  current_speed: number;
  current_loud_gain: number;
  curl_amp: number;
  curl_scale: number;
  wave_limit: number;
}

/** The 3D live view (config web3d, D-056). */
export interface Web3DParams {
  live_view_version: number;
  camera_fov_deg: number;
  chip_size: number;
  chip_thickness: number;
  chip_corner: number;
  z_amp: number;
  tilt_max_deg: number;
  tilt_gain: number;
  absorb_edge: number;
  absorb_edge_sat: number;
  grain: number;
  glint: number;
  side_shade: number;
  parallax_deg: number;
  parallax_response_s: number;
  max_dpr: number;
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
  ranges: {
    centroid_log10_hz: [number, number];
    loudness_dbfs: [number, number];
    noisiness_log10: [number, number];
    harmonicity: [number, number];
    change_z: [number, number];
  };
  maps: { feature_grids: string[]; ramp_hues: Record<string, number>; ramp: { lightness: [number, number]; chroma: number } };
  preview: { fps: number };
  web3d: Web3DParams;
  api: { page_size_default: number; page_size_max: number };
}

export const params = raw as unknown as Params;
