import { describe, it, expect } from 'vitest';
import { clientIp } from './clientip.js';

const SOCK = '10.0.0.9';

describe('ไม่ได้อยู่หลัง proxy (default)', () => {
  // ถ้าเชื่อ header นี้โดยไม่มีเงื่อนไข ผู้โจมตีใส่ค่าสุ่มใหม่ทุกครั้งก็หนี rate limit ได้หมด
  it('**เมิน X-Forwarded-For ที่ปลอมมา ใช้ IP ของ socket จริง**', () => {
    expect(clientIp({ 'x-forwarded-for': '1.2.3.4' }, SOCK, false)).toBe(SOCK);
  });

  it('ไม่มี header ก็ใช้ socket', () => {
    expect(clientIp({}, SOCK, false)).toBe(SOCK);
  });
});

describe('อยู่หลัง proxy ที่เชื่อได้', () => {
  it('ใช้ค่าจาก X-Forwarded-For', () => {
    expect(clientIp({ 'x-forwarded-for': '1.2.3.4' }, SOCK, true)).toBe('1.2.3.4');
  });

  it('มีหลายค่า เอาตัวซ้ายสุดคือผู้เรียกเดิม', () => {
    expect(clientIp({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' }, SOCK, true))
      .toBe('1.2.3.4');
  });

  it('ตัดช่องว่างรอบค่า', () => {
    expect(clientIp({ 'x-forwarded-for': '  1.2.3.4  ' }, SOCK, true)).toBe('1.2.3.4');
  });

  it('header ซ้ำจนกลายเป็น array เอาตัวแรก', () => {
    expect(clientIp({ 'x-forwarded-for': ['1.2.3.4', '9.9.9.9'] }, SOCK, true)).toBe('1.2.3.4');
  });

  it('เปิด TRUST_PROXY ไว้แต่ proxy ไม่ส่ง header มา = ถอยไปใช้ socket', () => {
    expect(clientIp({}, SOCK, true)).toBe(SOCK);
    expect(clientIp({ 'x-forwarded-for': '' }, SOCK, true)).toBe(SOCK);
    expect(clientIp({ 'x-forwarded-for': '  ,  ' }, SOCK, true)).toBe(SOCK);
  });

  it('ไม่มีทั้ง header และ socket = คืนค่าว่าง ไม่ throw', () => {
    expect(clientIp({}, undefined, true)).toBe('');
  });
});
