# Scrutinize — touch gesture design

วันที่ 2026-08-17 · ตรวจ design ที่เสนอในแชท (ยังไม่มีโค้ด)

## 0. คำตอบคำถามของคุณ — herdr หรือ claude-code ที่ scroll?

**คำตอบ: herdr รับก่อนเสมอ แล้วตัดสินใจส่งต่อหรือไม่ ตามที่แอปข้างในขอ**

herdr เป็น TUI ชั้นนอกที่เปิด mouse tracking ไว้ตลอด (`?1000h ?1002h ?1003h` —
จับได้จาก session จริง) ทุก wheel event จึงถึง herdr ก่อน จากนั้น herdr เลือก 1 ใน 3 ทาง
ตามสถานะของ **pane ที่โฟกัสอยู่**:

```rust
// ~/development/herdr/src/app/input/mouse.rs:1811-1818
if input_state.mouse_protocol_mode.reporting_enabled() {
    WheelRouting::MouseReport        // claude-code ขอ mouse → ส่งต่อ
} else if input_state.alternate_screen && input_state.mouse_alternate_scroll {
    WheelRouting::AlternateScroll    // ส่งปุ่ม ↑/↓ แทน
} else {
    WheelRouting::HostScroll         // herdr scroll scrollback ของตัวเอง
}
```

พฤติกรรมจริงของแต่ละทาง (`mouse.rs:1705-1729`):

| routing | เกิดเมื่อ | ใครเลื่อน |
|---|---|---|
| `MouseReport` | claude-code เปิด mouse reporting เอง | **claude-code** — herdr เข้ารหัสใหม่แล้ว `try_send_bytes` ลง PTY ของ pane |
| `AlternateScroll` | อยู่ alt-screen + โหมด 1007 (เช่น `less`, `vim`) | **แอปข้างใน** ผ่านปุ่ม ↑/↓ ที่ herdr สังเคราะห์ให้ |
| `HostScroll` | shell เปล่า ไม่มีใครขอ mouse | **herdr** เลื่อน scrollback ของ pane นั้น |

**ผลต่อ design ของเรา: เราไม่ต้องสนใจเลยว่าใครเลื่อน** หน้าที่ของชั้นเว็บคือส่ง wheel
event ที่มีพิกัด cell ถูกต้องเข้าไปให้ herdr เท่านั้น herdr จัดการ routing เอง และมันยัง
routing ต่อ pane ด้วย — เลื่อนใน sidebar กับเลื่อนใน pane จึงแยกกันอัตโนมัติเพราะ
พิกัดต่างกัน

---

## 1. Intent

**เป้าหมายหนึ่งประโยค**: ให้ touch บนมือถือสั่ง TUI ที่เปิด mouse tracking ได้ —
เลื่อนเนื้อหา, ลากเส้นแบ่ง sidebar, และปรับขนาดฟอนต์

### Simpler-alternative pass (บังคับ)

**ทำน้อยกว่านี้ได้ 90% ของคุณค่า**: ส่วนที่คุณใช้ทุกวันคือ *scroll* ซึ่งไม่ต้องใช้
state machine, ไม่ต้อง long-press, ไม่ต้องแยกโหมดอะไรเลย — แค่ `touchmove` → สร้าง
`WheelEvent` → dispatch จบ ประมาณ 30 บรรทัด

ส่วน drag-to-resize คืออีก 10% ที่กินความซับซ้อนเกือบทั้งหมด (long-press timer,
เกณฑ์ระยะ, การสั่น, การสลับโหมดกลางคัน, การจัดการนิ้วที่สอง)

**ข้อเสนอ**: แยกเป็นสองก้อน ก้อนแรก scroll + pinch (ใช้ได้จริงวันนี้) ก้อนสอง drag
ตัดสินใจหลังได้ลองก้อนแรกบนมือถือแล้ว — ไม่ใช่เพราะ drag ไม่ดี แต่เพราะ**สมมติฐาน
ที่เสี่ยงที่สุดของ design นี้อยู่ในก้อนแรกทั้งหมด** (ดู Blocker A) รู้ผลก่อนแล้วค่อย
ลงทุนกับก้อนสอง

---

## 2 & 3. Trace + Verify

design อ้าง 4 อย่าง ไล่ทีละอัน

| # | Claim | ผล |
|---|---|---|
| A | "แตะ = คลิก ไม่เปิดคีย์บอร์ด, ปุ่ม `⌨` เปิดคีย์บอร์ดแทน" | ⚠️ **สมมติฐานที่ยังไม่พิสูจน์ และเสี่ยงที่สุด** — Blocker A |
| B | "แยกพฤติกรรมตาม `term.modes.mouseTrackingMode`" | ❌ **ไม่จำเป็นและ branch หนึ่งผิด** — Blocker B |
| C | "สังเคราะห์ MouseEvent แล้ว xterm เข้ารหัสให้" | ✅ ยืนยันแล้ว |
| D | "กดค้างแล้วลาก = ลากเส้นแบ่ง sidebar" | ⚠️ ทำงานได้ แต่จะมีอาการกระโดดที่ต้องรู้ล่วงหน้า — Major D |

---

## Blocker A — ปุ่ม `⌨` เปิดคีย์บอร์ด Android ได้จริงหรือยังไม่รู้

**Finding**: design ทั้งหมดวางอยู่บนสมมติฐานว่า `term.focus()` ที่เรียกจาก click
handler ของปุ่มจะเปิดคีย์บอร์ดบน Android Chrome ได้ — **ยังไม่มีใครพิสูจน์**

**Evidence (trace)**:
```
แตะปุ่ม ⌨
  → keybar.ts: pointerdown → preventDefault()   ← กัน focus ย้าย (โค้ดที่มีอยู่)
  → click handler → term.focus()
  → xterm โฟกัส hidden textarea
  → Android เปิดคีย์บอร์ด?   ← ตรงนี้คือสิ่งที่ไม่รู้
```
Android Chrome เปิด soft keyboard เมื่อ element ได้ focus **ภายใต้ user activation**
เท่านั้น กรณีนี้อยู่ใน click handler จึงน่าจะผ่าน แต่ `preventDefault()` ใน
`pointerdown` ของปุ่มนั้นมีไว้เพื่อ**กันไม่ให้ focus ขยับ**โดยเฉพาะ — เราจึงกำลังสู้กับ
กลไกเดียวกันที่เราตั้งใจใส่ไว้เอง และพฤติกรรมนี้ต่างกันระหว่างเวอร์ชันของ Chrome

**Why it matters**: ถ้าเปิดไม่ได้ **พิมพ์อะไรไม่ได้เลยทั้งแอป** ไม่ใช่แค่ฟีเจอร์ใหม่พัง
แต่ของเดิมที่ใช้อยู่ก็พังไปด้วย เพราะ design นี้เอา "แตะเพื่อโฟกัส" ออกไปแล้ว

**Suggested change**: พิสูจน์ข้อนี้ **ก่อน**เขียนอย่างอื่นทั้งหมด — หน้าเทสเล็กๆ
หน้าเดียวที่มีปุ่มกับ textarea แล้วเปิดบนมือถือจริง ใช้เวลา 10 นาที
และไม่ว่าผลเป็นอย่างไร ให้เก็บทางถอย: **แตะสองครั้ง (double-tap) = เปิดคีย์บอร์ด**
เป็น fallback ที่ไม่ชนกับ "แตะครั้งเดียว = คลิก" และไม่พึ่ง `focus()` แบบ programmatic

---

## Blocker B — การแยก branch ตาม `mouseTrackingMode` ไม่จำเป็น และ branch ที่สองผิด

**Finding**: design มีตาราง 2 คอลัมน์ (tracking เปิด / ปิด) โดย branch "ปิด" ให้เรียก
`term.scrollLines()` — **ทั้งการแยก branch และตัวโค้ดใน branch นั้นไม่ถูก**

**Evidence 1 — ไม่ต้องแยก** `@xterm/xterm@6.0.0` ปิด wheel handling ของ Viewport
ให้อัตโนมัติเมื่อ protocol ต้องการ wheel:
```ts
// src/browser/Viewport.ts:65-70
// Don't handle mouse wheel if wheel events are supported by the current mouse protocol
coreMouseService.onProtocolChange(type => {
  this._scrollableElement.updateOptions({
    handleMouseWheel: !(type & CoreMouseEventType.WHEEL)
  });
});
```
dispatch `WheelEvent` ตัวเดียวจึงถูกต้องทั้งสองกรณีโดยไม่ต้องเช็คอะไรเลย — tracking
เปิดก็ไปเป็น mouse report, ปิดก็ไป scroll viewport ของ xterm

**Evidence 2 — branch "ปิด" ผิดในทางปฏิบัติ** herdr รันใน alternate screen
(`\x1b[?1049h` จับได้จาก session จริง) ซึ่ง**ไม่มี scrollback ใน xterm เลย**
`term.scrollLines()` จึงไม่ทำอะไรเลย ผู้ใช้จะเห็นเป็น "เลื่อนไม่ได้" ทั้งที่โค้ดทำงานปกติ
— บั๊กประเภทที่หาสาเหตุยากที่สุด

**Suggested change**: ลบการเช็ค `mouseTrackingMode` ออกทั้งหมด ลบ `term.scrollLines()`
ออก เหลือทางเดียว: `touchmove` → `WheelEvent` → dispatch ตารางใน design ยุบจาก
2 คอลัมน์เหลือคอลัมน์เดียว

---

## Major C — `touch-gestures.ts` ที่ออกแบบไว้ใหญ่เกินงานที่เหลือ

**Finding**: หลังตัด Blocker B ออก state machine เหลือหน้าที่แค่ 3 อย่าง: สะสมระยะ
เป็น wheel ticks, จับ long-press, คำนวณ scale ของ pinch — ไม่ใช่ state machine ที่มี
โหมดซับซ้อนอย่างที่ design วาดไว้

**Suggested change**: คงไฟล์แยกไว้ (เทสได้เหมือน `input-pipeline.ts` ซึ่งเป็นแบบที่ดี
ของโปรเจกต์นี้อยู่แล้ว) แต่ให้ interface แคบลงเหลือเท่าที่ใช้จริง:
```ts
export type Gesture =
  | { kind: 'wheel'; ticks: number; x: number; y: number }
  | { kind: 'press'; x: number; y: number }     // long-press ครบเวลา
  | { kind: 'drag'; x: number; y: number }
  | { kind: 'release'; x: number; y: number }
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'zoom'; scale: number };

export function createGestureRecognizer(opts: {
  emit: (g: Gesture) => void;
  now?: () => number;          // inject ได้เพื่อเทส long-press โดยไม่ต้องรอจริง
  longPressMs?: number;
  moveThresholdPx?: number;
  linePx?: number;             // กี่ px ต่อ 1 wheel tick
}): {
  onTouchStart(touches: {id:number;x:number;y:number}[]): void;
  onTouchMove(touches: {id:number;x:number;y:number}[]): void;
  onTouchEnd(touches: {id:number;x:number;y:number}[]): void;
  onTouchCancel(): void;
  tick(): void;                // ให้ผู้เรียกขับ timer เอง — ไม่ผูก setTimeout ในโมดูลบริสุทธิ์
};
```
`now` กับ `tick` ที่ inject ได้คือสิ่งที่ทำให้ long-press เทสได้จริงโดยไม่ต้อง
`await sleep(400)` ในทุกเคส — ถ้าไม่ออกแบบตรงนี้ตั้งแต่แรก เทสจะช้าและ flaky

---

## Major D — ลากเส้นแบ่ง sidebar จะ "กระโดด" ทันทีที่กด และนั่นคือพฤติกรรมของ herdr เอง

**Finding**: herdr ตั้งความกว้าง sidebar ทันทีตอน **mousedown** ไม่ใช่ตอนเริ่มขยับ

**Evidence** — `~/development/herdr/src/app/input/mouse.rs:421-427`:
```rust
if self.on_sidebar_divider(mouse.column, mouse.row) {
    self.drag = Some(DragState { target: DragTarget::SidebarDivider });
    self.set_manual_sidebar_width(mouse.column);   // ← ตั้งค่าทันทีตอนกด
    return None;
}
```

**Why it matters**: บนเมาส์ไม่รู้สึกอะไรเพราะ cursor อยู่บนเส้นแบ่งพอดีอยู่แล้ว แต่บน
มือถือนิ้วหนากว่าเส้นแบ่งมาก กดค้างคลาดไป 2-3 คอลัมน์ → พอครบ 400ms แล้วเราสังเคราะห์
`mousedown` ที่พิกัดนิ้ว → **sidebar กระโดดไปที่ตำแหน่งนิ้วทันทีก่อนจะได้ลาก**
ผู้ใช้จะคิดว่าเป็นบั๊กของเรา

**Suggested change**: ไม่ใช่บั๊กของชั้นเว็บและแก้ที่ชั้นเว็บไม่ได้ (จะแก้ต้องแก้ herdr)
สิ่งที่ทำได้คือ **ลดโอกาสกดพลาด**: ตอน long-press ครบเวลา ให้ snap พิกัด `mousedown`
เข้าหาเส้นแบ่งถ้าอยู่ในระยะ ±1 คอลัมน์ — แต่ชั้นเว็บไม่รู้ว่าเส้นแบ่งอยู่ไหน
ทางที่เหลือคือยอมรับแล้วเขียนไว้ใน README ว่าเป็นพฤติกรรมของ herdr
**อย่างน้อยต้องรู้ล่วงหน้า ไม่ใช่ไปเจอตอนใช้จริงแล้วนึกว่าตัวเองเขียนพลาด**

---

## Major E — herdr ไม่ได้ขอ SGR (1006) บนเทอร์มินัลชั้นนอก → พิกัดตันที่ 223

**Finding**: จาก session จริง herdr ส่ง `?1000h ?1002h ?1003h` แต่ **ไม่มี `?1006h`**
(และ `terminal_modes.rs:5` reset `?1006l` ทิ้งด้วยซ้ำ) แปลว่าใช้การเข้ารหัสพิกัดแบบเดิม
ซึ่งเก็บได้สูงสุด **cols/rows ≤ 223**

**Why it matters**: pinch zoom ทำให้ฟอนต์เล็กลง → จำนวนคอลัมน์เพิ่มขึ้น ถ้าเกิน 223
พิกัดจะ wrap แล้วคลิก/ลากจะไปลงผิดที่แบบเงียบๆ

**Evidence (คำนวณ)**: จอมือถือแนวนอนกว้างสุดราว 900 CSS px ที่ฟอนต์ 8px (ขอบล่างของ
ช่วงที่ design กำหนด) ความกว้างตัวอักษรราว 5px → ~180 คอลัมน์ **ยังปลอดภัย**
แต่ margin เหลือไม่มาก

**Suggested change**: บังคับขอบล่างของ `fontSize` ไว้ที่ 8px ตามที่ design เขียน และ
เพิ่ม guard: ถ้า `term.cols > 200` ไม่ต้องส่ง mouse event (log warn) — 3 บรรทัด กัน
อาการ "คลิกแล้วไปโดนที่อื่น" ที่จะหาสาเหตุไม่เจอเลย

---

## Nit F — เรื่องที่ต้องเขียนไว้ในเทสตั้งแต่แรก

- **นิ้วที่สองมากลางคัน** ระหว่าง scroll อยู่แล้วเอานิ้วที่สองแตะ → ต้องเปลี่ยนเป็น
  pinch โดยไม่ยิง wheel ค้างไว้ และตอนยกนิ้วเหลือหนึ่ง → ต้องไม่กลายเป็น scroll กระโดด
- **`touchcancel`** (สายเข้า, แจ้งเตือน, gesture ของ OS) ต้องล้าง state ทุกอย่าง
  รวมถึงยิง `mouseup` ถ้าค้างอยู่ในโหมดลาก ไม่งั้น herdr จะคิดว่าปุ่มยังกดค้างตลอดกาล
- **`navigator.vibrate`** ไม่มีบน iOS Safari เลย (ถ้าวันหนึ่งเปิดบน iPad) และบน Android
  ต้องอยู่ใน user gesture — ในกรณีนี้อยู่ใน touch handler จึงผ่าน ให้ `?.()` กันพัง
- **1003 (any-event tracking)** herdr ขอ motion ทุกครั้งแม้ไม่กดปุ่ม เราส่งเฉพาะตอนลาก
  → hover highlight ของ herdr จะไม่ทำงาน ซึ่งยอมรับได้บน touch (ไม่มี hover อยู่แล้ว)
  แต่ควรเขียนกำกับว่าเป็นการตัดสินใจ ไม่ใช่ลืม
- **`buttons: 1`** ต้องตั้งใน `mousemove` ที่สังเคราะห์ระหว่างลาก ไม่งั้น
  `CoreBrowserTerminal.ts:617-630` จะอ่านเป็น `CoreMouseButton.NONE` แล้ว herdr จะ
  ไม่ถือว่าเป็น drag

---

## ตรวจแล้วไม่พบปัญหา

- **การสังเคราะห์ MouseEvent ใช้ได้จริง** — `CoreBrowserTerminal.ts:602-640`
  (`bindMouse`) ผูก listener ที่ `this.element` และคำนวณพิกัดจาก `clientX/clientY`
  ผ่าน `getMouseReportCoords` **ไม่มีการเช็ค `isTrusted` ที่ไหนเลย** event สังเคราะห์
  จึงผ่านเหมือน event จริงทุกประการ ข้ออ้างหลักของ design ยืนยันแล้ว
- **การเข้ารหัสเป็นหน้าที่ของ xterm จริง** — มันเลือก encoding ตาม protocol ที่แอปขอ
  ผ่าน `coreMouseService.triggerMouseEvent` เราไม่ต้องเขียน escape sequence เอง
- **`touch-action: none`** บน `#terminal` จำเป็นจริง ไม่งั้นเบราว์เซอร์จะกิน gesture
  ไปทำ scroll/zoom ของหน้าเว็บก่อน
- **ปุ่มลูกศรกับ `input-pipeline.ts` ไม่ถูกกระทบ** — งานนี้แยกจากสาย keyboard input
  ทั้งหมด ไม่มีเหตุต้องแตะไฟล์นั้น

---

## Verdict

**rework แบบเบา** — ทิศทางถูกและ mechanism หลัก (สังเคราะห์ MouseEvent) พิสูจน์แล้วว่า
ใช้ได้จริง แต่ต้องแก้สามอย่างก่อนเขียนโค้ด:

1. **พิสูจน์ Blocker A ก่อนทุกอย่าง** — ถ้าปุ่ม `⌨` เปิดคีย์บอร์ดไม่ได้ design ทั้งก้อน
   ต้องเปลี่ยน และของเดิมที่ใช้อยู่จะพังไปด้วย
2. **ลบการแยก branch ตาม `mouseTrackingMode` ทิ้ง** (Blocker B) — dispatch `WheelEvent`
   ทางเดียวถูกทั้งสองกรณีอยู่แล้ว และ branch ที่สองไม่ทำงานจริงใต้ herdr
3. **แยกส่ง 2 ก้อน** — scroll + pinch ก่อน (คุณค่า 90%, ความเสี่ยงรวมอยู่ที่นี่หมด)
   แล้วค่อย drag
