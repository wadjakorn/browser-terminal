import { describe, expect, it, vi } from 'vitest';
import {
  ACCEPTED_IMAGE_TYPES,
  createImageAttacher,
  imageFromClipboard,
  messageFor,
  MAX_IMAGE_BYTES,
  type AttachFailure,
} from './image-attach.js';

const png = (size = 8) => new Blob([new Uint8Array(size)], { type: 'image/png' });

const respond = (status: number, body = '') => new Response(body, { status });
const ok = (path: string) =>
  new Response(JSON.stringify({ path }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('createImageAttacher', () => {
  it('คืน path ที่ server ตอบกลับมา', async () => {
    const fetchMock = vi.fn(async () => ok('/home/u/.cache/browser-console/images/paste-1-ab.png'));
    const attach = createImageAttacher({ fetch: fetchMock as unknown as typeof fetch });

    await expect(attach(png())).resolves.toEqual({
      ok: true, path: '/home/u/.cache/browser-console/images/paste-1-ab.png',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/image');
  });

  it('ปฏิเสธรูปใหญ่เกินตั้งแต่ก่อนอัปโหลด — ไม่เผาแบนด์วิดท์มือถือฟรีๆ', async () => {
    const fetchMock = vi.fn(async () => ok('/x.png'));
    const attach = createImageAttacher({ fetch: fetchMock as unknown as typeof fetch });

    await expect(attach(png(MAX_IMAGE_BYTES + 1))).resolves.toEqual({ ok: false, reason: 'too-large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('แยก HEIC ออกจาก "ไม่ใช่รูป" แม้ทั้งคู่จะเป็น 415', async () => {
    const heic = createImageAttacher({ fetch: (async () => respond(415, 'heic')) as unknown as typeof fetch });
    const other = createImageAttacher({ fetch: (async () => respond(415, 'not-image')) as unknown as typeof fetch });

    await expect(heic(png())).resolves.toEqual({ ok: false, reason: 'heic' });
    await expect(other(png())).resolves.toEqual({ ok: false, reason: 'not-image' });
  });

  it('แปลงสถานะที่เหลือเป็นเหตุผลที่บอกผู้ใช้ได้', async () => {
    const cases: [number, AttachFailure][] = [[401, 'unauthorized'], [404, 'disabled'], [413, 'too-large'], [500, 'failed']];
    for (const [status, reason] of cases) {
      const attach = createImageAttacher({ fetch: (async () => respond(status)) as unknown as typeof fetch });
      await expect(attach(png())).resolves.toEqual({ ok: false, reason });
    }
  });

  it('เครือข่ายล้มหรือ body พัง = failed ไม่ใช่ throw', async () => {
    const down = createImageAttacher({ fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    const junk = createImageAttacher({ fetch: (async () => new Response('ไม่ใช่ json', { status: 200 })) as unknown as typeof fetch });

    await expect(down(png())).resolves.toEqual({ ok: false, reason: 'failed' });
    await expect(junk(png())).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});

describe('imageFromClipboard', () => {
  const item = (kind: string, type: string, file: File | null) =>
    ({ kind, type, getAsFile: () => file }) as unknown as DataTransferItem;
  const data = (items: DataTransferItem[], files: File[] = []) =>
    ({ items, files }) as unknown as DataTransfer;

  it('หยิบรูปจาก items ก่อน — Safari ทิ้ง files ว่างไว้เมื่อรูปไม่ได้มาจากไฟล์จริง', () => {
    const file = new File([new Uint8Array(2)], 'x.png', { type: 'image/png' });
    expect(imageFromClipboard(data([item('file', 'image/png', file)]))).toBe(file);
  });

  it('ข้ามข้อความล้วน เพื่อให้ xterm จัดการ paste ปกติต่อได้', () => {
    expect(imageFromClipboard(data([item('string', 'text/plain', null)]))).toBeNull();
    expect(imageFromClipboard(null)).toBeNull();
  });

  it('ตกไปที่ files เมื่อ items ไม่มีรูป — เคส drag & drop', () => {
    const file = new File([new Uint8Array(2)], 'x.jpg', { type: 'image/jpeg' });
    expect(imageFromClipboard(data([], [file]))).toBe(file);
  });
});

describe('รูปแบบที่ประกาศไว้', () => {
  it('accept ไม่ใช่ image/* — iPhone จะยื่น HEIC มาซึ่งปลายทางอ่านไม่ออก', () => {
    expect(ACCEPTED_IMAGE_TYPES).not.toContain('image/*');
    expect(ACCEPTED_IMAGE_TYPES).toContain('image/png');
  });

  it('ทุกเหตุผลมีข้อความของตัวเอง ไม่ซ้ำกัน', () => {
    const reasons: AttachFailure[] = ['too-large', 'heic', 'not-image', 'disabled', 'unauthorized', 'failed'];
    const messages = reasons.map(messageFor);
    expect(new Set(messages).size).toBe(reasons.length);
  });
});
