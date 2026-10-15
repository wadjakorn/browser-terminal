import { describe, expect, it } from 'vitest';
import { checkSession } from './session-check.js';

const respond = (status: number) => async () => ({ ok: status >= 200 && status < 300, status });

describe('checkSession', () => {
  it('200 → valid', async () => expect(await checkSession(respond(200))).toBe('valid'));
  it('401 → expired', async () => expect(await checkSession(respond(401))).toBe('expired'));
  it('5xx → unreachable ไม่ใช่ expired', async () =>
    expect(await checkSession(respond(502))).toBe('unreachable'));
  it('fetch โยน → unreachable', async () =>
    expect(await checkSession(async () => { throw new TypeError('Failed to fetch'); })).toBe('unreachable'));

  it('fetch ค้าง → unreachable เมื่อหมดเวลา ไม่ค้างตามไปด้วย', async () => {
    // fetch จริงโยนเมื่อ signal abort — จำลองแบบเดียวกัน
    const hanging = (_: string, init?: RequestInit) => new Promise<never>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
    expect(await checkSession(hanging, 20)).toBe('unreachable');
  });
});
