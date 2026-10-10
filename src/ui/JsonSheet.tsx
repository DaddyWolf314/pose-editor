import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../scene/editor';

interface Props { editor: Editor; importing: boolean; onClose: () => void }

/** Mount with a fresh `key` each time it opens so the text resets. */
export function JsonSheet({ editor, importing, onClose }: Props) {
  const [text, setText] = useState(() => (importing ? '' : editor.sceneJson()));
  const [msg, setMsg] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    if (!importing) area.current?.select();
  }, [importing]);

  const copy = async () => {
    area.current?.select();
    try { await navigator.clipboard.writeText(text); setMsg('Copied.'); return; } catch { /* fall back */ }
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
    setMsg(ok ? 'Copied.' : 'Copy did not work here. The text is selected, so copy it with your keyboard.');
  };

  const apply = () => {
    const err = editor.loadSceneJson(text);
    if (err) setMsg(err); else onClose();
  };

  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <div className="card">
        <h2 id="sheetTitle">Scene JSON</h2>
        <p id="sheetText">
          {importing
            ? 'Paste scene JSON below, then load it. This replaces the current scene.'
            : 'Every figure, its position, and each bone rotation as a quaternion, plus every prop.'}
        </p>
        <textarea id="json" ref={area} spellCheck={false} aria-label="Scene JSON" value={text} onChange={e => setText(e.target.value)} />
        <div id="jsonmsg" role="status">{msg}</div>
        <div className="row">
          {importing && <button className="primary" onClick={apply}>Load scene</button>}
          {!importing && <button onClick={copy}>Copy</button>}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
