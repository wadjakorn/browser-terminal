import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createInputPipeline } from './input-pipeline.js';
import { mountKeybar } from './keybar.js';
import { watchViewport } from './viewport.js';
import { createGestureRecognizer } from './touch-gestures.js';
import { isKeyboardVisible, shouldReleaseFocus } from './keyboard-visibility.js';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const loginPage = $('login');
const appPage = $('app');
const statusEl = $('status');
const errorEl = $('login-error');

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let backoffMs = 1000;
let stopped = false;   // true เมื่อถูกเตะด้วย code 4000 — ห้าม reconnect

function showStatus(text: string | null): void {
  if (text === null) { statusEl.hidden = true; return; }
  statusEl.textContent = text;
  statusEl.hidden = false;
}

/**
 * GET /api/session — แยกสามสถานะ ไม่ใช่ boolean
 *
 * 'valid' / 'expired' / 'unreachable' ต้องแยกกัน เพราะเน็ตมือถือสะดุดคือ
 * สถานการณ์อันดับหนึ่งของแอปนี้ ถ้ารวม "เน็ตล่ม" เข้ากับ "session หมดอายุ"
 * ผู้ใช้จะถูกเด้งกลับหน้า login ทุกครั้งที่ขาดสัญญาณ ทั้งที่ cookie ยังใช้ได้
 */
type SessionState = 'valid' | 'expired' | 'unreachable';

async function checkSession(): Promise<SessionState> {
  try {
    const res = await fetch('/api/session');
    if (res.ok) return 'valid';
    if (res.status === 401) return 'expired';
    return 'unreachable';   // 5xx = server มีปัญหา ไม่ใช่ session หมดอายุ
  } catch {
    return 'unreachable';   // fetch โยน = เน็ตล่ม ต้อง reconnect ต่อ ไม่ใช่เด้ง login
  }
}

/** เด้งกลับหน้า login — ใช้ตอน session หมดอายุระหว่าง reconnect */
function backToLogin(): void {
  stopped = true;
  appPage.hidden = true;
  loginPage.hidden = false;
  showStatus(null);
}

function initTerminal(): { term: Terminal; fit: FitAddon } {
  const t = new Terminal({
    fontFamily: 'ui-monospace, monospace',
    fontSize: loadFontSize(),
    cursorBlink: true,
    theme: { background: '#101014', foreground: '#d8d8e0' },
  });
  const fit = new FitAddon();
  t.loadAddon(fit);
  t.open($('terminal'));

  const pipeline = createInputPipeline({
    send: bytes => { if (ws?.readyState === WebSocket.OPEN) ws.send(bytes); },
    getModes: () => t.modes,
  });

  const keybar = mountKeybar($('keybar'), {
    onKey: key => pipeline.onBarKey(key),
    modifierState: () => pipeline.modifierState(),
    onToggleKeyboard: () => toggleKeyboard(t),
  });

  syncKeyboardButton = () => keybar.syncKeyboard(keyboardVisible());

  // sync สถานะปุ่มจากทุกทางที่สถานะเปลี่ยนได้โดยไม่ผ่าน toggleKeyboard ของเรา
  t.textarea?.addEventListener('focus', syncKeyboardButton);
  t.textarea?.addEventListener('blur', syncKeyboardButton);

  // ผู้ใช้ปิดคีย์บอร์ดด้วยปุ่มของ OS = viewport ขยายกลับ แต่ textarea ยังโฟกัสอยู่
  // ต้องปล่อย focus ทิ้งเองตรงนี้ ไม่งั้นการแตะหรือปัดจอครั้งถัดไปจะทำให้ Android
  // เรียกคีย์บอร์ดกลับขึ้นมา ทั้งที่ผู้ใช้เพิ่งสั่งปิดไป — ดู shouldReleaseFocus()
  const vv = window.visualViewport;
  if (vv) {
    let prevVisible = keyboardVisible();
    vv.addEventListener('resize', () => {
      const nextVisible = keyboardVisible();
      if (shouldReleaseFocus(prevVisible, nextVisible, terminalFocused())) t.blur();
      prevVisible = nextVisible;
      syncKeyboardButton();
    });
  }

  t.onData(data => {
    pipeline.onTerminalData(data);
    keybar.refresh();
  });

  bindTouch(t, fit);

  return { term: t, fit };
}

// ─────────────────────────── touch ───────────────────────────

const FONT_MIN = 8;
const FONT_MAX = 24;
const FONT_KEY = 'bc.fontSize';

function loadFontSize(): number {
  const raw = Number(localStorage.getItem(FONT_KEY));
  return Number.isFinite(raw) && raw >= FONT_MIN && raw <= FONT_MAX ? raw : 13;
}

function terminalFocused(): boolean {
  return document.activeElement?.classList.contains('xterm-helper-textarea') ?? false;
}

/** ดู keyboard-visibility.ts สำหรับเหตุผลว่าทำไมห้ามใช้ focus เป็นตัวชี้วัด */
function keyboardVisible(): boolean {
  return isKeyboardVisible({
    innerHeight: window.innerHeight,
    visualHeight: window.visualViewport?.height,
    visualOffsetTop: window.visualViewport?.offsetTop,
    hasTouch: 'ontouchstart' in window,
    focused: terminalFocused(),
  });
}

function toggleKeyboard(t: Terminal): void {
  if (keyboardVisible()) {
    t.blur();
  } else {
    // blur ก่อน focus เสมอ — กรณี "โฟกัสอยู่แต่คีย์บอร์ดถูกซ่อน" การ focus ซ้ำ
    // เฉยๆ ไม่ทำให้ Android เรียกคีย์บอร์ดกลับมา ต้องให้เสีย focus ก่อน
    t.blur();
    t.focus();
  }
  syncKeyboardButton();
}

/** ให้ปุ่ม ⌨ สว่างตอนคีย์บอร์ดเปิด — ไม่งั้นผู้ใช้ไม่มีทางรู้ว่าสถานะไหน */
let syncKeyboardButton: () => void = () => {};

/**
 * ส่ง event ที่สังเคราะห์เองเข้า xterm แล้วให้ xterm เข้ารหัสเป็น escape sequence
 * ตามโหมดที่แอปข้างในขอไว้เอง — เราจึงไม่ต้องเขียน mouse protocol เองเลย
 * (`bindMouse` ของ xterm ผูก listener ที่ `term.element` และไม่เช็ค isTrusted)
 */
function bindTouch(t: Terminal, fit: FitAddon): void {
  const el = $('terminal');
  const target = t.element ?? el;
  let fontAtPinchStart = t.options.fontSize ?? 13;

  const mouseInit = (x: number, y: number, extra: MouseEventInit = {}): MouseEventInit => ({
    clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, ...extra,
  });

  /** ความสูงหนึ่งบรรทัดจริงบนจอ — เปลี่ยนตาม pinch zoom จึงต้องวัดสดทุกครั้ง */
  const cellHeight = (): number => {
    const row = el.querySelector('.xterm-rows > div');
    const h = row?.getBoundingClientRect().height ?? 0;
    return h > 0 ? h : 20;
  };

  const recognizer = createGestureRecognizer({
    // นาฬิกาเรือนเดียวกับที่ rAF ใช้ — ห้ามใช้ Date.now() ที่นี่
    now: () => performance.now(),
    wheelStepPx: cellHeight,
    emit: g => {
      switch (g.kind) {
        case 'wheel':
          // deltaMode 1 = บรรทัด ไม่ใช่พิกเซล — ตั้งใจ: ถ้าส่งเป็น px ที่ < 50
          // xterm จะเดาว่าเป็น trackpad แล้วคูณ 0.3 ทิ้ง (CoreMouseService:257)
          // ทำให้ต้องลากไกลกว่าที่ควร 3 เท่ากว่าจอจะขยับ
          target.dispatchEvent(new WheelEvent('wheel', {
            ...mouseInit(g.x, g.y), deltaY: g.lines, deltaMode: 1,
          }));
          return;

        case 'tap': {
          // แตะ = คลิกซ้ายให้ TUI (เลือก pane ใน herdr)
          //
          // xterm โฟกัส textarea ของตัวเองใน handler ของ mousedown ซึ่งบน Android
          // แปลว่าคีย์บอร์ดเด้งขึ้นมาทุกครั้งที่แตะ — ขัดกับที่ตกลงกันไว้ว่าแตะ =
          // คลิกอย่างเดียว จึงต้องคืนสถานะ focus กลับเป็นเหมือนก่อนแตะ
          const wasVisible = keyboardVisible();
          target.dispatchEvent(new MouseEvent('mousedown', mouseInit(g.x, g.y, { button: 0, buttons: 1 })));
          target.dispatchEvent(new MouseEvent('mouseup', mouseInit(g.x, g.y, { button: 0, buttons: 0 })));
          if (!wasVisible) t.blur();
          return;
        }

        // กดค้างแล้วลาก = กดปุ่มเมาส์ซ้ายค้างแล้วลาก ใช้ย่อ/ขยาย sidebar ของ herdr
        //
        // ต้องตั้ง buttons: 1 บน mousemove ด้วย ไม่ใช่แค่ mousedown — ไม่งั้น xterm
        // เข้ารหัสเป็น "เลื่อนเมาส์เฉยๆ" ไม่ใช่ "ลากทั้งที่กดปุ่มอยู่" แล้ว TUI จะไม่ลาก
        case 'dragStart': {
          // เหตุผลเดียวกับ tap: xterm โฟกัส textarea ใน handler ของ mousedown
          // ต้องคืน focus กลับทันที ไม่ใช่รอตอน dragEnd ไม่งั้นคีย์บอร์ดจะเด้งขึ้นมา
          // บังครึ่งจอตลอดเวลาที่กำลังลาก ซึ่งคือช่วงที่ต้องมองผลลัพธ์ที่สุด
          //
          // blur แล้ว mouse report ยังส่งต่อได้ปกติ — listener ของการลากอยู่ที่
          // document และ sendEvent ของ xterm ไม่ได้เช็ค focus เลย
          const wasVisible = keyboardVisible();
          navigator.vibrate?.(10);   // บอกผู้ใช้ว่าเข้าโหมดลากแล้ว ไม่งั้นเดาไม่ถูก
          target.dispatchEvent(new MouseEvent('mousedown', mouseInit(g.x, g.y, { button: 0, buttons: 1 })));
          if (!wasVisible) t.blur();
          return;
        }

        case 'dragMove':
          target.dispatchEvent(new MouseEvent('mousemove', mouseInit(g.x, g.y, { button: 0, buttons: 1 })));
          return;

        case 'dragEnd':
          target.dispatchEvent(new MouseEvent('mouseup', mouseInit(g.x, g.y, { button: 0, buttons: 0 })));
          return;

        case 'zoom': {
          const next = Math.round(
            Math.min(FONT_MAX, Math.max(FONT_MIN, fontAtPinchStart * g.scale)),
          );
          if (next === t.options.fontSize) return;
          t.options.fontSize = next;
          localStorage.setItem(FONT_KEY, String(next));
          fit.fit();
          sendResize();
          return;
        }
      }
    },
  });

  const points = (e: TouchEvent): { id: number; x: number; y: number }[] =>
    [...e.touches].map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));

  // ขับตัวจับเวลาของ recognizer ด้วย rAF เฉพาะตอนที่มันบอกว่ายังต้องการเฟรมต่อ
  // (นับเวลากดค้าง หรือ momentum กำลังไหล) — แอปนี้อยู่บนมือถือ ลูป rAF ที่ไม่ได้
  // ทำอะไรคือการเผาแบตเปล่าๆ
  let raf = 0;
  const pump = (): void => {
    if (raf) return;
    raf = requestAnimationFrame(function step() {
      raf = recognizer.tick() ? requestAnimationFrame(step) : 0;
    });
  };

  el.addEventListener('touchstart', e => {
    e.preventDefault();          // กันเบราว์เซอร์สังเคราะห์ mouse/โฟกัส/ซูมหน้าเว็บเอง
    if (e.touches.length >= 2) fontAtPinchStart = t.options.fontSize ?? 13;
    recognizer.onTouchStart(points(e));
    pump();                      // เริ่มนับเวลากดค้าง
  }, { passive: false });

  el.addEventListener('touchmove', e => {
    e.preventDefault();
    recognizer.onTouchMove(points(e));
  }, { passive: false });

  el.addEventListener('touchend', e => {
    e.preventDefault();
    recognizer.onTouchEnd(points(e));
    pump();                      // ปล่อยให้ momentum ไหลต่อถ้ามี
  }, { passive: false });

  el.addEventListener('touchcancel', () => {
    recognizer.onTouchCancel();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  });
}

/** รอ 1 เฟรมให้ layout settle ก่อนวัดขนาด */
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

async function connect(): Promise<void> {
  if (stopped || !term || !fitAddon) return;

  // ลำดับนี้สลับกันไม่ได้: ต้อง fit ก่อนจึงจะรู้ cols/rows ที่จะส่งไปกับ ws
  await nextFrame();
  fitAddon.fit();
  const { cols, rows } = term;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${proto}//${location.host}/pty?cols=${cols}&rows=${rows}`);
  socket.binaryType = 'arraybuffer';
  ws = socket;

  socket.onopen = () => {
    backoffMs = 1000;
    showStatus(null);
    term!.reset();          // PTY ใหม่คือ process ใหม่ ไม่รู้ว่าจออยู่ในสภาพไหน
    // ไม่ focus ตอนต่อติด — บนมือถือ focus = คีย์บอร์ดเด้งขึ้นมากินครึ่งจอทันที
    // ทั้งที่สิ่งแรกที่ผู้ใช้อยากทำคืออ่าน เปิดคีย์บอร์ดเองด้วยปุ่ม ⌨ บนแถบล่าง
  };

  socket.onmessage = ev => {
    if (ev.data instanceof ArrayBuffer) term!.write(new Uint8Array(ev.data));
  };

  socket.onclose = ev => {
    ws = null;
    if (ev.code === 4000) {
      stopped = true;
      showStatus('เปิดที่อื่นแล้ว — โหลดหน้านี้ใหม่เพื่อใช้ที่นี่แทน');
      return;
    }
    if (ev.code === 1000) {
      const m = /^exit:(-?\d+)$/.exec(ev.reason);
      const code = m ? m[1] : null;
      let text = 'shell ปิดแล้ว — โหลดหน้านี้ใหม่เพื่อเริ่มใหม่';
      if (code !== null) {
        text = `[process exited: code ${code}] — โหลดหน้านี้ใหม่เพื่อเริ่มใหม่`;
        if (code === '127') {
          text += ' (127 = หาโปรแกรมไม่เจอ เช็ค SHELL_CMD ใน .env)';
        }
      }
      showStatus(text);
      return;
    }
    void (async () => {
      // ก่อน reconnect เช็คว่า session ยังใช้ได้อยู่ไหม — ถ้าหมดอายุ/ถูกเพิกถอน
      // อย่า loop reconnect ไม่จบ ให้เด้งกลับ login แทน
      // เด้งกลับ login เฉพาะเมื่อ server ยืนยันว่า session หมดอายุจริง
      // เน็ตล่ม (unreachable) ต้อง reconnect ต่อ ไม่งั้นขาดสัญญาณแวบเดียว
      // ก็ต้องพิมพ์รหัสใหม่ ซึ่งคือเคสที่เกิดบ่อยที่สุดของแอปนี้
      if (await checkSession() === 'expired') { backToLogin(); return; }
      showStatus(`กำลังต่อใหม่ใน ${Math.round(backoffMs / 1000)} วิ…`);
      setTimeout(() => { void connect(); }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 8000);
    })();
  };
}

function sendResize(): void {
  if (!term || !fitAddon || ws?.readyState !== WebSocket.OPEN) return;
  fitAddon.fit();
  ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
}

async function startSession(): Promise<void> {
  stopped = false;
  loginPage.hidden = true;
  appPage.hidden = false;          // ต้องแสดงก่อน terminal จึงจะมีขนาดจริง

  const created = initTerminal();
  term = created.term;
  fitAddon = created.fit;

  watchViewport(() => {
    sendResize();
    syncKeyboardButton();   // ระบบซ่อน/แสดงคีย์บอร์ดเอง ไม่ยิง focus/blur ให้เรา
  });
  await connect();
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;
  const password = $<HTMLInputElement>('password').value;

  let res: Response;
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    errorEl.textContent = 'เชื่อมต่อ server ไม่ได้ ลองใหม่อีกครั้ง';
    errorEl.hidden = false;
    return;
  }

  if (res.ok) { await startSession(); return; }
  if (res.status === 429) {
    errorEl.textContent = 'ลองผิดบ่อยเกินไป รอสักครู่แล้วลองใหม่';
  } else if (res.status === 401) {
    errorEl.textContent = 'รหัสผ่านไม่ถูกต้อง';
  } else {
    errorEl.textContent = `server มีปัญหา (${res.status}) ลองใหม่อีกครั้ง`;
  }
  errorEl.hidden = false;
});

// ตอนโหลดหน้า: cookie 30 วันมีประโยชน์ก็ต่อเมื่อเช็คตอน mount — ไม่งั้นต้อง
// พิมพ์รหัสทุกครั้งที่เปิดหน้าเว็บทั้งที่ cookie ยังไม่หมดอายุ
void (async () => {
  // ตอนโหลดหน้าเข้า session ต่อเฉพาะเมื่อ 'valid' — 'unreachable' ให้แสดง
  // หน้า login ไว้ก่อน ปลอดภัยกว่าเข้า terminal ที่ต่อ ws ไม่ได้อยู่ดี
  if (await checkSession() === 'valid') await startSession();
})();
