import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createInputPipeline } from './input-pipeline.js';
import { mountKeybar, type MountedKeybar } from './keybar.js';
import { watchViewport } from './viewport.js';
import { createGestureRecognizer } from './touch-gestures.js';
import { isKeyboardVisible } from './keyboard-visibility.js';
import {
  applyTerminalFocusEffect,
  initialTerminalFocusState,
  transitionTerminalFocus,
  type TerminalFocusEvent,
} from './keyboard-focus-mode.js';
import { fitAndSendResize } from './terminal-resize.js';
import { createTextSelection, selectionMouseInit, type TerminalPort } from './text-selection.js';
import { createSelectionSheet } from './selection-sheet.js';
import { createSelectionHandles, CONFIRM_BAR_HEIGHT_PX, type PlacementLimits } from './selection-handles.js';
import { createClipboard } from './clipboard.js';
import { loadSelectionPrefs } from './selection-prefs.js';
import { createFullscreenController } from './fullscreen.js';
import { createLinkOpener, type LinkOpener } from './links.js';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const loginPage = $('login');
const appPage = $('app');
const statusEl = $('status');
const errorEl = $('login-error');

let selection: ReturnType<typeof createTextSelection> | null = null;
/**
 * หยุดท่าทางที่ค้างอยู่ของ recognizer — ตั้งค่าโดย bindTouch
 *
 * จำเป็นเพราะโหมดเลือกดักนิ้วไว้ก่อนถึง recognizer ทำให้ `onTouchStart` ไม่ถูกเรียก
 * ซึ่งเป็นที่เดียวที่หยุด momentum ("แตะระหว่างไหลอยู่ = จับให้หยุด") ผลคือถ้าผู้ใช้
 * สะบัดเลื่อนหาข้อความแล้วกด ⧉ ทันที momentum จะไหลต่อและยิง wheel ใส่แอปข้างในไป
 * เรื่อยๆ จอเลื่อนหนีมือขณะกำลังลากเลือก ทั้งที่ลากอยู่กลางจอไม่ได้แตะขอบเลย
 */
let stopGestures: (() => void) | null = null;
const clipboard = createClipboard();
const fullscreen = createFullscreenController(document);

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let backoffMs = 1000;
let stopped = false;   // true เมื่อถูกเตะด้วย code 4000 — ห้าม reconnect
let resetInputModifiers: () => void = () => {};

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

/** ตั้งค่าใน initTerminal และใช้ต่อใน bindTouch ซึ่งถูกเรียกหลังจากนั้น */
let linkOpener: LinkOpener | null = null;
let linkPort: TerminalPort | null = null;

/**
 * ตั้งค่าจริงใน initTerminal — ต้องอยู่ที่ module scope เพราะ bindTouch เป็นฟังก์ชัน
 * แยกที่เรียกทีหลัง closure ของ initTerminal จึงมองไม่เห็นกัน touchend ใน bindTouch
 * ต้องเรียกตัวนี้หลัง pointerUp ทุกครั้ง ไม่งั้นทางเดียวที่ overlay จะโผล่คือรอ
 * PTY output มายิง t.onScroll โดยบังเอิญ
 */
let syncHandles: () => void = () => {};

function initTerminal(): { term: Terminal; fit: FitAddon; keybar: MountedKeybar } {
  const t = new Terminal({
    fontFamily: 'ui-monospace, monospace',
    fontSize: loadFontSize(),
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
  });
  const fit = new FitAddon();
  t.loadAddon(fit);
  t.open($('terminal'));

  let terminalFocusState = initialTerminalFocusState();
  const terminalFocusPort = {
    textarea: t.textarea,
    focus: () => t.focus(),
    blur: () => t.blur(),
    canFocus: () => {
      if (selection?.active()) return false;
      const active = document.activeElement;
      if (!active || active === document.body || active === t.textarea) return true;
      const ownsTextInput = active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || active instanceof HTMLSelectElement
        || (active instanceof HTMLElement && active.isContentEditable);
      const visible = active instanceof HTMLElement && active.getClientRects().length > 0;
      return !(ownsTextInput && visible);
    },
  };
  const dispatchTerminalFocus = (event: TerminalFocusEvent): void => {
    const transition = transitionTerminalFocus(terminalFocusState, event);
    terminalFocusState = transition.state;
    applyTerminalFocusEffect(terminalFocusPort, transition.effect);
  };

  const pipeline = createInputPipeline({
    send: bytes => { if (ws?.readyState === WebSocket.OPEN) ws.send(bytes); },
    getModes: () => t.modes,
  });

  const keybar = mountKeybar($('keybar'), {
    onKey: key => pipeline.onBarKey(key),
    onAction: action => {
      if (action === 'select-mode') selection?.toggle();
      else void doPaste(t);
    },
    actionState: action => action === 'select-mode' && (selection?.active() ?? false),
    modifierState: () => pipeline.modifierState(),
    onToggleKeyboard: () => {
      if (keyboardVisible()) dispatchTerminalFocus('request-ime-close');
      else {
        leaveSelectionForKeyboard();
        dispatchTerminalFocus('request-ime-open');
      }
      syncKeyboardButton();
    },
    onOpenKeyboard: () => {
      leaveSelectionForKeyboard();
      dispatchTerminalFocus('request-ime-open');
      syncKeyboardButton();
    },
    onRequestKeyboardClose: () => {
      dispatchTerminalFocus('request-ime-close');
      syncKeyboardButton();
    },
    onToggleFullscreen: () => {
      void fullscreen.toggle().then(result => {
        if (result === 'rejected') {
          showStatus('เบราว์เซอร์ไม่อนุญาตให้เปิดเต็มหน้าจอ');
        }
      });
    },
    fullscreenState: () => ({
      supported: fullscreen.supported(),
      active: fullscreen.active(),
    }),
    viewport: () => ({
      visualHeight: window.visualViewport?.height ?? window.innerHeight,
      // บน desktop keyboardVisible() ใช้ focus เพื่อให้ปุ่ม ⌨ toggle ได้ แต่ focus
      // ไม่ได้หมายความว่าจะมี viewport height ถูกคืนมา จึงวัด replacement เฉพาะ
      // อุปกรณ์สัมผัสที่มี Visual Viewport API เท่านั้น
      keyboardVisible: Boolean(
        window.visualViewport && 'ontouchstart' in window && keyboardVisible()
      ),
    }),
    onPanelChange: () => {
      // ต้อง syncHandles() ด้วย ไม่ใช่แค่ sendResize() — placementLimits() อ่าน
      // rect ของ #keybar สด แต่ sendResize ผ่าน sendResize → fit → t.onResize
      // ซึ่งยิงเฉพาะตอนจำนวนแถว/คอลัมน์เปลี่ยนจริง แผงตั้งค่าที่กางแค่บางส่วน
      // ของแถวไม่ทำให้ cols/rows เปลี่ยน แถบยืนยันจะค้างทับแผงจนกว่าเหตุการณ์อื่นจะมาสะกิด
      requestAnimationFrame(() => { sendResize(); syncHandles(); });
    },
  });

  fullscreen.subscribe(() => {
    keybar.syncFullscreen();
    requestAnimationFrame(() => sendResize());
  });

  resetInputModifiers = () => {
    pipeline.clearModifiers();
    keybar.refresh();
  };

  syncKeyboardButton = () => {
    const open = keyboardVisible();
    keybar.syncKeyboard(
      open,
      Boolean(window.visualViewport && 'ontouchstart' in window && open),
    );
  };

  /**
   * ยามกันคีย์บอร์ดเด้งระหว่างโหมดเลือก
   *
   * xterm รองรับ primary selection ของ X11 ด้วยการโฟกัส textarea ทุกครั้งที่
   * selection เปลี่ยน:
   *
   *   refresh(e) { ... isLinux && e && selectionText.length
   *                 && _onLinuxMouseSelection.fire(selectionText) }
   *   onLinuxMouseSelection(text => { textarea.value = text; textarea.focus(); ... })
   *
   * และ `isLinux` มาจาก navigator.platform ซึ่งบน Android คือ "Linux armv8l" จึงเข้า
   * เงื่อนไขเต็มๆ ส่วน refresh(true) ถูกเรียกทั้งใน handleMouseDown และ
   * _handleMouseMove แปลว่ามันโฟกัสกลับมาใหม่ทุกครั้งที่นิ้วขยับ — blur ครั้งเดียว
   * ตอนเริ่มลากจึงเอาไม่อยู่ ต้องกันที่ตัว focus เอง
   *
   * วัดแล้วในเบราว์เซอร์จริง: blur อย่างเดียว focused กลับเป็น true ตั้งแต่ mousemove
   * แรก ส่วนยามตัวนี้ทำให้ focused เป็น false ตลอดการลากโดย selection ยังอยู่ครบ
   */
  t.textarea?.addEventListener('focus', () => {
    if (selection?.active()) t.blur();
  });

  // sync สถานะปุ่มจากทุกทางที่สถานะเปลี่ยนได้โดยไม่ผ่าน dispatcher ของเรา
  t.textarea?.addEventListener('focus', syncKeyboardButton);
  t.textarea?.addEventListener('blur', syncKeyboardButton);

  // ผู้ใช้ปิดคีย์บอร์ดด้วยปุ่มของ OS = viewport ขยายกลับ แต่คง terminal focus ไว้
  // ใน physical mode เพื่อให้คีย์บอร์ด Bluetooth พิมพ์ต่อได้โดยไม่เรียก IME กลับมา
  const vv = window.visualViewport;
  if (vv) {
    let prevVisible = keyboardVisible();
    vv.addEventListener('resize', () => {
      const nextVisible = keyboardVisible();
      if (prevVisible && !nextVisible) {
        dispatchTerminalFocus('native-ime-hidden');
      }
      prevVisible = nextVisible;
      syncKeyboardButton();
      // overlay ตรึงตำแหน่งด้วย viewport coordinates — IME โผล่/หุบไม่เปลี่ยนจำนวนแถว
      // จึงไม่ผ่าน t.onResize เลย ต้องอาศัย visualViewport ตัวเดียวกับที่ใช้ตัดสิน
      // สถานะคีย์บอร์ดข้างบนนี้แหละมาซิงก์ตำแหน่งหมุด/แถบยืนยันด้วย
      syncHandles();
    });
  }

  t.onData(data => {
    pipeline.onTerminalData(data);
    keybar.refresh();
  });

  const el = $('terminal');
  const sheet = createSelectionSheet({
    copy: text => clipboard.write(text),
    onClose: () => { selection?.cancel(); keybar.refresh(); },
  });
  $('app').append(sheet.element);

  const handles = createSelectionHandles({
    // ต้อง sync ทันทีที่จับหมุด ไม่งั้น overlay จะยังวาด rect ก่อนจับค้างอยู่จนกว่า
    // เหตุการณ์ถัดไปจะมาสะกิด — ผู้ใช้เห็นหมุดค้างที่จุดเดิมทั้งที่กำลังลากอยู่แล้ว
    onGrab: corner => { selection?.beginHandleDrag(corner); syncHandles(); },
    // ปลายทางของ touchmove/touchend ที่ selection-handles.ts ผูกเองระหว่างลากหมุด —
    // bindTouch ใน main.ts มองไม่เห็นอีเวนต์พวกนี้เพราะ target ไม่ใช่ #terminal
    onDragMove: (x, y) => selection?.pointerMove(x, y),
    onDragEnd: (x, y) => { selection?.pointerUp(x, y); syncHandles(); },
    onConfirm: () => selection?.confirm(),
    onCancel: () => selection?.cancel(),
  });
  $('app').append(handles.element);

  /**
   * ขอบล่างที่ใช้ได้คือ top ของแถบปุ่ม ไม่ใช่ขอบ viewport — แถบปุ่มกินพื้นที่ล่างจอ
   * อยู่ตลอด และความสูงของมันเปลี่ยนได้ตอนกางหน้า settings จึงต้องอ่านสดทุกครั้ง
   */
  const placementLimits = (): PlacementLimits => {
    const bar = $('keybar').getBoundingClientRect();
    return { viewportHeight: window.innerHeight, bottomLimit: bar.top, barHeight: CONFIRM_BAR_HEIGHT_PX };
  };

  /**
   * overlay โผล่เฉพาะสถานะ adjusting — ระหว่างลากไม่ต้องมีหมุดให้รก และ onBlockChange
   * ที่ยิงถี่ระหว่างลากจะไม่ทำให้ overlay กะพริบ
   *
   * ต้องเช็ค sheet.isOpen() ด้วย ไม่ใช่แค่ phase — confirm() ตั้งใจปล่อยให้
   * phase ยังเป็น 'adjusting' ต่อไปเพื่อให้ไฮไลต์ของ xterm อยู่ใต้แผ่นผลลัพธ์
   * แล้ว onRegionPicked ก็ซ่อน overlay เองครั้งเดียว แต่ t.onScroll (PTY
   * output ระหว่างรันคำสั่ง แทบจะเกิดแน่นอน), t.onResize, resize ของ window,
   * และ visualViewport resize ล้วนเรียก syncHandles() ซ้ำได้ทุกเมื่อ — ถ้าไม่กัน
   * ตรงนี้ หมุดกับแถบยืนยันจะโผล่ทับ backdrop ของแผ่นผลลัพธ์กลับมาใหม่ ทั้งที่
   * แตะอะไรก็ไม่ติดเพราะ backdrop ที่ z-index สูงกว่ากลืนทัชไปหมด
   */
  syncHandles = (): void => {
    if (!selection || sheet.isOpen() || selection.state() !== 'adjusting') {
      handles.place(null, placementLimits());
      return;
    }
    handles.place(selection.blockRect(), placementLimits());
  };

  const port = createTerminalPort(t, el, t.element ?? el);
  linkPort = port;
  linkOpener = createLinkOpener({
    terminal: port,
    open: url => { window.open(url, '_blank', 'noopener,noreferrer'); },
  });

  selection = createTextSelection({
    terminal: port,
    loadPrefs: columns => loadSelectionPrefs(columns),
    onRegionPicked: text => {
      // ซ่อน overlay ก่อนเปิดแผ่น ไม่งั้นหมุดจะลอยทับ backdrop
      handles.place(null, placementLimits());
      sheet.open(text);
    },
    onModeChange: active => {
      el.classList.toggle('selecting', active);
      if (active) {
        stopGestures?.();
        // Ctrl ที่ค้างอยู่จะไปยิงใส่ปุ่มถัดไปที่ไม่เกี่ยวกันเลยหลังออกจากโหมด
        pipeline.clearModifiers();
        dispatchTerminalFocus('selection-entered');
      } else {
        dispatchTerminalFocus('selection-exited');
      }
      syncHandles();
      keybar.refresh();
    },
    onBlockChange: () => {
      handles.setCopyEnabled(selection?.blockHasText() === true);
      syncHandles();
    },
    vibrate: ms => navigator.vibrate?.(ms),
  });

  bindTouch(t, fit);
  // การเลื่อนนี้มาจาก output ของ PTY เท่านั้น — ในโหมดเลือก stopGestures() ถูกเรียก
  // และนิ้วเดียวทุกครั้งถูก selectionOwnsTouch() ยึดไป ผู้ใช้เลื่อนจอเองไม่ได้
  t.onScroll(() => syncHandles());
  t.onResize(() => syncHandles());
  window.addEventListener('resize', syncHandles);
  dispatchTerminalFocus('session-ready');
  syncKeyboardButton();

  return { term: t, fit, keybar };
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

/**
 * โหมดเลือกกับคีย์บอร์ดบนจออยู่ด้วยกันไม่ได้
 *
 * คีย์บอร์ดที่โผล่มาระหว่างลากจะหด visualViewport ทำให้ทั้ง layout และขนาดเซลล์ที่ใช้
 * แปลงพิกัดเปลี่ยนกลางการลาก กด ⌨ ระหว่างเลือกจึงถือเป็นการบอกว่า "เลิกเลือกแล้ว
 * จะพิมพ์" — ออกจากโหมดให้ก่อน ดีกว่าปล่อยให้ปุ่มกดไม่ติดโดยไม่บอกอะไรเลย
 */
function leaveSelectionForKeyboard(): void {
  if (selection?.active()) selection.cancel();
}

/** ให้ปุ่ม ⌨ สว่างตอนคีย์บอร์ดเปิด — ไม่งั้นผู้ใช้ไม่มีทางรู้ว่าสถานะไหน */
let syncKeyboardButton: () => void = () => {};

/**
 * ส่ง event ที่สังเคราะห์เองเข้า xterm แล้วให้ xterm เข้ารหัสเป็น escape sequence
 * ตามโหมดที่แอปข้างในขอไว้เอง — เราจึงไม่ต้องเขียน mouse protocol เองเลย
 * (`bindMouse` ของ xterm ผูก listener ที่ `term.element` และไม่เช็ค isTrusted)
 */
/**
 * สะพานจาก xterm มาเป็น TerminalPort ที่ text-selection.ts ต้องการ
 *
 * ทุกอย่างที่มีรูปร่างแบบ xterm ถูกกันไว้ในนี้ ตัวควบคุมจึงเทสได้กับ port ปลอม
 */
function createTerminalPort(t: Terminal, el: HTMLElement, target: HTMLElement): TerminalPort {
  // ใช้เซลล์ตัวเดียวซ้ำทั้งการสแกน: การตรวจเส้นแบ่งแตะราว rows × columns เซลล์
  // (~8,000 เซลล์บนจอแนวนอน) ทุกครั้งที่กดปุ่ม และ getCell ที่ไม่ส่ง target มาให้
  // จะสร้าง object ใหม่ทุกครั้ง
  const scratch = { getChars: () => '' } as unknown as import('@xterm/xterm').IBufferCell;
  let cell: import('@xterm/xterm').IBufferCell | undefined;

  const screenElement = (): HTMLElement =>
    (el.querySelector('.xterm-screen') as HTMLElement | null) ?? target;

  return {
    get rows() { return t.rows; },
    get columns() { return t.cols; },

    viewportTop: () => t.buffer.active.viewportY,

    readCell(line, column) {
      const bufferLine = t.buffer.active.getLine(line);
      if (!bufferLine) return '';
      cell = bufferLine.getCell(column, cell ?? scratch);
      return cell?.getChars() ?? '';
    },

    // endColumn ของสัญญานี้เป็น inclusive ส่วนของ xterm เป็น exclusive
    readLine: (line, startColumn, endColumn) =>
      t.buffer.active.getLine(line)?.translateToString(false, startColumn, endColumn + 1) ?? '',

    screenMetrics() {
      // อ่าน rect สดทุกครั้ง — แถบปุ่มที่กางออกและคีย์บอร์ดที่โผล่ขึ้นมาย้ายมันได้
      const screen = screenElement();
      const rect = screen.getBoundingClientRect();
      const row = el.querySelector('.xterm-rows > div');
      const cellHeight = row?.getBoundingClientRect().height ?? 0;
      return {
        cellWidth: t.cols > 0 ? rect.width / t.cols : 0,
        cellHeight,
        left: rect.left,
        top: rect.top,
      };
    },

    dispatchMouse(type, clientX, clientY) {
      target.dispatchEvent(new MouseEvent(type, {
        ...selectionMouseInit(type, clientX, clientY),
        view: window,
      }));
    },

    clearSelection: () => t.clearSelection(),
  };
}

function bindTouch(t: Terminal, fit: FitAddon): void {
  const el = $('terminal');
  const target = t.element ?? el;
  let fontAtPinchStart = t.options.fontSize ?? 13;

  const mouseInit = (x: number, y: number, extra: MouseEventInit = {}): MouseEventInit => ({
    clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, ...extra,
  });

  /**
   * px บนจอ → เซลล์ในบัฟเฟอร์ คืน null เมื่อยังวัดขนาดไม่ได้ (ยังไม่วาดเฟรมแรก)
   *
   * เลขชุดเดียวกับที่ text-selection.ts ใช้ ต้องอ่าน rect สดทุกครั้งเพราะแถบปุ่มที่
   * กางออกและคีย์บอร์ดที่โผล่ขึ้นมาย้ายตำแหน่งจอได้
   */
  const cellAt = (clientX: number, clientY: number): { line: number; column: number } | null => {
    if (!linkPort) return null;
    const { cellWidth, cellHeight, left, top } = linkPort.screenMetrics();
    if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
    const column = Math.min(linkPort.columns - 1, Math.max(0, Math.floor((clientX - left) / cellWidth)));
    const row = Math.min(linkPort.rows - 1, Math.max(0, Math.floor((clientY - top) / cellHeight)));
    return { line: linkPort.viewportTop() + row, column };
  };

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
          // แตะ = คลิกซ้ายให้ TUI (เลือก pane ใน herdr) เว้นแต่แตะโดนลิงก์
          //
          // xterm อาจโฟกัส textarea ของตัวเองระหว่าง synthetic click แต่
          // inputMode="none" ของ physical mode กัน IME ไม่ให้เด้งกลับมาแล้ว
          // การเปิดลิงก์ภายนอกยังอาจปล่อย terminal focus ได้ตามปกติ

          // mousemove สังเคราะห์คือตัว "ถาม" ว่าตรงนี้มีลิงก์ไหม — linkifier ของ
          // xterm ตั้ง _currentLink ใน handler ของ mousemove เท่านั้น ถ้าไม่ยิงนำ
          // ลิงก์จะไม่มีวันถูกพบด้วยการแตะ เพราะ touchstart ถูก preventDefault ไว้
          // แล้วบราวเซอร์ไม่สังเคราะห์ mouse event ให้เลย
          const opened = linkOpener?.handleTap(
            cellAt(g.x, g.y),
            () => {
              target.dispatchEvent(new MouseEvent('mousedown', mouseInit(g.x, g.y, { button: 0, buttons: 1 })));
              target.dispatchEvent(new MouseEvent('mouseup', mouseInit(g.x, g.y, { button: 0, buttons: 0 })));
            },
          ) ?? false;

          if (opened) t.blur();
          return;
        }

        // กดค้างแล้วลาก = กดปุ่มเมาส์ซ้ายค้างแล้วลาก ใช้ย่อ/ขยาย sidebar ของ herdr
        //
        // ต้องตั้ง buttons: 1 บน mousemove ด้วย ไม่ใช่แค่ mousedown — ไม่งั้น xterm
        // เข้ารหัสเป็น "เลื่อนเมาส์เฉยๆ" ไม่ใช่ "ลากทั้งที่กดปุ่มอยู่" แล้ว TUI จะไม่ลาก
        case 'dragStart': {
          // xterm อาจโฟกัส helper textarea ระหว่าง mousedown แต่ physical mode
          // กัน IME ไว้ด้วย inputMode="none" จึงปลอดภัยที่จะคง focus ไว้
          // mouse reporting ยังส่งต่อได้ตามเดิม — listener ของการลากอยู่ที่
          // document และ sendEvent ของ xterm ไม่ได้เช็ค focus เลย
          navigator.vibrate?.(10);   // บอกผู้ใช้ว่าเข้าโหมดลากแล้ว ไม่งั้นเดาไม่ถูก
          target.dispatchEvent(new MouseEvent('mousedown', mouseInit(g.x, g.y, { button: 0, buttons: 1 })));
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

  /**
   * ในโหมดเลือก นิ้วเดียวเป็นของตัวเลือกข้อความ ไม่ใช่ของ recognizer
   *
   * ต้องดักก่อนถึง recognizer ไม่ใช่หลัง เพราะ recognizer จะแปลงเป็น mouse report
   * ส่งให้แอปข้างใน — ผู้ใช้ที่กำลังลากเลือกข้อความจะไปสลับ pane ของ herdr แทน
   * และการกันไว้ตรงนี้ทำให้ท่ากดค้าง 0.4 วิ (ลากเส้นแบ่ง sidebar) ยังอยู่ครบในโหมดปกติ
   *
   * สองนิ้วยังส่งต่อให้ recognizer เพื่อให้บีบซูมปรับขนาดฟอนต์ได้ระหว่างเลือก
   */
  const selectionOwnsTouch = (e: TouchEvent): boolean =>
    (selection?.active() ?? false) && e.touches.length < 2 && e.changedTouches.length > 0;

  const firstTouch = (e: TouchEvent): Touch => e.changedTouches[0]!;

  // จุดล่าสุดที่นิ้วอยู่ระหว่างลากเลือกข้อความ — ใช้ตอน touchcancel เท่านั้น
  // (ระบบท่าทาง เช่น สายเรียกเข้าหรือปาดขอบจอ) ซึ่งไม่มีพิกัดของตัวเองมาให้
  let lastSelectionPoint: { x: number; y: number } | null = null;

  // เมาส์จริง: xterm ส่ง mouse report ให้ herdr ใน handler ของ mousedown ของมันเอง
  // ดักในเฟส capture เพื่อกลืนอีเวนต์ก่อนถึง xterm เมื่อมีลิงก์อยู่ใต้เคอร์เซอร์
  // ให้พฤติกรรมตรงกับการแตะ: คลิกลิงก์ = เปิดลิงก์อย่างเดียว ไม่สลับ pane
  target.addEventListener('mousedown', e => {
    if (!linkOpener?.handleMouseDown(cellAt(e.clientX, e.clientY))) return;
    e.preventDefault();
    e.stopPropagation();
  }, { capture: true });

  el.addEventListener('touchstart', e => {
    e.preventDefault();          // กันเบราว์เซอร์สังเคราะห์ mouse/โฟกัส/ซูมหน้าเว็บเอง
    if (selectionOwnsTouch(e)) {
      const touch = firstTouch(e);
      lastSelectionPoint = { x: touch.clientX, y: touch.clientY };
      selection!.pointerDown(touch.clientX, touch.clientY);
      // blur เสมอ ไม่ใช่แค่ตอนที่คีย์บอร์ดปิดอยู่ก่อน — ต่างจาก tap และ dragStart
      // ที่ตั้งใจคงสถานะเดิมของผู้ใช้ไว้
      //
      // xterm เรียก focus() ใน handler ของ mousedown เสมอ ถ้าปล่อยให้คีย์บอร์ดที่
      // เปิดอยู่ค้างต่อ visualViewport จะหดระหว่างลาก layout ขยับ และ screenMetrics()
      // ที่ใช้แปลง px → คอลัมน์ ก็เปลี่ยนกลางคัน กรอบที่เลือกจึงวิ่งหนีมือ
      t.blur();
      return;
    }
    if (e.touches.length >= 2) fontAtPinchStart = t.options.fontSize ?? 13;
    recognizer.onTouchStart(points(e));
    pump();                      // เริ่มนับเวลากดค้าง
  }, { passive: false });

  el.addEventListener('touchmove', e => {
    e.preventDefault();
    if (selectionOwnsTouch(e)) {
      const touch = firstTouch(e);
      lastSelectionPoint = { x: touch.clientX, y: touch.clientY };
      selection!.pointerMove(touch.clientX, touch.clientY);
      return;
    }
    recognizer.onTouchMove(points(e));
  }, { passive: false });

  el.addEventListener('touchend', e => {
    e.preventDefault();
    if ((selection?.active() ?? false) && e.touches.length === 0 && e.changedTouches.length > 0) {
      const touch = firstTouch(e);
      selection!.pointerUp(touch.clientX, touch.clientY);
      // finish() ใน text-selection.ts ตั้ง block ก่อนเปลี่ยน phase เป็น 'adjusting'
      // onBlockChange จึง sync ตอนที่ state() ยังเป็น 'dragging' อยู่ ต้อง sync ซ้ำที่นี่
      // ไม่งั้นหมุดจะไม่โผล่จนกว่าจะมี PTY output มายิง t.onScroll โดยบังเอิญ
      syncHandles();
      return;
    }
    recognizer.onTouchEnd(points(e));
    pump();                      // ปล่อยให้ momentum ไหลต่อถ้ามี
  }, { passive: false });

  el.addEventListener('touchcancel', e => {
    // ท่าทางของระบบ (สายเรียกเข้า, ปาดขอบจอ) ตัดจบการลากเลือกโดยไม่มี touchend
    // ถ้าไม่จบให้ผ่าน pointerUp ที่นี่ phase จะค้างที่ 'dragging' พร้อม drag ที่ยังไม่
    // null และ overlay ยังซ่อนอยู่ — ผู้ใช้เห็นไฮไลต์ของ xterm ค้างอยู่โดยไม่มีหมุดให้ปรับ
    // เลย แล้วนิ้วถัดไปจะเริ่มกรอบใหม่ทับของเดิมที่เพิ่งลากไปทันที
    // ใช้ lastSelectionPoint (จุดล่าสุดจาก touchstart/touchmove) เพราะ touchcancel
    // ไม่มีพิกัดของตัวเอง — mirror ท่าเดียวกับที่ selection-handles.ts ทำกับ touchcancel
    // ตอนลากหมุด
    if (selectionOwnsTouch(e) && lastSelectionPoint) {
      selection!.pointerUp(lastSelectionPoint.x, lastSelectionPoint.y);
      syncHandles();
    }
    recognizer.onTouchCancel();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  });

  stopGestures = () => {
    recognizer.onTouchCancel();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };
}

/**
 * วางข้อความจากคลิปบอร์ด
 *
 * ผ่าน `term.paste()` โดยตั้งใจ ไม่ใช่ส่งไบต์เอง — xterm จะห่อด้วย bracketed paste
 * ให้ตามโหมดที่แอปข้างในขอไว้ แล้วปล่อยออกทาง onData ซึ่งวิ่งเข้า input-pipeline
 * เส้นทางเดิม ไม่มีเส้นทางไบต์ใหม่เกิดขึ้น
 */
async function doPaste(t: Terminal): Promise<void> {
  // ออกจากโหมดเลือกก่อน ไม่งั้น xterm จะล้าง selection ทิ้งทันทีที่มี user input
  if (selection?.active()) selection.cancel();

  const result = await clipboard.read();
  if (result.ok) { t.paste(result.text); return; }

  showStatus(result.reason === 'denied'
    ? 'ไม่ได้รับอนุญาตให้อ่านคลิปบอร์ด — ใช้ปุ่มวางของคีย์บอร์ดแทน'
    : 'เบราว์เซอร์นี้อ่านคลิปบอร์ดไม่ได้ — ใช้ปุ่มวางของคีย์บอร์ดแทน');
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
    resetInputModifiers();
    // การ reconnect ไม่เปลี่ยน focus mode: คงทั้ง physical/soft/suspended ตามที่ผู้ใช้เลือก
    // session-ready ของ initTerminal เป็นจุดเดียวที่กำหนดโหมดเริ่มต้น
  };

  socket.onmessage = ev => {
    if (ev.data instanceof ArrayBuffer) term!.write(new Uint8Array(ev.data));
  };

  socket.onclose = ev => {
    // handler ของ socket เก่าที่ปิดช้ากว่าตัวใหม่เปิด จะมา null ตัวที่ต่อติดอยู่
    // (เน็ตกระตุกแล้ว reconnect ทับ) อาการคือพิมพ์ไม่ออกทั้งที่จอยังสด
    // เช็คตัวตนก่อนเสมอ แล้วปล่อยผ่านทั้ง handler ไม่ใช่แค่ข้ามบรรทัด ws = null
    if (socket !== ws) return;
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
  if (!term || !fitAddon) return;
  fitAndSendResize(fitAddon, term, ws);
}

async function startSession(): Promise<void> {
  stopped = false;
  loginPage.hidden = true;
  appPage.hidden = false;          // ต้องแสดงก่อน terminal จึงจะมีขนาดจริง

  const created = initTerminal();
  term = created.term;
  fitAddon = created.fit;

  watchViewport(() => {
    created.keybar.onViewportSettled(keyboardVisible());
    sendResize();
    syncKeyboardButton();   // ระบบซ่อน/แสดงคีย์บอร์ดเอง ไม่ยิง focus/blur ให้เรา
  }, frame => {
    // อัปเดตความสูง panel ทุก visualViewport frame เพื่อให้ตาม animation ของ IME
    // แต่ fit/sendResize ยังถูก debounce ใน callback ด้านบนเพียงครั้งเดียว
    created.keybar.onViewportFrame(frame.height);
  });
  window.addEventListener('orientationchange', created.keybar.onOrientationChange);
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
