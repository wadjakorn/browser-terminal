import { describe, expect, it, vi } from 'vitest';
import { createClipboard } from './clipboard.js';

const notAllowed = (): Error => {
  const error = new Error('denied');
  error.name = 'NotAllowedError';
  return error;
};

describe('write', () => {
  it('สำเร็จ และส่งข้อความไปตรงตัว', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = createClipboard({ clipboard: { writeText } as unknown as Clipboard, isSecureContext: true });

    expect(await clipboard.write('a\nb  ')).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('a\nb  ');
  });

  it('ไม่มี clipboard API เลย = unsupported ไม่ throw', async () => {
    const clipboard = createClipboard({ clipboard: undefined, isSecureContext: true });
    expect(await clipboard.write('x')).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('ไม่ใช่ secure context = unsupported โดยไม่แตะ API', async () => {
    const writeText = vi.fn();
    const clipboard = createClipboard({ clipboard: { writeText } as unknown as Clipboard, isSecureContext: false });

    expect(await clipboard.write('x')).toEqual({ ok: false, reason: 'unsupported' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('NotAllowedError = denied, error อื่น = failed', async () => {
    const denied = createClipboard({
      clipboard: { writeText: vi.fn().mockRejectedValue(notAllowed()) } as unknown as Clipboard,
      isSecureContext: true,
    });
    expect(await denied.write('x')).toEqual({ ok: false, reason: 'denied' });

    const broken = createClipboard({
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Clipboard,
      isSecureContext: true,
    });
    expect(await broken.write('x')).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('read', () => {
  it('สำเร็จ คืนข้อความ', async () => {
    const clipboard = createClipboard({
      clipboard: { readText: vi.fn().mockResolvedValue('pasted') } as unknown as Clipboard,
      isSecureContext: true,
    });
    expect(await clipboard.read()).toEqual({ ok: true, text: 'pasted' });
  });

  it('มี writeText แต่ไม่มี readText (แบบ Firefox) = unsupported', async () => {
    const clipboard = createClipboard({
      clipboard: { writeText: vi.fn() } as unknown as Clipboard,
      isSecureContext: true,
    });
    expect(await clipboard.read()).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('ผู้ใช้ปฏิเสธ prompt = denied', async () => {
    const clipboard = createClipboard({
      clipboard: { readText: vi.fn().mockRejectedValue(notAllowed()) } as unknown as Clipboard,
      isSecureContext: true,
    });
    expect(await clipboard.read()).toEqual({ ok: false, reason: 'denied' });
  });

  it('ไม่ใช่ secure context = unsupported', async () => {
    const clipboard = createClipboard({
      clipboard: { readText: vi.fn() } as unknown as Clipboard,
      isSecureContext: false,
    });
    expect(await clipboard.read()).toEqual({ ok: false, reason: 'unsupported' });
  });
});
