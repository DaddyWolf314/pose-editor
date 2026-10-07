import { useEffect, useRef, useState } from 'react';
import { Editor } from './scene/editor';
import { Hint } from './ui/Hint';
import { JsonSheet } from './ui/JsonSheet';
import { Panel } from './ui/Panel';

type Sheet = { importing: boolean; key: number } | null;

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

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
        if (sheet) setSheet(null); else editor.deselect();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault(); editor.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, sheet]);

  return (
    <div id="app">
      <div id="stage" ref={stageRef} />
      {editor && (
        <>
          <Panel editor={editor} onShowJson={importing => setSheet({ importing, key: Date.now() })} />
          <Hint editor={editor} />
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
