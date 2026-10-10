import { useRef, useState } from 'react';
import { MANNEQUIN_ID } from '../rig/body';
import type { PropKind } from '../props/catalog';
import type { ModelInfo } from '../rig/models';
import { COLORS } from '../rig/skeleton';
import type { Editor } from '../scene/editor';
import { useEditorUi } from './useEditor';

interface Props { editor: Editor; onShowJson: (importing: boolean) => void }

export function Panel({ editor, onShowJson }: Props) {
  const ui = useEditorUi(editor);
  const [closed, setClosed] = useState(false);
  const noActive = !ui.activeId;
  const activeColor = ui.figures.find(f => f.id === ui.activeId)?.color.toLowerCase();
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [fileMsg, setFileMsg] = useState('');

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setFileMsg('Loading ' + file.name + '\u2026');
    setFileMsg((await editor.loadModelFile(file)) ?? '');
  };

  return (
    <div id="panel" className={closed ? 'closed' : undefined}>
      <div className="head">
        <h1>Pose reference</h1>
        <button id="collapse" aria-expanded={!closed} aria-label="Hide or show the panel" onClick={() => setClosed(c => !c)}>
          {closed ? 'Show' : 'Hide'}
        </button>
      </div>

      <div className="group">
        <h2>Figures</h2>
        <ul id="figs">
          {ui.figures.map(f => (
            <li key={f.id}>
              <button className="pickfig" aria-pressed={f.id === ui.activeId} onClick={() => editor.activate(f.id)}>
                <span className="dot" style={{ background: f.color }} />
                <span>{f.name}</span>
              </button>
              <button className="del" aria-label={'Delete ' + f.name} onClick={() => editor.deleteFigure(f.id)}>{'×'}</button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button onClick={() => editor.addFigure()}>Add figure</button>
          <button disabled={noActive} onClick={() => editor.duplicate()}>Duplicate</button>
        </div>
        <div className="swatches" role="group" aria-label="Colour of the selected figure">
          {COLORS.map(c => (
            <button key={c.hex} className="swatch" style={{ background: c.hex }} disabled={noActive}
              aria-label={c.name} title={c.name} aria-pressed={c.hex === activeColor}
              onClick={() => editor.setColor(c.hex)} />
          ))}
        </div>
      </div>

      <div className="group">
        <h2>Props</h2>
        {ui.props.length > 0 && (
          <ul id="props">
            {ui.props.map(p => (
              <li key={p.id}>
                <button className="pickfig" aria-pressed={p.id === ui.prop?.id} onClick={() => editor.selectProp(p.id)}>
                  <span>{p.name}</span>
                </button>
                <button className="del" aria-label={'Delete ' + p.name} onClick={() => editor.deleteProp(p.id)}>{'×'}</button>
              </li>
            ))}
          </ul>
        )}
        <select aria-label="Add a prop" value="" onChange={e => { if (e.target.value) editor.addProp(e.target.value as PropKind); }}>
          <option value="">Add prop{'\u2026'}</option>
          {ui.propKinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        {ui.prop && (
          <div className="size" role="group" aria-label={'Size of ' + ui.prop.name}>
            {ui.prop.params.map(q => (
              <label key={q.key}>
                <span>{q.label}</span>
                <span>{q.value.toFixed(2)} m</span>
                <input type="range" min={q.min} max={q.max} step={0.01} value={q.value}
                  onChange={e => editor.setPropSize(ui.prop!.id, q.key, Number(e.target.value))} />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="group">
        <h2>Body</h2>
        <select id="body" aria-label="Body of the selected figure" disabled={noActive}
          value={ui.activeModel ?? MANNEQUIN_ID} onChange={e => editor.setModel(e.target.value)}>
          <option value={MANNEQUIN_ID}>Mannequin</option>
          {ui.models.map(m => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
          {ui.activeModel && ui.activeModel !== MANNEQUIN_ID && !ui.models.some(m => m.id === ui.activeModel) && (
            <option value={ui.activeModel}>{ui.activeModel.replace(/^file:/, '')} (not loaded)</option>
          )}
        </select>
        <div className="row" style={{ marginTop: 6 }}>
          <button onClick={() => fileInput.current?.click()}>Load .vrm file</button>
        </div>
        <input ref={fileInput} type="file" accept=".vrm" hidden
          onChange={e => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
        {fileMsg && <p className="note" role="status">{fileMsg}</p>}
      </div>

      <div className="group">
        <h2>Hips, floor rings and props</h2>
        <div className="seg" role="group" aria-label="Hips, floor ring and prop mode">
          <button aria-pressed={ui.mode === 'move'} onClick={() => editor.setMode('move')}>Move</button>
          <button aria-pressed={ui.mode === 'rotate'} onClick={() => editor.setMode('rotate')}>Rotate</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={ui.pinFeet} onChange={e => editor.setPinFeet(e.target.checked)} /> Keep feet planted when hips move
        </label>
      </div>

      <div className="group">
        <h2>Pose</h2>
        <div className="row">
          <button disabled={noActive} onClick={() => editor.resetPose()}>Reset pose</button>
          <button disabled={noActive} onClick={() => editor.dropToFloor()}>{ui.collisions ? 'Drop to surface' : 'Drop to floor'}</button>
          <button disabled={!ui.canUndo} onClick={() => editor.undo()}>Undo</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={ui.limits} onChange={e => editor.setLimits(e.target.checked)} /> Joint limits
        </label>
        <label className="check">
          <input type="checkbox" checked={ui.collisions} onChange={e => editor.setCollisions(e.target.checked)} /> Collisions with props and floor
        </label>
        <label className="check">
          <input type="checkbox" disabled={noActive} checked={ui.activeLook} onChange={e => editor.setLook(e.target.checked)} /> Head follows a look target
        </label>
      </div>

      <div className="group">
        <h2>Photo</h2>
        <div className="row">
          <button disabled={ui.photo.busy} onClick={() => photoInput.current?.click()}>
            {ui.photo.busy ? 'Working\u2026' : 'Pose from photo'}
          </button>
        </div>
        <input ref={photoInput} type="file" accept="image/*" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) void editor.importPhoto(f); e.target.value = ''; }} />
        {ui.photo.loaded && (
          <>
            <label className="check">
              <input type="checkbox" checked={ui.photo.visible} onChange={e => editor.setPhotoVisible(e.target.checked)} /> Show photo
            </label>
            <div className="row" style={{ marginTop: 6 }}>
              <button onClick={() => editor.viewFromPhoto()}>View from photo</button>
              <button onClick={() => editor.removePhoto()}>Remove photo</button>
            </div>
          </>
        )}
        {ui.photo.message && <p className="note" role="status">{ui.photo.message}</p>}
      </div>

      <div className="group">
        <h2>Scene data</h2>
        <div className="row">
          <button onClick={() => onShowJson(false)}>Show scene JSON</button>
          <button onClick={() => onShowJson(true)}>Load scene JSON</button>
        </div>
      </div>
    </div>
  );
}

function modelLabel(m: ModelInfo): string {
  if (m.status === 'loading') return m.label + ' (loading\u2026)';
  if (m.status === 'error') return m.label + ' (failed to load)';
  return m.label;
}
