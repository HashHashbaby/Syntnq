// Icon map keyed by the SF Symbol name a native port would use (docs/UI.md section 9).
// Lucide (ISC licence) supplies the glyphs; SF Symbols are never bundled.
import {
  ArrowLeft,
  ChartNoAxesColumn,
  Download,
  Grid3x3,
  Info,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Settings,
  SlidersHorizontal,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

export const icons = {
  "play.fill": Play,
  "pause.fill": Pause,
  "gobackward.5": RotateCcw,
  "goforward.5": RotateCw,
  plus: Plus,
  "square.and.arrow.up": Download,
  waveform: ChartNoAxesColumn,
  "square.grid.3x3": Grid3x3,
  "slider.horizontal.3": SlidersHorizontal,
  metronome: Timer,
  "info.circle": Info,
  gearshape: Settings,
  trash: Trash2,
  xmark: X,
  "chevron.left": ArrowLeft,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export const ICON_STROKE = 1.75;
