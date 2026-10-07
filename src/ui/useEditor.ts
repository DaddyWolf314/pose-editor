import { useSyncExternalStore } from 'react';
import type { Editor, EditorUi } from '../scene/editor';

export function useEditorUi(editor: Editor): EditorUi {
  return useSyncExternalStore(editor.subscribe, editor.getSnapshot);
}
