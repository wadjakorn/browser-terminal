import { describe, expect, it, vi } from 'vitest';
import {
  createFullscreenController,
  fullscreenPresentation,
  type FullscreenDocument,
} from './fullscreen.js';

function fakeDocument(options: { supported?: boolean; active?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const requestFullscreen = options.supported === false
    ? undefined
    : vi.fn(async () => {});
  const exitFullscreen = options.supported === false
    ? undefined
    : vi.fn(async () => {});
  const documentElement = { requestFullscreen };
  const doc: FullscreenDocument = {
    documentElement,
    fullscreenElement: options.active ? documentElement : null,
    exitFullscreen,
    addEventListener: (_name, listener) => { listeners.add(listener); },
    removeEventListener: (_name, listener) => { listeners.delete(listener); },
  };

  return {
    doc,
    requestFullscreen,
    exitFullscreen,
    emitChange: () => { for (const listener of listeners) listener(); },
  };
}

describe('fullscreen controller', () => {
  it('enters fullscreen with browser navigation hidden', async () => {
    const fake = fakeDocument();
    const controller = createFullscreenController(fake.doc);

    expect(await controller.toggle()).toBe('entered');
    expect(fake.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
  });

  it('exits when the document is already fullscreen', async () => {
    const fake = fakeDocument({ active: true });
    const controller = createFullscreenController(fake.doc);

    expect(await controller.toggle()).toBe('exited');
    expect(fake.exitFullscreen).toHaveBeenCalledOnce();
  });

  it('reports unsupported and rejected requests without throwing', async () => {
    const unsupported = createFullscreenController(fakeDocument({ supported: false }).doc);
    expect(unsupported.supported()).toBe(false);
    expect(await unsupported.toggle()).toBe('unsupported');

    const fake = fakeDocument();
    fake.requestFullscreen!.mockRejectedValueOnce(new Error('denied'));
    expect(await createFullscreenController(fake.doc).toggle()).toBe('rejected');
  });

  it('publishes browser-initiated fullscreen changes and can unsubscribe', () => {
    const fake = fakeDocument();
    const controller = createFullscreenController(fake.doc);
    const changed = vi.fn();
    const unsubscribe = controller.subscribe(changed);

    fake.doc.fullscreenElement = fake.doc.documentElement;
    fake.emitChange();
    expect(changed).toHaveBeenCalledWith(true);

    unsubscribe();
    fake.emitChange();
    expect(changed).toHaveBeenCalledOnce();
  });
});

describe('fullscreen presentation', () => {
  it('hides unsupported controls and labels both supported states', () => {
    expect(fullscreenPresentation(false, false)).toEqual({
      visible: false,
      active: false,
      label: 'เต็มหน้าจอ',
    });
    expect(fullscreenPresentation(true, false)).toEqual({
      visible: true,
      active: false,
      label: 'เต็มหน้าจอ',
    });
    expect(fullscreenPresentation(true, true)).toEqual({
      visible: true,
      active: true,
      label: 'ออกจากเต็มหน้าจอ',
    });
  });
});
