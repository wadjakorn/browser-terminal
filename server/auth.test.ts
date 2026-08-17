import { describe, it, expect } from 'vitest';
import { verifyPassword, hashPassword, signSession, verifySession, parseCookie } from './auth.js';

const SECRET = 'test-secret';
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

describe('verifyPassword', () => {
  it('รหัสถูกต้องผ่าน', () => expect(verifyPassword('hunter2', 'hunter2')).toBe(true));
  it('รหัสผิดไม่ผ่าน', () => expect(verifyPassword('nope', 'hunter2')).toBe(false));
  it('ความยาวต่างกันไม่ผ่านและไม่ throw', () =>
    expect(verifyPassword('short', 'muchlongerpassword')).toBe(false));
  it('ค่าว่างไม่ผ่าน', () => expect(verifyPassword('', 'hunter2')).toBe(false));
});

describe('session token', () => {
  it('token ที่เพิ่ง sign ผ่าน', () => {
    const t = signSession(SECRET, NOW + HOUR);
    expect(verifySession(SECRET, t, NOW)).toBe(true);
  });

  it('token หมดอายุไม่ผ่าน', () => {
    const t = signSession(SECRET, NOW - 1);
    expect(verifySession(SECRET, t, NOW)).toBe(false);
  });

  it('secret คนละตัวไม่ผ่าน', () => {
    const t = signSession(SECRET, NOW + HOUR);
    expect(verifySession('other-secret', t, NOW)).toBe(false);
  });

  it('แก้ expiry แล้วลายเซ็นไม่ตรง จึงไม่ผ่าน', () => {
    const t = signSession(SECRET, NOW + HOUR);
    const sig = t.split('.')[1]!;
    expect(verifySession(SECRET, `${NOW + HOUR * 999}.${sig}`, NOW)).toBe(false);
  });

  it('token รูปแบบพังไม่ throw', () => {
    for (const bad of ['', 'garbage', 'a.b.c', '.', '123.']) {
      expect(verifySession(SECRET, bad, NOW)).toBe(false);
    }
  });
});

describe('parseCookie', () => {
  it('ดึงค่าที่ต้องการจากหลายคุกกี้', () =>
    expect(parseCookie('a=1; bc_session=xyz; d=2', 'bc_session')).toBe('xyz'));
  it('ไม่มี header คืน undefined', () =>
    expect(parseCookie(undefined, 'bc_session')).toBeUndefined());
  it('ไม่มีชื่อนั้นคืน undefined', () =>
    expect(parseCookie('a=1', 'bc_session')).toBeUndefined());
  it('ไม่จับชื่อที่เป็นส่วนท้ายของชื่ออื่น', () =>
    expect(parseCookie('xbc_session=wrong', 'bc_session')).toBeUndefined());
});

describe('รหัสผ่านแบบ hash (scrypt)', () => {
  // สร้างครั้งเดียวใช้ทุกเทส — scrypt ตั้งใจให้ช้า การเรียกซ้ำๆ ทำให้ชุดเทสอืด
  const hash = hashPassword('hunter2');

  it('รูปแบบมี prefix ให้ดูออกว่าเป็น hash ไม่ใช่รหัสดิบ', () => {
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash).not.toContain('hunter2');
  });

  it('รหัสถูกต้องผ่าน', () => expect(verifyPassword('hunter2', hash)).toBe(true));
  it('รหัสผิดไม่ผ่าน', () => expect(verifyPassword('hunter3', hash)).toBe(false));
  it('ค่าว่างไม่ผ่าน', () => expect(verifyPassword('', hash)).toBe(false));

  it('salt ต่างกันทุกครั้ง — hash เดิมซ้ำสองครั้งต้องไม่เหมือนกัน', () => {
    expect(hashPassword('hunter2')).not.toBe(hashPassword('hunter2'));
  });

  it('hash พังหรือถูกตัดครึ่ง = ไม่ผ่าน และไม่ throw', () => {
    for (const bad of ['scrypt:', 'scrypt:abc', 'scrypt:zz:zz', 'scrypt:aa:bb:cc:dd']) {
      expect(verifyPassword('hunter2', bad)).toBe(false);
    }
  });

  it('รหัสดิบยังใช้ได้อยู่ — คนที่ไม่อยากยุ่งกับ hash ไม่ต้องเปลี่ยนอะไร', () => {
    expect(verifyPassword('hunter2', 'hunter2')).toBe(true);
  });
});

describe('เพิกถอน session ด้วย epoch', () => {
  it('epoch ตรงกันผ่าน', () => {
    const t = signSession(SECRET, NOW + HOUR, 5);
    expect(verifySession(SECRET, t, NOW, 5)).toBe(true);
  });

  // นี่คือหัวใจของ logout: token เก่าต้องตายทันทีโดยไม่ต้องรอหมดอายุ
  it('**epoch ถูกเพิ่มแล้ว token เก่าตายทันที**', () => {
    const t = signSession(SECRET, NOW + HOUR, 5);
    expect(verifySession(SECRET, t, NOW, 6)).toBe(false);
  });

  it('token จาก epoch ใหม่กว่าก็ไม่ผ่าน (กันของแปลกปลอม)', () => {
    const t = signSession(SECRET, NOW + HOUR, 9);
    expect(verifySession(SECRET, t, NOW, 6)).toBe(false);
  });

  it('epoch อยู่ในส่วนที่ถูกเซ็น แก้แล้วลายเซ็นพัง', () => {
    const t = signSession(SECRET, NOW + HOUR, 5);
    const forged = t.replace(/^5\./, '6.');
    expect(verifySession(SECRET, forged, NOW, 6)).toBe(false);
  });

  it('ยังหมดอายุตามเวลาเหมือนเดิม', () => {
    const t = signSession(SECRET, NOW - 1, 5);
    expect(verifySession(SECRET, t, NOW, 5)).toBe(false);
  });
});
