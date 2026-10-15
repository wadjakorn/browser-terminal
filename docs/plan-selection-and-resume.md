# แผน: ไฮไลต์ตอนลากเลือกไม่ขึ้น + สถานะเพี้ยนหลังกลับจากเบื้องหลัง

> สถานะ: ผ่าน scrutinize 3 รอบ (รอบ 3 โดย reviewer อิสระที่ไม่เห็นบริบทเดิม) — พร้อมให้ตัดสินใจ

## สรุปสั้น

| # | อาการ | สาเหตุ | ความมั่นใจ |
|---|---|---|---|
| A1 | ลากเลือกใน shell เปล่า (ไม่มี mouse reporting) ไม่มีไฮไลต์เลย | `shiftKey: true` ใน `selectionMouseInit()` ทำให้ xterm ไปเข้า `_handleIncrementalClick` แทนการเริ่มเลือก | **ยืนยันแล้ว** ในเบราว์เซอร์ |
| A2 | ลากเลือกใน **herdr** ไม่มีไฮไลต์เลย | mousedown → xterm `focus()` → ส่ง `ESC[I`/`ESC[O` ให้ herdr → herdr ตอบด้วยการ set mouse mode ใหม่ทั้งชุด → xterm `selectionService.disable()` ล้าง selection ทิ้ง | **ยืนยันแล้ว** ดักได้บน WebSocket |
| A3 | เริ่มลากเลือก**บน URL** → เปิดแท็บใหม่ ไม่มีไฮไลต์ | listener `mousedown` เฟส capture ของลิงก์ (`main.ts:709`) ไม่เช็ค `isTrusted` จึงจับ mousedown สังเคราะห์ของโหมดเลือกไปเปิดลิงก์แล้วกลืนทิ้ง | **ยืนยันแล้ว** ในเบราว์เซอร์ |
| A4 | **แตะ**ครั้งเดียวในโหมดเลือก → ส่งลูกศรขวา (`ESC[C`) หลายร้อยตัวเข้า PTY | `altClickMovesCursor` (ค่าเริ่มต้น `true`) + `altKey` ของ event สังเคราะห์ → `_handleMouseUp` ย้าย cursor ด้วยการพิมพ์ลูกศร | **ยืนยันแล้ว** ดักได้บน WebSocket |
| B1 | กลับมาจากสลับแอป/แท็บ แล้วจอไม่ขยับ พิมพ์ไม่ออก | socket ครึ่งตาย (half-open) ยังเป็น `OPEN` → `reconnect.wake()` ไม่ทำอะไรเพราะไม่มี timer ค้าง | กลาง — ช่องโหว่มีจริงในโค้ด แต่ยังไม่มีหลักฐานจากเครื่องจริงว่าเป็นตัวที่เจอ |
| B2 | กลับมาแล้วปุ่ม ⌨ / คีย์บอร์ดไม่ตรงกับจริง แตะจอแล้วคีย์บอร์ดเด้งเอง | focus mode ค้างที่ `soft` (`inputMode="text"`) เพราะ `native-ime-hidden` ถูกยิงจาก visualViewport `resize` เท่านั้น ซึ่งไม่มาถึงตอนหน้าอยู่เบื้องหลัง | กลาง (จากโค้ด) |

## หลักฐาน

ทดลองด้วย server ชั่วคราว (`SHELL_CMD=bash`, พอร์ต 7123) + Playwright จำลอง Android
(viewport 412×800, touch, `navigator.platform = "Linux x86_64"` ซึ่งเข้าสาขา isLinux
ของ xterm เหมือน Android จริง)

### A1 — shell เปล่า

นับ `div` ใต้ `.xterm-selection` ระหว่างลาก:

| สถานการณ์ | ผล |
|---|---|
| shell เปล่า, โค้ดปัจจุบัน | 0 (ไม่มีไฮไลต์) |
| shell เปล่า, ยิง event เดียวกันแต่ `shiftKey: false` | 1 (ไฮไลต์ขึ้น) |
| `printf '\e[?1000h\e[?1006h'` แล้วลาก, โค้ดปัจจุบัน | 1 (ไฮไลต์ขึ้น) |

xterm 6.0.0 `SelectionService.handleMouseDown`:

```js
if (!this._enabled) { if (!this.shouldForceSelection(e)) return; e.stopPropagation() }
...
this._enabled && e.shiftKey ? this._handleIncrementalClick(e)   // ← shell เปล่าตกตรงนี้
  : 1 === e.detail ? this._handleSingleClick(e) : ...
```

`_enabled` เป็นจริงเมื่อ**ไม่มี** mouse reporting และ `_handleIncrementalClick` แค่ขยับ
`selectionEnd` ถ้ามี `selectionStart` อยู่แล้ว — ไม่มี ก็ไม่เกิดอะไรเลย
(ถ้ามี selection เก่าค้างอยู่ จะได้ไฮไลต์ที่เริ่มจากจุดเก่าแทน ซึ่งผิดอีกแบบ)

`shiftKey` ถูกใส่ไว้เพื่อ `shouldForceSelection` ซึ่ง**จำเป็นเฉพาะตอนที่มี mouse reporting**

### A2 — herdr

รัน `herdr --session bcscratch` (session แยก ลบทิ้งแล้ว) ใน terminal ชั่วคราว
ยืนยันว่า `.xterm` มีคลาส `enable-mouse-events` แต่ลากแล้ว `.xterm-selection` ไม่เคย
มีลูกเลยแม้แต่เฟรมเดียว (MutationObserver) ดัก WebSocket ระหว่างลาก:

```
>  "\e[I"                                  ← xterm focus ตอน mousedown (focus reporting 1004)
>  "\e[O"                                  ← ยามใน main.ts:316 blur ทันที
<  "\e[?1006l\e[?1016l…\e[?1000l\e[?9l\e[?1000h\e[?1002h\e[?1003h\e[?1015h\e[?1006h"
                                           ← herdr ตั้ง mouse mode ใหม่ทั้งชุด
```

xterm ผูก `coreMouseService.onProtocolChange` → `selectionService.disable()` ซึ่งเรียก
`clearSelection()` → selection ที่เพิ่งเริ่มหายก่อนเฟรมแรกจะวาด

ทดลองตั้ง `textarea.disabled = true` ก่อนลาก: **ไม่มีไบต์ไหนวิ่งเลย และไฮไลต์ขึ้น** ทั้ง
ระหว่างลากและหลังปล่อย

แยก focus/blur ทดสอบทีละตัว: herdr ตอบ**เฉพาะ** `ESC[I` (focus-in) ส่วน `ESC[O` ไม่ตอบ
— การ blur ตอนเข้าโหมดเลือกจึงไม่ทำให้เกิด race กับการลากครั้งแรก

### A3 — เริ่มลากบน URL

`echo https://example.com/aaaa` แล้วเข้าโหมดเลือก ลากเริ่มที่บรรทัดนั้น: ได้แท็บใหม่
`https://example.com/aaaa` และ `.xterm-selection` ว่าง เพราะ capture listener

```ts
target.addEventListener('mousedown', e => {
  if (!linkOpener?.handleMouseDown(cellAt(e.clientX, e.clientY), e.button)) return;
  e.preventDefault(); e.stopPropagation();
}, { capture: true });
```

คอมเมนต์บอกว่าเป็นของ "เมาส์จริง" แต่ไม่ได้กรอง event สังเคราะห์ จึงโดนทั้ง mousedown
ของโหมดเลือก, `beginHandleDrag()` (จับหมุดที่มุมตรงข้ามอยู่บน URL) และ `dragStart`
(กดค้างบน URL เพื่อลากเส้นแบ่ง sidebar → เปิดลิงก์แทน) การแตะลิงก์มีทางของมันเองอยู่แล้ว
(`linkOpener.handleTap` ใน `case 'tap'`) จึงไม่เสียอะไร

### A4 — แตะในโหมดเลือกพิมพ์ลูกศรเข้า PTY

xterm 6.0.0 `SelectionService._handleMouseUp`:

```js
if (this.selectionText.length <= 1 && t < 500 && e.altKey
    && this._optionsService.rawOptions.altClickMovesCursor) {
  // ... triggerDataEvent(moveToCellSequence(...), true)
```

ทุก event ของโหมดเลือกมี `altKey: true` (เพื่อ column select) การแตะสั้นๆ จึงเข้าเงื่อนไข
ทุกครั้ง ทดลอง: พิมพ์ `echo abcdef` ค้างไว้ที่ prompt แล้วแตะหนึ่งครั้งในโหมดเลือก — ดักได้
`ESC[C` หลายร้อยตัววิ่งออกไป (bash ตอบ BEL กลับมาเป็นพรืด) ใน Claude Code นี่คือการ
กดลูกศรแทนผู้ใช้ และเพราะเป็น user input xterm จึงล้าง selection ทิ้งด้วย

### B — กลับจากเบื้องหลัง

ทางเดียวที่ต่อใหม่ตอนกลับมาคือ `visibilitychange → reconnect.wake()` (`main.ts:1044`)
และ `wake()` ทำงานเฉพาะเมื่อมี timer รออยู่ (`reconnect.ts`, `if (timer === null) return`)
— คือเฉพาะเมื่อ `onclose` ยิงไปแล้ว ถ้า OS ฆ่า TCP เงียบๆ ระหว่างอยู่เบื้องหลัง (Tailscale
บนมือถือหลับ, NAT หมดอายุ) socket จะยังเป็น `OPEN` จนกว่า TCP จะ timeout (หลายนาที)
server ส่ง ping ทุก 25 วิ แต่ไม่ได้เช็ค pong และเบราว์เซอร์ไม่เปิด ping/pong ให้ JS เห็น
ฝั่งหน้าเว็บจึง**ไม่มีทางรู้เลย**ว่าสายตาย

ส่วนคีย์บอร์ด: `native-ime-hidden` ถูกยิงที่เดียวคือ listener `visualViewport.resize`
ใน `initTerminal` (`main.ts:324-339`) ซึ่งใช้ `prevVisible` ที่จำไว้เอง ตอนกลับมา
`watchViewport` วัดใหม่และเรียก `syncKeyboardButton()` (ปุ่มถูกต้อง) แต่**ไม่**แตะ
state machine — `terminalFocusState.mode` ยังเป็น `soft` และ `textarea.inputMode`
ยังเป็น `text` การแตะจอครั้งถัดไปยิง mousedown → xterm `focus()` → IME เด้งขึ้นมาเอง
ทั้งที่ผู้ใช้ไม่ได้กด ⌨ (และ `prevVisible` ที่ค้างเป็น `true` ทำให้รอบถัดไปตัดสินผิดได้อีก)

## สิ่งที่จะทำ

### 1. A1 — ใส่ `shiftKey` เฉพาะตอนที่ต้องบังคับเลือก

- `selectionMouseInit(type, x, y, { forceSelection })` — `shiftKey: forceSelection`
  (`altKey` คงไว้เสมอ เพราะคือตัวเปิด column select และไม่ชนสาขาไหน)
- เพิ่มเมธอด `TerminalPort.mouseReporting(): boolean` (ผูกกับ
  `t.modes.mouseTrackingMode !== 'none'`) แล้วให้ `text-selection.ts` เป็นคนอ่านและส่ง
  `forceSelection` ไปกับ `dispatchMouse` — การตัดสินใจจึงอยู่ในโค้ดที่ port ปลอมเทสได้
  ไม่ซ่อนอยู่ใน `createTerminalPort`
- ข้อจำกัดที่รับได้ (บันทึกใน README): ถ้าแอปข้างในเปิด mouse reporting **กลางการลาก**
  xterm จะล้าง selection ทิ้ง แต่ `finish()` ยังสร้างกรอบจากตำแหน่งนิ้ว — ได้หมุดแต่ไม่มีไฮไลต์
- อัปเดต doc comment ของ `selectionMouseInit()` และ pitfall ใน `README.md` ให้บอกว่า
  `shiftKey` ต้อง**ขึ้นกับ** mouse reporting ไม่ใช่ใส่เสมอ

**เทสต์:** `text-selection.test.ts` — `selectionMouseInit` ได้ `shiftKey` ตาม
`forceSelection` ทั้งสองทาง และ port ปลอมที่ `mouseReporting()` คืน false/true ได้
mousedown ที่ `shiftKey` ตรงกัน

### 2. A2 — ห้าม textarea รับ focus ตลอดโหมดเลือก

- ให้ state machine ใน `keyboard-focus-mode.ts` เป็นเจ้าของ ไม่ใช่โค้ดกระจายใน `main.ts`:
  - `TerminalFocusPort` ได้เมธอดใหม่ `setLocked(locked: boolean)`
    (main.ts ผูกเป็น `t.textarea.disabled = locked`)
  - effect ของ `selection-entered`: `{ type: 'blur', lock: true }` → `applyTerminalFocusEffect`
    blur **ก่อน** แล้วจึง lock (ลำดับนี้ทำให้ focus-out ถูกส่งตามปกติ ซึ่งยืนยันแล้วว่า herdr
    ไม่ตอบ)
  - effect ของ `selection-exited`: focus พร้อม `unlock: true` → unlock เป็น**คำสั่งแรกสุด**
    ของ `applyTerminalFocusEffect` ก่อนทั้งเช็ค `none`/`blur` และก่อนยาม `canFocus()`
    (`keyboard-focus-mode.ts:41`) — ถ้า unlock อยู่หลังยามนั้น ตอนที่มี input อื่นโฟกัสอยู่
    (เช่นแผงตั้งค่า) ยามจะ return ก่อน แล้ว textarea จะ disabled ค้าง**ถาวร** พิมพ์ไม่ได้อีกจน reload
  - `setLocked(false)` ล้าง `t.textarea.value = ''` ก่อนปลด — `onLinuxMouseSelection` ของ
    xterm ใส่ข้อความที่เลือกลง textarea และที่เดียวที่ล้างคือ `_handleTextAreaBlur` ซึ่งไม่มีวัน
    เกิดเมื่อ textarea ไม่เคยได้ focus ถ้าไม่ล้าง IME (Gboard, คีย์บอร์ดไทย) จะเห็นข้อความเก่าเป็น
    surrounding text และ CompositionHelper ที่ diff จาก `textarea.value` จะพิมพ์/ลบเพี้ยน
- textarea ที่ disabled เรียก `focus()` แล้วไม่เกิดอะไร: ไม่มี focus event → xterm
  ไม่ส่ง `ESC[I` → herdr ไม่ตั้ง mouse mode ใหม่ → selection ไม่ถูกล้าง
  และคีย์บอร์ดเด้งไม่ได้ด้วยเหตุผลเดียวกัน
- ลบยาม `t.textarea.addEventListener('focus', () => { if (selection?.active()) t.blur(); })`
  (`main.ts:316`) เพราะซ้ำซ้อนแล้ว — ยามตัวนี้เองคือคนส่ง `ESC[O` ทุกครั้งที่นิ้วขยับ
  → อัปเดต pitfall เรื่อง Linux focus ใน `README.md` ให้ชี้มาที่กลไกใหม่

**เทสต์:** `keyboard-focus-mode.test.ts` — port ปลอมบันทึกลำดับการเรียก:
`selection-entered` = `blur` แล้ว `setLocked(true)`; `selection-exited` =
`setLocked(false)` แล้ว `focus`; **`canFocus: () => false` + `selection-exited` ยังต้อง
`setLocked(false)`**; event อื่นไม่แตะ lock

### 3. A4 — ปิด `altClickMovesCursor`

- `new Terminal({ ..., altClickMovesCursor: false })` ใน `initTerminal` พร้อมคอมเมนต์ว่า
  `altKey` ของเราเป็นธงเปิด column select ไม่ใช่ Alt ของผู้ใช้
- ราคา: ผู้ใช้เดสก์ท็อปเสีย Alt+คลิกย้าย cursor ซึ่งแอปนี้ไม่ได้สัญญาไว้ที่ไหน
- เพิ่ม pitfall ใน README ข้าง `macOptionClickForcesSelection`

**เทสต์:** ไม่มี unit test ที่จับ option ของ `Terminal` ได้ตรงๆ — ดึงชุด option ออกเป็น
ฟังก์ชัน `terminalOptions(fontSize)` แล้วเทสว่า `altClickMovesCursor === false` และ
`macOptionClickForcesSelection === true` (ล็อกทั้งสองค่าที่ห้ามเปลี่ยนไว้ที่เดียว)

### 4. A3 — capture listener ของลิงก์รับเฉพาะเมาส์จริง

- บรรทัดแรกของ listener ที่ `main.ts:709`: `if (!e.isTrusted) return;`
- แก้คอมเมนต์ให้บอกว่าทำไมต้องกรอง: event สังเคราะห์ทุกตัว (โหมดเลือก, หมุด, `dragStart`)
  วิ่งผ่าน listener นี้ด้วย และแก้คอมเมนต์ที่ `main.ts:603-604` ("mousedown สังเคราะห์ยัง
  วิ่งผ่าน listener เฟส capture") ที่จะไม่จริงอีกต่อไป · คงยาม `button !== 0` ใน `links.ts:323`

**เทสต์:** ดึงเงื่อนไขเป็นฟังก์ชันใน `links.ts` เช่น
`shouldInterceptMouseDown(isTrusted, button, url)` แล้วเทส untrusted → false

### 5. B1 — ตรวจว่าสายยังเป็นอยู่จริงทุกครั้งที่กลับมา

- **server** (`server/pty.ts` ใน handler ข้อความ text): `{ t: 'ping', n }` → ตอบ
  `ws.send(JSON.stringify({ t: 'pong', n }))` ไม่มีอะไรอื่น (ไม่แตะ PTY, `n` ต้องเป็นตัวเลข
  จำนวนเต็มเล็กๆ ไม่งั้นเมิน)
- **client** โมดูลใหม่ `web/liveness.ts` (ตรรกะบริสุทธิ์ + timer ฉีดได้ แบบ `reconnect.ts`):
  - `probe(socket)` — ผูกกับ socket ตัวที่ถาม ส่ง ping พร้อม nonce `n` แล้วตั้ง timer 5 วิ
    (ไม่ใช่ 3: วิทยุมือถือ + Tailscale ที่เพิ่งตื่นใช้เวลาเกิน RTT ปกติมาก และการตัดสินผิดว่า
    ตายมีราคา — ได้ PTY ใหม่ ซึ่งคืองานหายสำหรับ `SHELL_CMD` ที่ไม่ใช่ multiplexer)
  - **นับว่าสายดีเฉพาะ `pong` ที่ `n` ตรงกันเท่านั้น** ไม่ใช่ข้อความใดๆ — ตอนกลับมา Chrome
    ส่ง frame ที่บัฟเฟอร์ไว้ก่อน TCP ตายเข้ามาทันที ถ้านับข้อความใดๆ socket ที่ตายแล้วจะผ่าน
  - `cancel()` — เรียกจาก `onclose` ของ socket นั้น
  - หมดเวลา → `onDead(socket)`
- `main.ts`:
  - `socket.onmessage`: บรรทัดแรก `if (socket !== ws) return;` (ตอนนี้ไม่มี identity check
    เหมือน `onclose` — socket ที่ถูกปลดเพราะตัดสินว่าตายแต่จริงๆ แค่ช้า จะยังเขียน output ของ
    PTY เก่าลงจอปนกับ PTY ใหม่หลัง `term.reset()` จนกว่า server จะปิดมันด้วย 4000) ·
    ข้อความ text ส่งให้ liveness ไม่เขียนลงจอ
  - `socket.onclose`: `liveness.cancel()` ก่อนทำอย่างอื่น
  - `onDead(socket)`: **`if (socket !== ws) return;`** ก่อนทุกอย่าง — ถ้า `onclose` จริง
    มาถึงระหว่างรอ 5 วิแล้ว reconnect ไปได้ socket ใหม่ timer เก่าจะไปฆ่า socket ใหม่ที่ดีอยู่
    แล้วสร้าง PTY ที่สอง · จากนั้นปลด (`ws = null`), `socket.close()`, `reconnect.reset()`,
    `connect()` ทันที — server เตะตัวเก่าด้วย 4000 ซึ่งไปตก `onclose` ที่ถูกเมินด้วย identity
    check จึงไม่กลายเป็น "เปิดที่อื่นแล้ว"
  - แสดง toast ชั่วคราว "สายหลุดระหว่างอยู่เบื้องหลัง — ต่อใหม่แล้ว" ทุกครั้งที่ `onDead`
    ทำงาน — บอกผู้ใช้ว่าทำไมจอเพิ่ง reset และเป็นหลักฐานบนเครื่องจริงว่า B1 คือสาเหตุ
- **ทางตันที่สองของ "ไม่รีเฟรช"** (เจอในรอบ 3): socket ปิดไปแล้วตอนหน้าอยู่เบื้องหลัง →
  `onclose` ค้างอยู่ที่ `await checkSession()` (`main.ts:993`) ซึ่ง `fetch` ไม่มี timeout
  (`main.ts:99`) → ตอนกลับมา `ws` เป็น null และ timer เป็น null `reconnect.wake()` จึงไม่ทำ
  อะไรเลย (`reconnect.ts:57`) แก้สองชั้น:
  - `checkSession()`: `fetch('/api/session', { signal: AbortSignal.timeout(4000) })` —
    timeout ตกไปที่ `catch` → `'unreachable'` → schedule ต่อตามเดิม
  - handler ตอนกลับมา: `ws === null && !stopped` → `connect()` ตรงๆ (มี `connecting`
    กันซ้อนอยู่แล้ว) · `ws` เป็น `OPEN` → `liveness.probe(ws)` · อื่นๆ → `reconnect.wake()`
- **deploy server กับ client พร้อมกันเสมอ** — client ใหม่ + server เก่าจะไม่มีใครตอบ
  ping ทุกการกลับมาจะกลายเป็นต่อใหม่ (`dist/` ถูก build จากชุดเดียวกันอยู่แล้ว แต่ต้องรู้ไว้)
- ทางเลือก (ไม่บังคับ): server `terminate()` socket เก่าถ้า `close(4000)` ไม่จบใน ~2 วิ —
  ตอนนี้ socket half-open ใช้เวลาปิด ~30 วิ ระหว่างนั้น herdr มี client สองตัวเกาะอยู่
- `README.md` หัวข้อการต่อใหม่: เพิ่มว่ากลับมาแล้วจะตรวจสายภายใน 5 วิ

**เทสต์:** `liveness.test.ts` — pong `n` ตรง = ไม่ตาย; ข้อความอื่น/pong `n` ผิด = ยังตาย;
ไม่มีอะไร = ตาย; probe ซ้อนไม่ตั้ง timer สองตัว; **`cancel()` (onclose) ระหว่างรอแล้ว timer
ครบ = ไม่เรียก `onDead`** · server: ping → pong พร้อม `n` เดิม, `n` แปลก → เมิน ·
main.ts: `checkSession` timeout → `'unreachable'` (fetch ฉีดได้)

### 6. B2 — ปรับ focus mode ให้ตรงกับคีย์บอร์ดจริงหลังกลับจากเบื้องหลัง

- **listener `vv.resize` เดิมคงการตรวจแบบ edge ไว้** (`prevVisible && !nextVisible`) — ห้าม
  เปลี่ยนเป็นแบบ level ("soft แต่มองไม่เห็น"): ระหว่างที่ IME กำลังเลื่อนขึ้นหลังกด ⌨ mode
  เป็น `soft` แล้วแต่ inset ยังไม่ถึง 120 px การตรวจแบบ level จะยิง `native-ime-hidden`
  ตัดคีย์บอร์ดทิ้งกลางทาง
- เพิ่มการตรวจแบบ level **เฉพาะหลัง resume**: `visibilitychange → visible` / `pageshow`
  ตั้งธง `resumed = true` แล้ว callback `onChange` ของ `watchViewport` (ยิงหลัง viewport
  นิ่ง 100 ms และยิงแน่นอนเพราะ `applyIfVisible` ผูกกับสองอีเวนต์นี้อยู่แล้ว) เป็นคนกินธง:
  1. วัด `keyboardVisible()`
  2. ถ้า mode เป็น `soft` แต่มองไม่เห็น → `dispatchTerminalFocus('native-ime-hidden')`
  3. ตั้ง `prevVisible` ของ listener `vv.resize` ให้ตรงค่าที่วัดได้ (ไม่งั้นค่าเก่าที่ค้างเป็น
     `true` จะทำให้ resize ครั้งถัดไปตัดสินผิด)
- **ล้างธง `resumed` ทันทีที่ผู้ใช้กด ⌨** (`request-ime-open`/`request-ime-close` ใน
  `dispatchTerminalFocus`) — ไม่งั้นการกด ⌨ ภายใน 100 ms หลังกลับมาจะเจอ race แบบเดียวกับที่
  ห้ามไว้ข้างบน: mode เป็น `soft` แล้วแต่ IME ยังไม่ขึ้น → ถูกตัดทิ้ง
- ทำเฉพาะเครื่องที่ `visualViewport && 'ontouchstart' in window` (เงื่อนไขเดียวกับ
  `main.ts:326`) — บนเดสก์ท็อป `keyboardVisible()` อ่านจาก focus ไม่ใช่ viewport
- `dispatchTerminalFocus` และ `prevVisible` อยู่ใน closure ของ `initTerminal` — เปิดออกมา
  เป็นฟังก์ชันระดับ module ชื่อ `reconcileAfterResume` แบบเดียวกับ `syncKeyboardButton`
- เพิ่มฟังก์ชันบริสุทธิ์ใน `keyboard-focus-mode.ts` เช่น
  `reconcileWithViewport(state, keyboardVisible): TerminalFocusEvent | null` เพื่อให้เทสได้

**เทสต์:** `keyboard-focus-mode.test.ts` — soft + มองไม่เห็น → `native-ime-hidden`,
physical/suspended → null · วงจรธง: แยกเป็นตัวเล็ก `createResumeReconciler()` ที่เทสได้ว่า
resume → settle ยิง, resume → กด ⌨ → settle ไม่ยิง, settle โดยไม่ resume ไม่ยิง

### 7. ตรวจกับเครื่องจริงก่อน merge

- Android Chrome + herdr: ลากเลือกใน pane ซ้าย/ขวา ไฮไลต์ขึ้นระหว่างลาก, คัดลอกได้
- แตะหนึ่งครั้งในโหมดเลือกขณะ Claude Code มีข้อความค้างที่ prompt: cursor ไม่ขยับ
- เริ่มลากบน URL (เช่น ลิงก์ที่ Claude Code พิมพ์ออกมา): ไม่เปิดแท็บ, ไฮไลต์ขึ้น
- กดค้างบน URL แล้วลาก (โหมดปกติ): ไม่เปิดแท็บ / แตะ URL ครั้งเดียว: ยังเปิดลิงก์ได้
- Android Chrome + shell เปล่า (เครื่อง dev): เหมือนกัน
- iPad Safari: ไฮไลต์ขึ้น (สาขา `isMac`) — เป็นสาขาที่ A1 ไม่ควรกระทบ
- สลับแอปไป 2-3 นาทีแล้วกลับ: จออัปเดต/ต่อใหม่ภายใน ~5 วิ ไม่ต้องกดอะไร
- เปิดโหมดเลือก → ลาก → เปิดแผง ⚙ → ปิดโหมดเลือก: พิมพ์ลง terminal ได้ (ยาม `canFocus`)
- พิมพ์ไทยหลังออกจากโหมดเลือก: ไม่มีข้อความที่เลือกไว้โผล่หรือถูกลบเพี้ยน
- เปิดคีย์บอร์ด → สลับแอป → กลับ: ปุ่ม ⌨ ตรงกับจริง แตะจอแล้วคีย์บอร์ด**ไม่**เด้ง

## ทางที่พิจารณาแล้วไม่เลือก (ตอนนี้)

- **วาดไฮไลต์เองบน overlay แทนการขับ selection ของ xterm** — ⚠️ ข้อนี้หนักขึ้นหลัง
  scrutinize รอบ 2: A1-A4 เป็นบั๊ก**สี่ตัวที่มีรากเดียวกัน** คือการยิง mouse event สังเคราะห์
  เข้า xterm ทั้งที่ xterm ตีความ `shiftKey`/`altKey`/focus/listener ของคนอื่นแบบที่เรา
  ไม่ได้ตั้งใจ ถ้าวาดไฮไลต์เองจาก `blockRect()` (มีอยู่แล้วสำหรับหมุด) และไม่ยิงอะไรเข้า xterm
  เลยในโหมดเลือก ทั้งสี่ตัวหายไปเองโดยโครงสร้าง และลบ `selectionMouseInit`,
  ยาม Linux focus, การพึ่ง `macOptionClickForcesSelection` ทิ้งได้
  ยังไม่เลือกตอนนี้เพราะ: (1) ต้องเพิ่ม "กรอบชั่วคราวระหว่างลาก" ที่ตอนนี้ไม่มี (`block` ถูกตั้ง
  ตอน `finish()` เท่านั้น) (2) เป็นการเปลี่ยนสถาปัตยกรรมที่ `AGENTS.md` และ README บันทึกไว้
  (3) แต่ละข้อของแผนนี้แก้ได้ในบรรทัดเดียวและยืนยันในเบราว์เซอร์แล้ว — **บันทึกลง `TODO.md`**
  ถ้าเจอบั๊กตัวที่ห้าในสายเดียวกันให้เปลี่ยนไปทางนี้แทนการปะต่อ
- **ต่อใหม่ทุกครั้งที่กลับมาโดยไม่ตรวจ** — ง่ายกว่า แต่ทุกการสลับแอปจะได้ PTY ใหม่ ซึ่ง
  ทำลายงานของผู้ที่ใช้ `SHELL_CMD` ที่ไม่ใช่ multiplexer
- **กรอง `ESC[I`/`ESC[O` ใน input-pipeline ระหว่างโหมดเลือก** — แก้ A2 ได้เหมือนกัน แต่
  ปล่อยให้ focus/blur สลับกันทุก mousemove ต่อไป และต้องเพิ่มความรู้เรื่องโหมด UI เข้า
  pipeline ซึ่งเป็นเส้นทาง security-critical

## ลำดับ commit

1. `fix: ลากเลือกใน shell เปล่าไม่มีไฮไลต์ — shiftKey ต้องตาม mouse reporting` (A1)
2. `fix: ลากเลือกใน herdr ไม่มีไฮไลต์ — ปิด textarea ตลอดโหมดเลือก` (A2)
3. `fix: แตะในโหมดเลือกไม่พิมพ์ลูกศรเข้า PTY อีก` (A4)
4. `fix: mousedown สังเคราะห์ไม่ไปเปิดลิงก์อีก` (A3)
5. `fix: กลับจากเบื้องหลังแล้วตรวจสายทันที ไม่รอ TCP timeout` (B1)
6. `fix: focus mode ตามคีย์บอร์ดจริงหลังกลับจากเบื้องหลัง` (B2)

ทำใน worktree ใหม่จาก `origin/main` · ทุก commit ต้องผ่าน `pnpm test` และ `pnpm build`

## บันทึก scrutinize

| รอบ | ผู้ตรวจ | สิ่งที่เปลี่ยนในแผน |
|---|---|---|
| 1 | ผู้เขียน + ทดลองในเบราว์เซอร์ | **เพิ่ม A3** (capture listener ของลิงก์กลืน mousedown สังเคราะห์ — ยืนยันแล้ว) · B2 ใช้การตรวจแบบ level เฉพาะหลัง resume (แบบ level ใน `vv.resize` จะตัดคีย์บอร์ดตอนกำลังเด้ง) · B1 ลดความมั่นใจ, timeout 3→5 วิ, เพิ่ม toast เป็นหลักฐาน · ย้าย lock เข้า state machine · ยืนยันว่า herdr ตอบเฉพาะ focus-in |
| 2 | ผู้เขียน + ทดลองในเบราว์เซอร์ | **เพิ่ม A4** (แตะในโหมดเลือกยิงลูกศรขวาหลายร้อยตัวเข้า PTY — ยืนยันแล้ว) · ยกระดับทางเลือก "วาดไฮไลต์เอง" เป็นข้อเสนอใน TODO เพราะบั๊กสี่ตัวมีรากเดียวกัน |
| 3 | reviewer อิสระ (ไม่เห็นบริบทเดิม) | unlock ต้องมาก่อนยาม `canFocus` (ไม่งั้น textarea disabled ถาวร) · ล้าง `textarea.value` ตอน unlock · liveness ผูกกับ socket + nonce + `onmessage` identity check · ทางตันที่สอง: `checkSession` ไม่มี timeout · ล้างธง resume เมื่อกด ⌨ · เทสต์ต้องครอบจุดตัดสินใจจริง |
