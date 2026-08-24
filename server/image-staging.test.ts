import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_IMAGE_BYTES,
  STAGE_QUOTA_BYTES,
  STAGE_TTL_MS,
  sniffImageKind,
  stageImage,
} from './image-staging.js';

const dir = () => mkdtempSync(join(tmpdir(), 'bc-stage-'));
const bytes = (...values: (number | string)[]): Uint8Array =>
  new Uint8Array(values.flatMap(v => typeof v === 'string' ? [...v].map(c => c.charCodeAt(0)) : [v]));

const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);

describe('sniffImageKind', () => {
  it('รู้จักฟอร์แมตที่ปลายทางอ่านได้', () => {
    expect(sniffImageKind(PNG)).toBe('png');
    expect(sniffImageKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpg');
    expect(sniffImageKind(bytes('GIF89a', 0))).toBe('gif');
    expect(sniffImageKind(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('webp');
  });

  it('แยก HEIC ออกจาก "ไม่ใช่รูป" — ผู้ใช้แก้คนละวิธี', () => {
    expect(sniffImageKind(bytes(0, 0, 0, 0x18, 'ftyp', 'heic'))).toBe('heic');
    expect(sniffImageKind(bytes(0, 0, 0, 0x18, 'ftyp', 'mif1'))).toBe('heic');
  });

  it('ปฏิเสธไบต์ที่ไม่ใช่รูป และปฏิเสธไฟล์สั้นเกินโดยไม่ crash', () => {
    expect(sniffImageKind(bytes('#!/bin/sh\n'))).toBeNull();
    expect(sniffImageKind(new Uint8Array(0))).toBeNull();
    expect(sniffImageKind(bytes(0x89))).toBeNull();
  });
});

describe('stageImage', () => {
  it('ชื่อไฟล์ต้องไม่มีช่องว่าง — Codex หั่น path ที่มีช่องว่างด้วย shlex แล้วทิ้งเงียบ', async () => {
    const staged = await stageImage(dir(), PNG, 'png');
    expect(staged.path).not.toMatch(/\s/);
    expect(staged.path.endsWith('.png')).toBe(true);
  });

  it('เขียนไบต์ครบและตั้งสิทธิ์ 0600 ตั้งแต่ตอนสร้าง', async () => {
    const staged = await stageImage(dir(), PNG, 'png');
    expect(readFileSync(staged.path)).toEqual(Buffer.from(PNG));
    expect(statSync(staged.path).mode & 0o777).toBe(0o600);
  });

  it('ไดเรกทอรีต้องเป็น 0700 แม้จะมีอยู่ก่อนแล้วด้วยสิทธิ์อื่น', async () => {
    const target = dir();
    const staged = await stageImage(target, PNG, 'png');
    expect(statSync(target).mode & 0o777).toBe(0o700);
    expect(staged.path.startsWith(target)).toBe(true);
  });

  it('ลบไฟล์ที่เก่าเกิน TTL แต่ไม่แตะไฟล์ใหม่', async () => {
    const target = dir();
    const stale = join(target, 'paste-old.png');
    const fresh = join(target, 'paste-new.png');
    writeFileSync(stale, 'x');
    writeFileSync(fresh, 'x');
    const old = (Date.now() - STAGE_TTL_MS - 60_000) / 1000;
    utimesSync(stale, old, old);

    await stageImage(target, PNG, 'png');

    const left = readdirSync(target);
    expect(left).not.toContain('paste-old.png');
    expect(left).toContain('paste-new.png');
  });

  it('ลบไฟล์เก่าสุดก่อนเมื่อพื้นที่รวมจะเกินโควตา', async () => {
    const target = dir();
    const big = Buffer.alloc(Math.floor(STAGE_QUOTA_BYTES / 2));
    const older = join(target, 'paste-a.png');
    const newer = join(target, 'paste-b.png');
    writeFileSync(older, big);
    writeFileSync(newer, big);
    const back = (Date.now() - 60_000) / 1000;
    utimesSync(older, back, back);

    await stageImage(target, PNG, 'png');

    const left = readdirSync(target);
    expect(left).not.toContain('paste-a.png');
    expect(left).toContain('paste-b.png');
  });

  it('เพดานต่อไฟล์ตรงกับที่ herdr ใช้ (16 MiB)', () => {
    expect(MAX_IMAGE_BYTES).toBe(16 * 1024 * 1024);
  });
});
