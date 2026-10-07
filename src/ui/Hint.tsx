import type { Editor } from '../scene/editor';
import { useEditorUi } from './useEditor';

export function Hint({ editor }: { editor: Editor }) {
  const { hint } = useEditorUi(editor);
  return <div id="hint">{hint}</div>;
}
