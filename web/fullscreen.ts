export interface FullscreenElement {
  requestFullscreen?: (options?: { navigationUI?: 'auto' | 'hide' | 'show' }) => Promise<void>;
}

export interface FullscreenDocument {
  documentElement: FullscreenElement;
  fullscreenElement: unknown | null;
  exitFullscreen?: () => Promise<void>;
  addEventListener: (name: 'fullscreenchange', listener: () => void) => void;
  removeEventListener: (name: 'fullscreenchange', listener: () => void) => void;
}

export type FullscreenToggleResult = 'entered' | 'exited' | 'unsupported' | 'rejected';

export function fullscreenPresentation(
  supported: boolean,
  active: boolean,
): { visible: boolean; active: boolean; label: string } {
  return {
    visible: supported,
    active,
    label: active ? 'ออกจากเต็มหน้าจอ' : 'เต็มหน้าจอ',
  };
}

export function createFullscreenController(doc: FullscreenDocument) {
  const supported = (): boolean =>
    typeof doc.documentElement.requestFullscreen === 'function'
    && typeof doc.exitFullscreen === 'function';
  const active = (): boolean => doc.fullscreenElement !== null;

  return {
    supported,
    active,
    async toggle(): Promise<FullscreenToggleResult> {
      if (!supported()) return 'unsupported';
      try {
        if (active()) {
          await doc.exitFullscreen!();
          return 'exited';
        }
        await doc.documentElement.requestFullscreen!({ navigationUI: 'hide' });
        return 'entered';
      } catch {
        return 'rejected';
      }
    },
    subscribe(onChange: (active: boolean) => void): () => void {
      const listener = () => onChange(active());
      doc.addEventListener('fullscreenchange', listener);
      return () => doc.removeEventListener('fullscreenchange', listener);
    },
  };
}
