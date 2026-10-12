// Settings (docs/UI.md section 6.10): motion, transparency, local audio, licences (graphite only, D-053).
import { Sheet } from "../components/parts";
import { useSettings, type Toggle } from "../state/settings";
import { useApp } from "../state/store";

export function Settings({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const samples = useApp((st) => st.samples);
  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="group" style={{ margin: "var(--space-4) 0" }}>
        <div>
          <label htmlFor="set-motion">Reduce motion</label>
          <select id="set-motion" value={s.reduceMotion} onChange={(e) => s.set({ reduceMotion: e.target.value as Toggle })}>
            <option value="auto">Auto</option>
            <option value="on">On</option>
          </select>
        </div>
        <div>
          <label htmlFor="set-trans">Reduce transparency</label>
          <select id="set-trans" value={s.reduceTransparency} onChange={(e) => s.set({ reduceTransparency: e.target.value as Toggle })}>
            <option value="auto">Auto</option>
            <option value="on">On</option>
          </select>
        </div>
        <div>
          <label htmlFor="set-audio">Keep audio on this device</label>
          <input id="set-audio" type="checkbox" checked={s.keepAudio} onChange={(e) => s.set({ keepAudio: e.target.checked })} />
        </div>
      </div>
      <div className="group" style={{ margin: "var(--space-4) 0" }}>
        <span>Intro</span>
        <button
          className="btn btn-plain"
          onClick={() => {
            s.set({ landingDone: false });
            onClose();
          }}
        >
          Replay intro
        </button>
      </div>
      <h3 className="t-headline">About and licences</h3>
      <p className="t-sub secondary" style={{ margin: "var(--space-2) 0" }}>
        SYNESTHESIA turns a song into a visual signature. Colours summarise the sound (brightness, loudness, how tonal it is);
        they are not a prediction of how listeners would colour music.
      </p>
      <p className="t-foot secondary">Icons: Lucide (ISC). Text: TeX Gyre Heros by GUST e-foundry (GUST Font License), or Helvetica where your device has it. No Apple fonts, symbols or logos are bundled.</p>
      {samples.length > 0 && (
        <ul className="t-foot secondary" style={{ paddingLeft: "var(--space-5)" }}>
          {samples.map((x) => (
            <li key={x.slug}>
              {x.attribution}, <a style={{ color: "var(--link)" }} href={x.license_url} target="_blank" rel="noreferrer">licence</a>,{" "}
              <a style={{ color: "var(--link)" }} href={x.source_url} target="_blank" rel="noreferrer">source</a>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
