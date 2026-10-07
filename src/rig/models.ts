// The models a figure can wear. Built-in VRMs load on first use; picked files live for the session.
import { loadVrmTemplate, type VrmTemplate } from './vrm';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelInfo {
  id: string;
  label: string;
  status: ModelStatus;
  error?: string;
}

const BUILTIN = [
  { id: 'builtin:Base_Female', label: 'Female', file: 'Base_Female.vrm' },
  { id: 'builtin:Base_Male', label: 'Male', file: 'Base_Male.vrm' },
];

/** Body for the first figure in a fresh scene. */
export const DEFAULT_MODEL_ID = BUILTIN[0].id;

interface Entry extends ModelInfo { url?: string; template?: VrmTemplate }

export class ModelLibrary {
  private entries = new Map<string, Entry>();
  private onChange: (id: string) => void;

  /** `onChange` fires whenever a model's status changes, with that model's id. */
  constructor(onChange: (id: string) => void) {
    this.onChange = onChange;
    for (const b of BUILTIN) {
      this.entries.set(b.id, { id: b.id, label: b.label, status: 'idle', url: import.meta.env.BASE_URL + 'models/' + b.file });
    }
  }

  list(): ModelInfo[] {
    return [...this.entries.values()].map(({ id, label, status, error }) => ({ id, label, status, error }));
  }

  /** The loaded template, or null. Starts loading a built-in model that has not been requested yet. */
  get(id: string): VrmTemplate | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.status === 'idle' && e.url) this.load(e, e.url);
    return e.template ?? null;
  }

  /** Load a .vrm picked from disk. Resolves with its model id once it is ready. */
  async addFile(file: File): Promise<string> {
    const id = 'file:' + file.name;
    const prev = this.entries.get(id);
    if (prev?.status === 'ready') return id;
    const e: Entry = { id, label: file.name.replace(/\.vrm$/i, ''), status: 'idle' };
    this.entries.set(id, e);
    await this.load(e, await file.arrayBuffer());
    if (e.status === 'error') throw new Error(e.error);
    return id;
  }

  private async load(e: Entry, source: string | ArrayBuffer): Promise<void> {
    this.set(e, { status: 'loading', error: undefined });
    try {
      const template = await loadVrmTemplate(source);
      this.set(e, { status: 'ready', template });
    } catch (err) {
      console.error(err);
      this.set(e, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  private set(e: Entry, patch: Partial<Entry>): void {
    Object.assign(e, patch);
    this.onChange(e.id);
  }
}
