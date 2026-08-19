import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutbound, type OutboundSink, type OutboundSource } from './outbound.js';

/** sink ปลอมที่เก็บ callback ไว้ให้เทสสั่ง ack เองได้ — Task 2 ใช้เต็มที่ */
function fakes() {
  const sent: string[] = [];
  const acks: Array<() => void> = [];
  const calls: string[] = [];
  const sink: OutboundSink = {
    send: (data, onFlushed) => { sent.push(data.toString('utf8')); acks.push(onFlushed); },
  };
  const source: OutboundSource = {
    pause: () => { calls.push('pause'); },
    resume: () => { calls.push('resume'); },
  };
  /** ack ทุก frame ที่ค้างอยู่ตามลำดับ */
  const ackAll = () => { while (acks.length) acks.shift()!(); };
  return { sink, source, sent, acks, calls, ackAll };
}

const buf = (s: string) => Buffer.from(s, 'utf8');

describe('createOutbound — coalescing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('chunk แรกหลังเงียบ ออกทันทีโดยไม่ต้องรอ timer', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    expect(f.sent).toEqual(['a']);   // ยังไม่ได้ advance timer เลย
    out.dispose();
  });

  it('chunk ที่ตามมาในหน้าต่างเดียวกัน ถูกรวมเป็น frame เดียว เรียงตามลำดับ', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    out.push(buf('b'));
    out.push(buf('c'));
    expect(f.sent).toEqual(['a']);   // b กับ c ยังสะสมอยู่
    vi.advanceTimersByTime(5);
    expect(f.sent).toEqual(['a', 'bc']);
    out.dispose();
  });

  it('burst ยาวถูกยุบเป็นหนึ่ง frame ต่อหนึ่งหน้าต่าง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('1'));              // ออกทันที
    out.push(buf('2'));
    vi.advanceTimersByTime(5);       // flush '2' แล้วต่อหน้าต่างใหม่
    out.push(buf('3'));
    vi.advanceTimersByTime(5);
    expect(f.sent).toEqual(['1', '2', '3']);
    out.dispose();
  });

  it('พิมพ์ทีละตัวห่างเกินหน้าต่าง ไม่ถูกหน่วงเลยสักตัว', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('x'));
    expect(f.sent).toEqual(['x']);
    vi.advanceTimersByTime(100);     // หน้าต่างปิดไปแล้วเพราะไม่มีของสะสม
    out.push(buf('y'));
    expect(f.sent).toEqual(['x', 'y']);
    out.dispose();
  });

  it('รวม buffer แบบไบต์ ไม่ทำ UTF-8 หลายไบต์พัง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    const thai = buf('ก');           // 3 ไบต์
    out.push(buf('a'));              // กินหน้าต่างแรกไป
    out.push(thai.subarray(0, 1));
    out.push(thai.subarray(1));
    vi.advanceTimersByTime(5);
    expect(f.sent).toEqual(['a', 'ก']);
    out.dispose();
  });

  it('flush() ส่งของค้างทันทีโดยไม่รอหน้าต่าง', () => {
    // ใช้ตอน shell ตาย: ถ้าไม่มีตัวนี้ output บรรทัดสุดท้ายจะหายไปกับ pending
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    out.push(buf('ลาก่อน'));
    expect(f.sent).toEqual(['a']);
    out.flush();
    expect(f.sent).toEqual(['a', 'ลาก่อน']);
    out.dispose();
  });

  it('flush() ตอนไม่มีของค้าง ไม่ส่ง frame เปล่า', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.flush();
    expect(f.sent).toEqual([]);
    out.dispose();
  });

  it('dispose แล้ว push ต่อไม่ส่งอะไรอีก และไม่มี timer ค้าง', () => {
    const f = fakes();
    const out = createOutbound(f.sink, f.source);
    out.push(buf('a'));
    out.push(buf('b'));
    out.dispose();
    out.push(buf('c'));
    vi.advanceTimersByTime(1000);
    expect(f.sent).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
