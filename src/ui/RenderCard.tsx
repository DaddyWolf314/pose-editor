import { useState, type CSSProperties } from 'react';
import type { Editor } from '../scene/editor';

export interface RenderSettings { width: number; height: number; background: string; transparent: boolean }

const KEY = 'posetool.render';
const PRESETS = [[1920, 1080], [1080, 1080], [1080, 1350], [1080, 1920], [3000, 2000], [2480, 3508]] as const;

export function loadRenderSettings(): RenderSettings {
  const d: RenderSettings = { width: 1920, height: 1080, background: '#ffffff', transparent: false };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s === 'object') {
      if (Number.isInteger(s.width) && s.width > 0) d.width = s.width;
      if (Number.isInteger(s.height) && s.height > 0) d.height = s.height;
      if (typeof s.background === 'string' && /^#[0-9a-f]{6}$/i.test(s.background)) d.background = s.background;
      d.transparent = s.transparent === true;
    }
  } catch { /* storage unavailable */ }
  return d;
}

function stamp(): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

interface Props {
  editor: Editor;
  settings: RenderSettings;
  onChange: (s: RenderSettings) => void;
  onClose: () => void;
}

/** Not modal: the view stays live so the shot can be framed while this is open. */
export function RenderCard({ editor, settings, onChange, onClose }: Props) {
  const max = editor.maxImageSize();
  // Text as typed, so a field can be cleared while editing; the frame follows valid values only.
  const [w, setW] = useState(String(settings.width));
  const [h, setH] = useState(String(settings.height));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = (t: string) => /^\d+$/.test(t) && +t >= 16 && +t <= max;
  const ok = valid(w) && valid(h);

  const update = (patch: Partial<RenderSettings>) => {
    const s = { ...settings, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
    onChange(s);
  };
  const size = (nw: string, nh: string) => {
    setW(nw); setH(nh); setMsg('');
    if (valid(nw) && valid(nh)) update({ width: +nw, height: +nh });
  };

  const save = async () => {
    if (!ok) return;
    setBusy(true); setMsg('');
    try {
      const blob = await editor.renderImage(+w, +h, settings.transparent ? null : settings.background);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `pose-${stamp()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(`Saved a ${w} × ${h} PNG.`);
    } catch (e) {
      console.error(e);
      setMsg('Could not render the image. ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="render" role="dialog" aria-labelledby="renderTitle">
      <h2 id="renderTitle">Render image</h2>
      <p className="note">The frame shows what will be captured. Orbit the view to compose the shot.</p>
      <div className="dims">
        <label><span>Width</span>
          <input type="number" inputMode="numeric" min={16} max={max} value={w} aria-invalid={!valid(w)}
            onChange={e => size(e.target.value, h)} />
        </label>
        <button className="swap" aria-label="Swap width and height" title="Swap width and height" onClick={() => size(h, w)}>{'⇄'}</button>
        <label><span>Height</span>
          <input type="number" inputMode="numeric" min={16} max={max} value={h} aria-invalid={!valid(h)}
            onChange={e => size(w, e.target.value)} />
        </label>
      </div>
      <select aria-label="Size preset" value="" onChange={e => { const [a, b] = e.target.value.split('x'); if (a) size(a, b); }}>
        <option value="">Presets{'…'}</option>
        {PRESETS.map(([a, b]) => <option key={a + 'x' + b} value={a + 'x' + b}>{a} {'×'} {b}</option>)}
      </select>
      {!ok && <p className="note" role="status">Width and height must be whole numbers from 16 to {max}.</p>}

      <div className="bg">
        <label className="check">
          <input type="checkbox" checked={settings.transparent} onChange={e => update({ transparent: e.target.checked })} /> Transparent background
        </label>
        <label className="colour">
          <span>Background</span>
          <input type="color" value={settings.background} disabled={settings.transparent}
            onChange={e => update({ background: e.target.value })} />
        </label>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={!ok || busy} onClick={() => void save()}>{busy ? 'Rendering…' : 'Save PNG'}</button>
        <button onClick={onClose}>Close</button>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}

/** Dims the view outside the area the image will cover. */
export function CaptureFrame({ width, height }: { width: number; height: number }) {
  return (
    <div id="frameBox" aria-hidden="true">
      <div id="frame" style={{ '--ar': width / height } as CSSProperties} />
    </div>
  );
}
