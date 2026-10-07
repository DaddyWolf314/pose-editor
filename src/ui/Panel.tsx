import { useState } from 'react';
import type { Editor } from '../scene/editor';
import { useEditorUi } from './useEditor';

interface Props { editor: Editor; onShowJson: (importing: boolean) => void }

export function Panel({ editor, onShowJson }: Props) {
  const ui = useEditorUi(editor);
  const [closed, setClosed] = useState(false);
  const noActive = !ui.activeId;

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
