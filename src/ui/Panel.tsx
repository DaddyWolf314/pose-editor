import { useRef, useState } from 'react';
import { MANNEQUIN_ID } from '../rig/body';
import type { ModelInfo } from '../rig/models';
import type { Editor } from '../scene/editor';
import { useEditorUi } from './useEditor';

interface Props { editor: Editor; onShowJson: (importing: boolean) => void }

export function Panel({ editor, onShowJson }: Props) {
  const ui = useEditorUi(editor);
  const [closed, setClosed] = useState(false);
  const noActive = !ui.activeId;
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
        <h2>Hips and floor ring</h2>
        <div className="seg" role="group" aria-label="Hips and floor ring mode">
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
          <button disabled={noActive} onClick={() => editor.dropToFloor()}>Drop to floor</button>
          <button disabled={!ui.canUndo} onClick={() => editor.undo()}>Undo</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={ui.limits} onChange={e => editor.setLimits(e.target.checked)} /> Joint limits
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
