import type { ITerminalOptions } from '@xterm/xterm';

/**
 * option ของ xterm ที่โหมดเลือกข้อความพึ่งพา — แยกออกมาเพื่อล็อกค่าที่ห้ามเปลี่ยนด้วยเทสต์
 *
 * ทั้งสองค่าข้างล่างดูเหมือนตั้งเล่นๆ แต่ถ้าพลิกกลับ ฟีเจอร์จะพังโดยไม่มี error ให้เห็น
 */
export function terminalOptions(fontSize: number): ITerminalOptions {
  return {
    fontFamily: 'ui-monospace, monospace',
    fontSize,
    cursorBlink: true,
    theme: { background: '#101014', foreground: '#d8d8e0' },
    // บน iPad `navigator.platform` คือ 'MacIntel' ทำให้ xterm คิดว่าเป็น Mac แล้ว
    // shouldForceSelection กลายเป็น `altKey && ตัวเลือกนี้` — ถ้าปล่อยเป็น false
    // เงื่อนไขจะเป็นจริงไม่ได้เลย และ mousedown สังเคราะห์ของเราจะทะลุไปถึงแอปข้างใน
    // กลายเป็นคลิกจริงที่สลับ pane ของ herdr ทุกครั้งที่ผู้ใช้พยายามเลือกข้อความ
    //
    // ตั้ง true ได้โดยไม่ต้องเช็ค platform: บนเครื่องที่ไม่ใช่ Mac ไม่มี predicate
    // ตัวไหนอ่านค่านี้เลย (shouldForceSelection ใช้ shiftKey, shouldColumnSelect
    // ใช้ `!(isMac && ค่านี้)` ซึ่งเป็นจริงอยู่แล้วเมื่อ isMac เป็น false)
    macOptionClickForcesSelection: true,
    // `altKey` บน event สังเคราะห์ของโหมดเลือกคือธงเปิด column select ไม่ใช่ Alt ของ
    // ผู้ใช้ แต่ `_handleMouseUp` ของ xterm อ่านมันเป็น "Alt+คลิกเพื่อย้าย cursor": เมื่อ
    // selection ไม่เกินหนึ่งตัวอักษรและปล่อยภายใน 500 ms มันพิมพ์ปุ่มลูกศรเข้า PTY จน
    // cursor ไปถึงจุดที่แตะ การแตะครั้งเดียวในโหมดเลือกจึงยิง `ESC[C` เป็นร้อยตัวใส่
    // prompt ของ Claude Code — ราคาที่จ่ายคือ Alt+คลิกบนเดสก์ท็อปไม่ย้าย cursor
    altClickMovesCursor: false,
  };
}
