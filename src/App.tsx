import { useEffect, useRef, useState } from 'react';
import { Editor } from './scene/editor';
import { Hint } from './ui/Hint';
import { JsonSheet } from './ui/JsonSheet';
import { Panel } from './ui/Panel';
import { CaptureFrame, RenderCard, loadRenderSettings, type RenderSettings } from './ui/RenderCard';

type Sheet = { importing: boolean; key: number } | null;

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [render, setRender] = useState<RenderSettings | null>(null);

  useEffect(() => {
    let ed: Editor;
    try { ed = new Editor(stageRef.current!); }
    catch (e) { console.error(e); setFailed(true); return; }
    setEditor(ed);
    return () => { ed.dispose(); setEditor(null); };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(TEXTAREA|INPUT)$/.test((e.target as HTMLElement | null)?.tagName || '');
      if (e.key === 'Escape') {
        if (sheet) setSheet(null); else if (render) setRender(null); else editor.deselect();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault(); editor.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, sheet, render]);

  return (
    <div id="app">
      <div id="stage" ref={stageRef} />
      {editor && (
        <>
          {render && <CaptureFrame width={render.width} height={render.height} />}
          <Panel editor={editor} onShowJson={importing => setSheet({ importing, key: Date.now() })}
            onRender={() => setRender(r => r ?? loadRenderSettings())} />
          <Hint editor={editor} />
          {render && <RenderCard editor={editor} settings={render} onChange={setRender} onClose={() => setRender(null)} />}
          {sheet && <JsonSheet key={sheet.key} editor={editor} importing={sheet.importing} onClose={() => setSheet(null)} />}
        </>
      )}
      {failed && (
        <div id="fail" style={{ display: 'flex' }}>
          WebGL is not available in this browser, so the 3D view cannot start.
        </div>
      )}
    </div>
  );
}
