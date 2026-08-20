import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { readJsonBody, MAX_BODY_BYTES } from './index.js';

/** stream ปลอมที่นับว่าถูก destroy กี่ครั้ง — ของจริงคือ socket ที่ต้องถูกปล่อย */
function fakeRequest(chunks: Buffer[]): IncomingMessage & { destroyed: number } {
  let destroyed = 0;
  const req = {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
    destroy() { destroyed++; },
    get destroyedCount() { return destroyed; },
  };
  return new Proxy(req, {
    get: (t, k) => (k === 'destroyed' ? destroyed : Reflect.get(t, k)),
  }) as unknown as IncomingMessage & { destroyed: number };
}

describe('readJsonBody', () => {
  it('อ่าน JSON ปกติได้', async () => {
    const req = fakeRequest([Buffer.from('{"password":"x"}')]);
    expect(await readJsonBody(req)).toEqual({ password: 'x' });
    expect(req.destroyed).toBe(0);
  });

  it('body เกินลิมิตต้อง destroy stream ก่อน throw ไม่ใช่แค่เลิกอ่าน', async () => {
    // ถ้าไม่ destroy ฝั่งที่ส่งจะไถ byte ต่อไปโดยที่ socket ยังถูกจองอยู่
    const req = fakeRequest([Buffer.alloc(MAX_BODY_BYTES + 1)]);
    await expect(readJsonBody(req)).rejects.toThrow();
    expect(req.destroyed).toBe(1);
  });

  it('นับขนาดสะสมข้าม chunk ไม่ใช่ทีละก้อน', async () => {
    const half = Math.ceil(MAX_BODY_BYTES / 2) + 1;
    const req = fakeRequest([Buffer.alloc(half), Buffer.alloc(half)]);
    await expect(readJsonBody(req)).rejects.toThrow();
    expect(req.destroyed).toBe(1);
  });

  it('JSON พังยังโยน error ตามเดิม (handler ถือว่ารหัสผิด)', async () => {
    const req = fakeRequest([Buffer.from('ไม่ใช่ json')]);
    await expect(readJsonBody(req)).rejects.toThrow();
  });
});
