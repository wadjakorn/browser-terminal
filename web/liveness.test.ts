import { describe, expect, it, vi } from 'vitest';
import { createLiveness, LIVENESS_TIMEOUT_MS } from './liveness.js';

function setup() {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const onDead = vi.fn();
  const liveness = createLiveness({
    onDead,
    setTimeout: (fn, ms) => {
      expect(ms).toBe(LIVENESS_TIMEOUT_MS);
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: id => { timers.delete(id); },
  });
  const fire = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const socket = () => {
    const sent: string[] = [];
    return { sent, send: (d: string) => { sent.push(d); } };
  };
  const pongTo = (s: { sent: string[] }) =>
    JSON.stringify({ t: 'pong', n: JSON.parse(s.sent.at(-1)!).n });
  return { liveness, onDead, fire, timers, socket, pongTo };
}

describe('liveness probe', () => {
  it('ส่ง ping พร้อม nonce', () => {
    const { liveness, socket } = setup();
    const s = socket();
    liveness.probe(s);
    expect(JSON.parse(s.sent[0]!)).toMatchObject({ t: 'ping', n: expect.any(Number) });
  });

  it('pong ที่ nonce ตรง = สายดี ไม่เรียก onDead', () => {
    const { liveness, onDead, fire, socket, pongTo } = setup();
    const s = socket();
    liveness.probe(s);
    liveness.onText(s, pongTo(s));
    fire();
    expect(onDead).not.toHaveBeenCalled();
  });

  it('ไม่มีคำตอบภายในเวลา = ตาย พร้อมบอกว่า socket ตัวไหน', () => {
    const { liveness, onDead, fire, socket } = setup();
    const s = socket();
    liveness.probe(s);
    fire();
    expect(onDead).toHaveBeenCalledWith(s);
  });

  it('ข้อความอื่น หรือ pong ที่ nonce ผิด ไม่นับว่าสายดี', () => {
    // ตอนกลับมาจากเบื้องหลัง เบราว์เซอร์ส่ง frame ที่บัฟเฟอร์ไว้ก่อน TCP ตายเข้ามาทันที
    // ถ้านับข้อความใดๆ socket ที่ตายแล้วจะผ่านการตรวจไปได้
    const { liveness, onDead, fire, socket } = setup();
    const s = socket();
    liveness.probe(s);
    liveness.onText(s, JSON.stringify({ t: 'pong', n: -99 }));
    liveness.onText(s, 'not json');
    fire();
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('pong จาก socket อื่นไม่นับ', () => {
    const { liveness, onDead, fire, socket, pongTo } = setup();
    const a = socket();
    const b = socket();
    liveness.probe(a);
    liveness.onText(b, pongTo(a));
    fire();
    expect(onDead).toHaveBeenCalledWith(a);
  });

  it('cancel ของ socket ที่กำลังรอ (onclose ระหว่างรอ) แล้ว timer ไม่ยิง onDead', () => {
    // ไม่งั้น reconnect ได้ socket ใหม่ที่ดีอยู่ แล้ว timer เก่าไปฆ่ามันทิ้ง
    const { liveness, onDead, fire, socket } = setup();
    const s = socket();
    liveness.probe(s);
    liveness.cancel(s);
    fire();
    expect(onDead).not.toHaveBeenCalled();
  });

  it('cancel ของ socket อื่นไม่ยกเลิกการรอ', () => {
    const { liveness, onDead, fire, socket } = setup();
    const a = socket();
    liveness.probe(a);
    liveness.cancel(socket());
    fire();
    expect(onDead).toHaveBeenCalledWith(a);
  });

  it('probe ซ้อนบน socket เดิมไม่ส่ง ping ซ้ำและไม่ตั้ง timer สองตัว', () => {
    // visibilitychange กับ pageshow มาคู่กันได้
    const { liveness, timers, socket } = setup();
    const s = socket();
    liveness.probe(s);
    liveness.probe(s);
    expect(s.sent).toHaveLength(1);
    expect(timers.size).toBe(1);
  });

  it('ส่ง ping ไม่ได้ (socket โยน) = ตายทันที', () => {
    const { liveness, onDead, timers } = setup();
    const s = { send: () => { throw new Error('InvalidStateError'); } };
    liveness.probe(s);
    expect(onDead).toHaveBeenCalledWith(s);
    expect(timers.size).toBe(0);
  });
});
