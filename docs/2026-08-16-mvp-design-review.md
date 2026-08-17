# Scrutinize — browser-console MVP design

วันที่ 2026-08-16 · ตรวจ design ที่เสนอในบทสนทนา (ยังไม่มีโค้ด)

> **รอบที่ 1** อยู่ด้านล่างนี้ · [รอบที่ 2](#รอบที่-2) · [รอบที่ 3](#รอบที่-3)

## 1. Intent

**เป้าหมายหนึ่งประโยค**: ให้เข้าถึง shell ของ `example-host` จาก Chrome บน Android
ได้สะดวกกว่าการใช้ SSH client เพราะมีปุ่ม Esc/Ctrl/ลูกศรที่มือถือไม่มี

### Simpler-alternative pass (บังคับ)

หลังตัด persistence ออกไปให้ herdr แล้ว **เหตุผลที่โปรเจกต์นี้ยังควรมีอยู่เหลือข้อเดียว
คือแถวปุ่มมือถือ** ทุกอย่างที่เหลือ (PTY↔ws, xterm, password login) เป็นของ commodity
ที่ `ttyd` ให้ฟรี

นี่ไม่ใช่ข้อโต้แย้งให้ล้มโปรเจกต์ — แต่มันคือ **ลำดับความสำคัญ**: finding #3 (keybar)
คือหัวใจ ส่วน finding อื่นคืองานที่ต้องไม่พลาดเพื่อให้หัวใจนั้นได้ใช้จริง
ถ้าเขียนไปแล้ว keybar ออกมากลางๆ โปรเจกต์นี้จะแพ้ `ttyd` แบบไม่มีข้อแก้ตัว

---

## 2 & 3. Trace + Verify

Design อ้าง 4 อย่าง ผมไล่ทีละอัน

| # | Claim | ผล |
|---|---|---|
| A | "ws หลุด → auto-reconnect → ใช้งานต่อได้" | ❌ **ไม่จริง** — ดู Blocker 1 |
| B | "PTY ตาย → ปิด ws" | ⚠️ ทิศเดียว — ดู Blocker 2 |
| C | "`keybar.ts` รับแค่ callback `send(bytes)`" | ❌ **implement sticky Ctrl ไม่ได้** — ดู Major 3 |
| D | "bind `100.64.0.1` เพื่อไม่ให้หลุด LAN" | ⚠️ มีทางที่ดีกว่าและฟรี — ดู Major 4 |

---

## Blocker 1 — auto-reconnect หลอกผู้ใช้ ให้ shell คนละตัวโดยเงียบๆ

**Finding**: design ระบุ "PTY หนึ่งตัวต่อ ws หนึ่งเส้น" + "ws หลุด → auto-reconnect
exponential backoff" สองข้อนี้ประกอบกันแล้วขัดแย้งกันเอง

**Evidence (trace)**:
```
เน็ตมือถือสะดุด
  → ws.onclose
  → main.ts backoff 1s → เปิด ws ใหม่
  → server /pty handler → spawn bash ตัวใหม่ (PTY เดิมไม่มีใครอ้างอิงแล้ว)
  → xterm ยังมีข้อความเก่าค้างบนจอ (client-side buffer ไม่ได้ถูกล้าง)
  → ผู้ใช้เห็นจอเดิม + prompt ใหม่ นึกว่า "ต่อติดแล้ว"
  → พิมพ์คำสั่งต่อ → รันใน bash คนละตัว, cwd คนละที่, env คนละชุด
```

**Why it matters**: อาการนี้ไม่ใช่แค่ไม่สะดวก — มันคือ **การรันคำสั่งผิด context โดยที่จอ
ไม่บอกอะไรเลย** เป็นคลาสของบั๊กที่แย่ที่สุด `rm -rf build` ใน cwd ที่คุณคิดว่าใช่ แต่ไม่ใช่

และในบริบทของคุณโดยเฉพาะ: คุณอยู่ใน herdr ตลอด แต่ละครั้งที่เน็ตสะดุดคุณจะหลุดกลับมา
ที่ bash เปล่า ต้องพิมพ์ `herdr` ใหม่บนคีย์บอร์ดมือถือ — **บนเน็ตมือถือที่สะดุดบ่อย นี่จะ
กลายเป็นความรำคาญอันดับหนึ่งของแอป และเป็นสิ่งที่ทำให้คุณเลิกใช้แล้วกลับไปใช้ SSH client**

**Suggested change** — เลือกหนึ่ง:

- **(แนะนำ, ~5 บรรทัด)** เอา `SHELL_CMD` ใน `.env` กลับมา ตั้ง default เป็น `herdr`
  reconnect แล้ว attach กลับ session เดิมอัตโนมัติ ปัญหาหายทั้งหมด นี่คือตัวเลือกที่คุณ
  ปัดไปตอนแรก แต่ตอนนั้นยังไม่เห็นว่ามันแก้ปัญหานี้
- **(อย่างน้อยที่สุด)** ถ้ายังอยากได้ bash เปล่า: ตอน reconnect ต้อง `term.reset()`
  ล้างจอ + พิมพ์เส้นคั่น `── reconnected: new shell ──` ให้ชัดว่าคนละตัว
- **(อย่าทำ)** ปล่อย auto-reconnect ไว้เฉยๆ ตามที่ design เขียนตอนนี้

---

## Blocker 2 — ws ปิดแล้วไม่ฆ่า PTY → process รั่ว

**Finding**: ตาราง error handling ระบุแค่ทิศ *PTY ตาย → ปิด ws* ไม่มีข้อไหนพูดถึง
*ws ปิด → ฆ่า PTY*

**Evidence**: บวกกับ Blocker 1 — ทุกครั้งที่เน็ตสะดุด จะเหลือ `bash` ที่ไม่มี ws ผูกอยู่
1 ตัว ไม่มีใครอ้างอิง ไม่มีใครฆ่า ถ้า process นั้นกำลังรัน build หรือ `htop` อยู่ มันจะ
กิน CPU ต่อไปเงียบๆ นั่งอยู่บนเครื่องจนกว่าจะ reboot

**Why it matters**: มือถือ + เน็ตสะดุด = เกิดบ่อยมาก ไม่ใช่ edge case หนึ่งวันอาจได้
bash ค้าง 20 ตัว

**Suggested change**: ใน `pty.ts` ผูก `ws.on('close', () => pty.kill())` ให้เป็นสัญญาของ
โมดูล และเขียน test ว่าหลัง ws ปิด process ตายจริง (เช็คด้วย `pty.onExit` หรือ
`process.kill(pid, 0)` แล้วต้อง throw ESRCH)

---

## Major 3 — interface ของ `keybar.ts` ที่ออกแบบไว้ implement sticky Ctrl ไม่ได้

**Finding**: design บอกว่า `keybar.ts` "รับแค่ callback `send(bytes)` เทสแยกได้" แต่
sticky Ctrl ต้อง **ดักตัวอักษรถัดไปที่ผู้ใช้พิมพ์** ซึ่ง keybar ที่มีแค่ `send` ขาออก
ไม่มีทางเห็นได้เลย

**Evidence**: ตรวจ typings ของ `@xterm/xterm@6.0.0` จริง —
`typings/xterm.d.ts:943` → `onData: IEvent<string>` (คืน **string** ไม่ใช่ bytes)
และ `:1072` → `attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean)`

flow ที่ต้องเป็นจริง:
```
กด [Ctrl] บน keybar  → ตั้ง flag ctrlPending = true
กด 'a' บนคีย์บอร์ด   → xterm.onData ยิง "a"  ← keybar ต้องอยู่ตรงนี้ ไม่ใช่ปลายทาง
                      → ถ้า ctrlPending: แปลง "a" → 0x01, เคลียร์ flag
                      → ส่งลง ws
```

`keybar` จึงไม่ใช่ปลายทาง แต่เป็น **middleware บนสาย input** สัญญาที่ถูกคือ:

```ts
// keybar.ts — pure, ไม่รู้จัก xterm และ ws เลย
export function createInputPipeline(send: (data: Uint8Array) => void): {
  onTerminalData(data: string): void;   // ต่อจาก term.onData
  onBarKey(key: BarKey): void;          // ต่อจากปุ่มบนแถบ
  mount(el: HTMLElement): void;
}
```
แบบนี้ยัง unit-test ได้เต็มที่: `p.onBarKey("Ctrl"); p.onTerminalData("a")` → คาดหวัง
`send` ถูกเรียกด้วย `Uint8Array([0x01])`

**เพิ่มเติมที่ design ยังไม่ครอบ**: `onData` เป็น string ที่อาจมี non-ASCII (paste,
ภาษาไทย, emoji) ต้อง `new TextEncoder().encode()` ก่อนส่ง อย่าปล่อยให้ ws แปลงเอง
และ sticky Ctrl ต้องใช้ได้เฉพาะกับ ASCII 1 ตัว — กรณี `onData` ยาวกว่า 1 char
(paste) ต้องยกเลิก flag ทิ้ง ไม่ใช่แปลงตัวแรก

---

## Major 4 — HTTPS มีให้ฟรีอยู่แล้วบนเครื่องนี้ ไม่ต้อง bind IP เอง

**Finding**: design จะ bind `100.64.0.1:7000` ตรงๆ บน HTTP เปล่า แต่เครื่องนี้
**เปิด `tailscale serve` ใช้งานอยู่แล้ว**

**Evidence** (รันจริงบนเครื่อง):
```
$ tailscale serve status
https://example-host.tailnet.ts.net (tailnet only)
|-- /   proxy http://127.0.0.1:5174
|-- /sb proxy http://127.0.0.1:54321

$ ss -tlnp | grep 100.64.0.1
100.64.0.1:443    ← tailscaled ฟังอยู่ พร้อม cert จริง
```

**Why it matters** — ได้ 4 อย่างพร้อมกันโดยไม่เขียนโค้ดเพิ่มเลย:
1. **TLS จริง** (cert ของ `*.ts.net`) → รหัสผ่านไม่วิ่ง plaintext, ไม่มี browser
   warning, และ **cookie ตั้ง `Secure` ได้** ซึ่งบน HTTP ตั้งไม่ได้
2. **bind `127.0.0.1` ได้** → ปลอดภัยกว่า hardcode Tailscale IP โดยสิ้นเชิง
   ไม่มีทางหลุด LAN แม้ config ผิด
3. **ไม่ต้องพึ่งลำดับ boot** — ถ้า bind `100.64.0.1` ตรงๆ แล้ว systemd สตาร์ท
   service ก่อน `tailscaled` ยก interface ขึ้น จะได้ `EADDRNOTAVAIL` แล้ว crash
   (แก้ได้ด้วย `Restart=` แต่ทำไมต้องมีปัญหาตั้งแต่แรก)
4. บนมือถือพิมพ์ URL ง่ายกว่า: ชื่อโดเมนแทนตัวเลข IP

**Suggested change**:
- server bind `127.0.0.1:7000` (ตรวจแล้ว พอร์ต 7000 ว่าง)
- `tailscale serve --bg --https=8443 7000` → ได้
  `https://example-host.tailnet.ts.net:8443`
  (ใช้พอร์ตแยก ไม่ชนของเดิม และเลี่ยงเรื่อง base-path ของ WebSocket ใต้ subpath)
- ยืนยันตอน implement ว่า `tailscale serve` proxy WebSocket upgrade ผ่าน — ทดสอบ
  ก่อนเขียน UI ทั้งหมด เป็น 10 นาทีที่คุ้มที่สุดของโปรเจกต์ ถ้าไม่ผ่านค่อยถอยไป bind
  Tailscale IP ตรงตาม design เดิม

---

## Major 5 — ไม่มี build step ใน design เลย

**Finding**: โครงไฟล์มี `web/main.ts`, `web/keybar.ts` (TypeScript) และ
`browser-console.service` แต่ไม่มี bundler, ไม่มี `package.json`, และ service file
ไม่ระบุว่ารันอะไร browser รัน `.ts` ตรงๆ ไม่ได้ และ `@xterm/xterm` ต้องผ่าน bundler
(ตรวจแล้ว: `package.json` มี `main`/`module` แต่ **ไม่มี `exports` field** → ใช้ผ่าน
Vite ได้ปกติ แต่โหลดเป็น native ESM จาก CDN ไม่ได้)

**Suggested change**: เพิ่มลง design ให้ชัด
- `vite` build `web/` → `dist/` ; server เสิร์ฟ `dist/` เป็น static
- `pnpm build && pnpm start` ; service `ExecStart=/usr/bin/node server/dist/index.js`
- `tsx` หรือ `vite-node` สำหรับ dev
- ตรวจแล้ว: `Linger=yes` เปิดอยู่ → systemd **user** service ใช้ได้ ไม่ต้องแตะ root

---

## Medium 6 — ไม่ได้ตั้ง `TERM` → herdr จะเพี้ยน

**Finding**: `pty.spawn` ถ้าไม่ระบุ `env` จะสืบทอด env ของ systemd service ซึ่ง
**ไม่มี `TERM`** (service ไม่มี tty)

**Evidence**: herdr เป็น Rust TUI เต็มรูปแบบ (`~/development/herdr`, มี alternate
screen / สี / mouse) `TERM` ว่างหรือเป็น `dumb` → สีหาย, เส้นกรอบเพี้ยน, key chord
ของ herdr อาจไม่ทำงาน ซึ่งจะดูเหมือนบั๊กของ herdr ทั้งที่เป็นของ proxy ตัวนี้

**Suggested change**: `env: { ...process.env, TERM: 'xterm-256color',
COLORTERM: 'truecolor' }` และเพิ่มเป็น assertion ใน integration test ของ `pty.ts`
(รัน `echo $TERM` แล้ว assert)

---

## Medium 7 — ช่องโหว่ auth ราคาถูก 3 จุดที่ควรอุดตั้งแต่แรก

ผมยอมรับ premise ของคุณว่า "ไม่ต้องห่วง security มาก" และไม่เสนอ 2FA/OIDC อะไรทั้งนั้น
แต่ 3 ข้อนี้รวมกันไม่ถึง 15 บรรทัด และรางวัลของผู้โจมตีคือ **shell เต็มสิทธิ์ user คุณ**

| จุด | ปัญหา | แก้ |
|---|---|---|
| เทียบรหัสผ่าน | `===` รั่ว timing | `crypto.timingSafeEqual` |
| `POST /login` | ไม่มี rate limit → brute force | นับ fail ใน memory, เกิน 10 ครั้ง/นาที ตอบ 429 |
| WS upgrade | ไม่เช็ค `Origin` | เทียบกับ host ที่ config ไว้ ไม่ตรง = 403 |

เรื่อง Origin ไม่ใช่ทฤษฎี: ถ้าคุณเปิดเว็บอื่นบน Chrome เครื่องเดียวกัน หน้าเว็บนั้นเปิด
WebSocket ไปที่ URL นี้ได้ และ cookie ของคุณจะติดไปด้วย → ได้ shell (`SameSite=Strict`
ช่วยได้ในเบราว์เซอร์รุ่นใหม่ แต่ Origin check คือ 3 บรรทัดที่ไม่ต้องพึ่งพฤติกรรมเบราว์เซอร์)

---

## Nit 8 — `node-pty` เป็น native module

`node-pty@1.1.0` install script คือ `node scripts/prebuild.js || node-gyp rebuild`
(ตรวจแล้ว เครื่องนี้มี `g++`/`make`/`python3` ครบ จึง build ได้ถ้า prebuild ไม่มี)
**แต่**: อัปเกรด Node เมื่อไหร่ต้อง `pnpm rebuild` ไม่งั้น service จะพังด้วย
`NODE_MODULE_VERSION mismatch` ที่อ่านไม่รู้เรื่อง — เขียนใส่ README ไว้ 1 บรรทัด

---

## สิ่งที่ผมตรวจแล้วไม่พบปัญหา

- แยก binary frame = ข้อมูล PTY / text frame = control JSON — สะอาด ไม่มี escaping bug
  ตามที่อ้างจริง
- cookie เดินทางไปกับ WebSocket handshake อัตโนมัติ → `HttpOnly` ใช้ได้ ไม่ขัดกับ ws
- ขอบเขต `auth.ts` เป็นฟังก์ชันบริสุทธิ์ เทสได้โดยไม่ต้องมี server — ถูกต้อง
- test plan ของ `pty.ts` (`stty size` ยืนยัน resize) — เป็นการเทสที่ไล่ path จริง
  ไม่ใช่ mock ที่ผ่านแบบหลอกๆ ดี
- พอร์ต 7000 ว่างบนเครื่องนี้ (ที่ใช้อยู่: 22, 3000, 3011, 3012, 5678, 8080, 443)

---

## Verdict

**fix-then-ship** — สถาปัตยกรรมหลักถูกและเล็กพอดี แต่ **Blocker 1 ต้องแก้ก่อนเขียน
โค้ดบรรทัดแรก** เพราะมันตัดสินว่า PTY ผูกกับอะไร (ws / cookie / คำสั่ง attach) ซึ่ง
เปลี่ยนทีหลังแพง

3 อย่างที่ต้องอัปเดตใน design ก่อนไป implementation plan:
1. `SHELL_CMD` default `herdr` + นิยาม reconnect ให้ชัดว่าเกิดอะไรขึ้น (Blocker 1, 2)
2. `keybar.ts` เป็น input **pipeline** ไม่ใช่ปลายทาง (Major 3)
3. bind `127.0.0.1` + `tailscale serve` แทน bind Tailscale IP บน HTTP (Major 4)

---
---

# รอบที่ 2

ตรวจ `2026-08-16-browser-console-design.md` rev 1 · finding รอบแรกแก้ครบทั้ง 8 ข้อแล้ว
รอบนี้เจาะเข้าไปใน **แถวปุ่มมือถือ** ซึ่งรอบแรกยอมรับตามที่เขียนไว้โดยไม่ได้ไล่ของจริง —
และมันคือส่วนที่มีปัญหามากที่สุดของทั้งโปรเจกต์

## Blocker A — ปุ่มลูกศรจะพังใน herdr และ vim

**Finding**: design ให้ `input-pipeline.ts` สร้าง byte เองจาก `onBarKey(key)` แต่ไม่
พูดถึง **application cursor mode (DECCKM)** เลย ปุ่มลูกศรจึงจะส่ง byte ผิดทุกครั้งที่
อยู่ใน TUI

**Evidence** — จาก source ของ `@xterm/xterm@6.0.0` เอง
`src/common/input/Keyboard.ts:113-124`:
```ts
case 37: // left-arrow
  if (modifiers)                  result.key = ESC + '[1;' + (modifiers+1) + 'D';
  else if (applicationCursorMode) result.key = ESC + 'OD';   // ← โหมด TUI
  else                            result.key = ESC + '[D';   // ← โหมดปกติ
```

herdr เป็น full-screen TUI → เปิด DECCKM แน่นอน (vim, htop เช่นกัน) ถ้า keybar
hardcode `\x1b[D` ไว้ กดลูกศรซ้ายใน herdr จะไม่ขยับ pane และใน vim จะแทรกตัวอักษรขยะ

**Why it matters**: ปุ่มลูกศรคือเหตุผลอันดับหนึ่งที่โปรเจกต์นี้มีอยู่ ถ้าลูกศรพังใน TUI
โปรเจกต์นี้ไม่มีคุณค่าอะไรเหลือเลย และเป็นบั๊กที่จะดูเหมือน "herdr มีปัญหา"

**Suggested change**: `term.modes.applicationCursorKeysMode` เป็น public readonly
(ยืนยันแล้วที่ `typings/xterm.d.ts:863, 1911`) ส่ง accessor เข้า pipeline:
```ts
createInputPipeline({ send, getModes: () => term.modes })
```
ยัง unit-test ได้เต็มที่ — inject `getModes` ปลอมทั้งสองโหมดแล้ว assert byte ที่ออก

## Blocker B — กติกา "ยาวเกิน 1 ตัว = paste" ผิด

**Finding**: design เขียนว่า `onTerminalData` ที่ยาวเกิน 1 ตัวอักษร = paste →
ยกเลิก modifier แต่ **ปุ่มลูกศรจากคีย์บอร์ดจริงก็ยาว 3 ตัว** (`ESC [ D`)

**Evidence (trace)**:
```
กด [Ctrl] บนแถบ         → ctrlPending = true
กด ← บนคีย์บอร์ด bluetooth → onTerminalData("\x1b[D")  ยาว 3
  → กติกาปัจจุบัน: "นี่คือ paste" → ยกเลิก Ctrl เงียบๆ ส่งดิบ
  → ได้ลูกศรเปล่า ไม่ใช่ Ctrl+←
```
ผลคือ **Ctrl+ลูกศร สร้างไม่ได้เลย** ทั้งที่เป็น chord พื้นฐานของ multiplexer
(สลับ pane) และของ shell (เลื่อนทีละคำ)

**Suggested change**: อย่าตัดสินด้วยความยาว ให้ตัดสินด้วย **โครงสร้าง**:
- ขึ้นต้นด้วย `\x1b` → เป็น key sequence → ผสม modifier ตามกติกา CSI
  (`ESC[D` + ctrl → `ESC[1;5D`; modifier bit: shift=1, alt=2, ctrl=4, บวก 1)
- ยาว 1 ตัว → ตัวอักษรเดี่ยว → แปลงตามกติกา control code
- ยาวเกิน 1 และไม่ขึ้นต้นด้วย `\x1b` → paste จริง → ยกเลิก modifier

## Major C — rate limit ต่อ IP ไร้ผลหลัง `tailscale serve`

**Finding**: design เขียน "fail เกิน 10 ครั้ง/นาที/**IP** → 429" แต่ server bind
`127.0.0.1` และทุก request มาจาก tailscaled proxy

**Evidence**: `req.socket.remoteAddress` จะเป็น `127.0.0.1` เสมอ ทุก client ทุก
เครื่องนับรวมเป็นถังเดียวกันโดยบังเอิญ — bucket key ไม่มีความหมาย

**Suggested change**: MVP มีรหัสผ่านเดียวและผู้ใช้คนเดียว → **rate limit แบบ global
ไปเลย** ตรงไปตรงมากว่าและได้ผลจริง อย่าใช้ `X-Forwarded-For` (ปลอมได้ และ MVP ไม่ต้อง
แยกผู้ใช้อยู่แล้ว) เขียนกำกับไว้ว่าเป็น global โดยตั้งใจ ไม่ใช่ลืม

## Major D — ไม่ได้ส่งขนาดจอตอน spawn → herdr วาดผิดแล้ว reflow

**Finding**: protocol มี `{"t":"resize"}` แต่ PTY ถูก spawn **ก่อน** ที่ client จะส่ง
resize ครั้งแรก

**Evidence (trace)**:
```
ws เปิด → server spawn PTY ทันที ด้วยขนาด default 80×24
       → herdr เริ่มวาด layout ที่ 80×24
client ส่ง {"t":"resize",cols:52,rows:38}   (จอมือถือ)
       → SIGWINCH → herdr วาดใหม่
```
ผลบนมือถือ: จอกระพริบ/ซ้อนตอนเข้าทุกครั้ง และ TUI บางตัวจัด layout ผิดค้างถ้าได้
SIGWINCH เร็วเกินไปตอนกำลัง init

**Suggested change**: ส่งขนาดมาใน query string ตอนเปิด ws
(`/pty?cols=52&rows=38`) แล้ว spawn ด้วยขนาดนั้นเลย validate เป็นจำนวนเต็ม
ในช่วง 1–1000 ถ้าไม่มีหรือผิดรูปค่อย fallback 80×24

## Major E — ปุ่มบนแถบจะทำให้คีย์บอร์ด Android ปิดทุกครั้งที่กด

**Finding**: design ไม่พูดถึง focus เลย แถวปุ่มเป็น DOM element ที่กดได้ → แตะแล้ว
focus ย้ายออกจาก hidden textarea ของ xterm → Android ปิดคีย์บอร์ด

**Why it matters**: flow ปกติคือ `[Ctrl]` แล้วตามด้วย `c` — แต่พอกด `[Ctrl]`
คีย์บอร์ดปิด ยังไม่ทันพิมพ์ `c` ต้องแตะจอเปิดคีย์บอร์ดใหม่ ซึ่งอาจล้าง modifier อีก
**ฟีเจอร์หลักของแอปใช้ไม่ได้เลยจากบั๊กบรรทัดเดียว**

**Suggested change**: ทุกปุ่มบนแถบต้อง `preventDefault()` ใน `pointerdown`
(ไม่ใช่ `click`) เพื่อไม่ให้ focus ย้าย แล้วค่อยทำงานใน `click` เขียนเป็น manual
test case: "กด Ctrl แล้วคีย์บอร์ดต้องไม่ปิด"

## Major F — "ยึดอยู่เหนือคีย์บอร์ด" คือส่วนที่ยากที่สุด แต่ได้บรรทัดเดียว

**Finding**: บน Android Chrome คีย์บอร์ดที่โผล่ขึ้นมา**ไม่**ทำให้ layout viewport
หดตาม `position: fixed; bottom: 0` จะไปอยู่ใต้คีย์บอร์ด มองไม่เห็น

**Suggested change**: ต้องใช้ `window.visualViewport` — ฟัง `resize` + `scroll`
แล้วจัดตำแหน่งแถบเอง, ใช้ `100dvh` ไม่ใช่ `100vh`, และเรียก `fitAddon.fit()` ทุกครั้ง
ที่ visualViewport เปลี่ยน (พร้อม debounce) แล้วส่ง resize ลง ws
ต้องเขียนไว้ใน design ให้เป็นงานชิ้นหนึ่ง ไม่ใช่รายละเอียด CSS

## Nit G — `term.reset()` ลบ scrollback ด้วย

ถ้า `SHELL_CMD=bash` การ reset ตอน reconnect จะลบประวัติที่เลื่อนดูได้ทั้งหมด
กับ `herdr` ไม่เป็นไร (herdr ถือ scrollback เอง) — เขียนกำกับว่าเป็น trade-off
ที่ยอมรับเพราะ default คือ herdr

## ตรวจแล้วไม่พบปัญหา (รอบนี้)

- lifecycle PTY สองทาง (ws ปิด → kill, PTY exit → close) — ปิดช่องรั่วของรอบแรกจริง
- เหตุผลที่ `tailscale serve` ทำให้ฆ่า PTY ได้อย่างปลอดภัย (herdr server อยู่นอก PTY)
  — ไล่แล้วถูกต้อง
- `Secure` cookie + dev บน `http://localhost` — Chrome ถือว่า localhost เป็น
  trustworthy origin จึงไม่พัง
- แผน test ของ `pty.ts` (assert `process.kill(pid,0)` throw ESRCH) — เทส path จริง

## Verdict รอบ 2

**fix-then-ship** — Blocker A และ B อยู่ในโค้ดชิ้นเดียวกัน (`input-pipeline.ts`)
ซึ่งเป็นชิ้นที่โปรเจกต์นี้มีอยู่เพื่อมัน ทั้งคู่แก้ได้ด้วยการนิยาม pipeline ให้รู้จัก
mode และตัดสิน input ด้วยโครงสร้างแทนความยาว

---
---

# รอบที่ 3

ตรวจ rev 2 · finding รอบ 2 แก้ครบทั้ง 7 ข้อ รอบนี้เน้น **ไล่ sequence จริงตอน
connect** และ **ข้อที่ design ยังทิ้งไว้เป็นคำถาม**

## ✅ พิสูจน์แล้ว — `tailscale serve` proxy WebSocket ผ่านครบ

design rev 2 ทิ้งข้อนี้ไว้เป็น "ต้องพิสูจน์เป็นงานแรกสุด" พร้อม fallback plan
ผมทดสอบของจริงบนเครื่องแล้ว **ผ่าน** — ตัด branch นั้นออกได้เลย

```
$ tailscale serve --https=8443 --bg http://127.0.0.1:9999
https://example-host.tailnet.ts.net:8443/

$ node wstest.mjs            # ws server ที่ 127.0.0.1:9999, client ยิงผ่าน wss:…:8443
SERVER: got conn, origin= https://example-host.tailnet.ts.net:8443  cookie= sid=abc
CLIENT: open OK
CLIENT: got echo:hello
```

ยืนยันพร้อมกัน 4 อย่าง: upgrade ผ่าน · **query string ผ่าน** (จำเป็นสำหรับ
`?cols=&rows=`) · **`Origin` header มาถึงไม่ถูกแก้** (จำเป็นสำหรับ guard) ·
**`Cookie` มาถึงครบ** (จำเป็นสำหรับ auth) · พอร์ต 8443 เป็นพอร์ตที่ `tailscale serve`
รับ (รับเฉพาะ 443 / 8443 / 10000)

และยืนยัน finding รอบ 2 ข้อ C ซ้ำ: server เห็น connection มาจาก loopback ทั้งหมด
→ rate limit ต่อ IP ไร้ความหมายจริง

**Suggested change**: ลบ blockquote "ต้องพิสูจน์…" กับ fallback ทิ้ง แล้วเขียนแทนว่า
ยืนยันแล้ว พร้อมพอร์ตที่ใช้ได้ — ไม่งั้นคนอ่าน plan จะไปเสียเวลาทำซ้ำ

---

## Major H — ไม่มีอะไรบังคับ "session เดียว" ตามที่ non-goal อ้าง

**Finding**: design ประกาศ non-goal ว่า "หลาย session / หลายแท็บ" แต่ไม่มีโค้ดหรือกฎ
ไหนบังคับเลย — `WS /pty` รับ connection กี่เส้นก็ได้

**Evidence (trace)**:
```
เปิดแท็บบน desktop ค้างไว้  → ws#1 → PTY#1 → herdr client #1
หยิบมือถือขึ้นมาเปิด         → ws#2 → PTY#2 → herdr client #2  (cookie เดียวกัน ผ่าน)
```
ได้ herdr client 2 ตัว attach session เดียวกัน สองจอขนาดต่างกัน → herdr ต้องเลือก
ขนาดหนึ่ง อีกจอเพี้ยน และแท็บ desktop ที่ลืมปิดจะแย่ง resize กับมือถือไปมาไม่จบ

**Why it matters**: อาการนี้จะโผล่ตอนใช้จริงวันแรก และจะดูเหมือน "จอเพี้ยนสุ่มๆ"
ซึ่งเป็นบั๊กที่หาสาเหตุยากที่สุดประเภทหนึ่ง

**Suggested change**: ทำให้ non-goal เป็นกฎที่บังคับจริง — เก็บ ws ที่ active ไว้ตัวเดียว
พอมี connection ใหม่เข้ามา **เตะตัวเก่าออก** (`ws.close(4000,'superseded')`) แล้วให้
ฝั่ง client ที่ถูกเตะแสดง "เปิดที่อื่นแล้ว" และ**ไม่ reconnect** (แยกจาก code ปกติ)
พฤติกรรมนี้ถูกต้องกับ use case ด้วย: หยิบมือถือขึ้นมา = อยากใช้ที่มือถือ

## Major I — ลำดับตอน connect ยังไม่ได้ระบุ และมันสลับกันไม่ได้

**Finding**: rev 2 เพิ่ม `?cols=&rows=` ตอนเปิด ws (แก้ finding D ถูกแล้ว) แต่การจะรู้
`cols/rows` ต้อง `fitAddon.fit()` ก่อน ซึ่งต้องการให้ terminal `open()` ลง DOM แล้ว
design ไม่ได้เขียนลำดับนี้ไว้ ทำผิดลำดับจะได้ค่า default 80×24 กลับมาโดยไม่ error

**Evidence**: `fit()` คำนวณจากขนาด element จริง ถ้าเรียกก่อน `term.open(el)` หรือก่อนที่
element จะมีขนาด (เช่น ยังซ่อนอยู่หลังหน้า login) จะได้ค่าผิดแบบเงียบๆ

**Suggested change**: เขียนลำดับบังคับลง design
```
1. ซ่อนหน้า login / แสดง container ให้มีขนาดจริงก่อน
2. term.open(container)
3. รอ visualViewport settle 1 เฟรม (requestAnimationFrame)
4. fitAddon.fit()
5. อ่าน term.cols / term.rows
6. เปิด ws พร้อม ?cols=&rows=
```
ลำดับเดียวกันนี้ใช้ซ้ำตอน reconnect (fit ใหม่ก่อนเปิด ws เพราะจออาจหมุนไปแล้ว)

## Major J — design ไม่มีรายการ dependency เลย

**Finding**: ตัว design อ้างถึง `fitAddon` แต่ไม่มีที่ไหนบอกว่าใช้ `@xterm/addon-fit`
และไม่มีส่วน dependency ทั้งเอกสาร — plan ที่ generate จาก design นี้จะเดาเวอร์ชันเอง

**Suggested change**: ใส่ตารางเวอร์ชันที่ตรวจแล้ว
`node-pty@1.1.0` · `@xterm/xterm@6.0.0` · `@xterm/addon-fit@0.11.0` · `ws@8.21.3` ·
`vite@8.2.1` · `vitest` · `tsx`
และตัดสินใจให้ชัดว่า **ไม่ใช้** `@xterm/addon-attach` (มันเขียน `onData` ลง ws ตรงๆ
ซึ่งจะข้าม `input-pipeline` ทั้งก้อน — ใช้แล้วปุ่มมือถือพังทันที) กับ
`@xterm/addon-webgl` (YAGNI สำหรับ MVP บนมือถือ)

## Medium K — `onBarKey` ยังนิยามไม่ครบ

design ระบุปุ่มบนแถบ `Esc Tab Ctrl Alt ↑↓←→ | ~ / - ^C` และนิยามพฤติกรรมของ
`Ctrl`/`Alt`/ลูกศรไว้ครบ แต่ที่เหลือยังลอย:

- `Esc` / `Tab` ตอนที่ `alt` ค้างอยู่ → ต้องได้ `ESC ESC` / `ESC TAB` หรือไม่?
- `|` `~` `/` `-` เป็นตัวอักษรธรรมดา → ต้องผ่านกติกา modifier เดียวกันไหม
  (`Ctrl` + `-` มี control code จริง = `0x1f`)
- `^C` ซ้ำซ้อนกับ `Ctrl`+`c` — เป็น shortcut ที่ **ไม่แตะ** modifier state ที่ค้างอยู่
  หรือล้างมัน?

ไม่ใช่ blocker แต่ถ้าไม่นิยาม คนเขียนจะเดา แล้วเทสจะเขียนตามที่เดา
**Suggested change**: นิยาม `BarKey` เป็น 2 ชนิดให้จบ — `Modifier` (sticky) กับ
`Literal` (ผ่านกติกา modifier เหมือน input จากคีย์บอร์ดทุกประการ) แล้ว `^C` เป็น
`Literal` ที่ส่ง `0x03` ตรงๆ และล้าง modifier

## Medium L — `ALLOWED_ORIGIN` ค่าเดียวจะทำให้ dev ใช้ไม่ได้

dev รัน `vite dev` ที่ `localhost:5173` → `Origin` เป็น `http://localhost:5173`
แต่ prod เป็น `https://example-host.tailnet.ts.net:8443` ค่าเดียวรับได้ทีละแบบ
**Suggested change**: ให้ `ALLOWED_ORIGIN` เป็น list คั่นด้วย comma

## Medium M — ยังไม่ได้ยืนยันว่า herdr detach สะอาดตอนโดน SIGHUP

design ระบุ `pty.kill('SIGHUP')` ตอน ws ปิด และให้เหตุผลว่าปลอดภัยเพราะ herdr server
อยู่นอก PTY — เหตุผลถูก แต่ **ยังไม่ได้ทดสอบ** ว่า herdr client ปล่อย state ฝั่ง
server เรียบร้อยหรือทิ้ง client ค้างไว้ให้ server คิดว่ายัง attach อยู่

ถ้าค้าง อาการจะเป็น "reconnect แล้วขนาดจอเพี้ยน" หรือ "herdr คิดว่ามี 2 client"
ซึ่งกลืนกับ Major H จนแยกไม่ออก
**Suggested change**: ใส่เป็น task ยืนยันในแผน (5 นาที) — kill PTY แล้วเช็ค
`herdr status server` / `herdr session <name>` ว่า client count ลดจริง
ถ้าไม่ลด ให้ส่ง detach command ก่อน kill

## Nit N — ไม่มี logout

cookie อายุ 30 วันแต่ยกเลิกไม่ได้เลยนอกจากเปลี่ยน `SESSION_SECRET` (ซึ่งจะเตะทุก
device พร้อมกัน) — `POST /logout` ที่ล้าง cookie คือ 3 บรรทัด ใส่ไปเถอะ

## ตรวจแล้วไม่พบปัญหา (รอบนี้)

- กติกา CSI modifier: rev 2 เขียนว่า "มี modifier → `ESC[1;<n>D`" **แม้อยู่ใน
  application cursor mode** — ตรงกับที่ xterm ทำเองที่ `Keyboard.ts:117-121`
  (เช็ค `modifiers` ก่อน `applicationCursorMode`) ถูกต้อง
- ค่า `<n>` = 1 + shift1/alt2/ctrl4 → ctrl = 5 — ตรงมาตรฐาน
- การจำแนก input ด้วยโครงสร้าง (ESC-prefix / 1 ตัว / paste) — ปิดช่องของรอบ 2 ได้จริง
- `preventDefault` ใน `pointerdown` ไม่ใช่ `click` — ถูกต้อง `click` มาหลัง focus ย้ายแล้ว
- ตารางเทส `input-pipeline.ts` ครอบทุก branch ที่ระบุในกติกา รวมเคส app-cursor-mode
  และ ctrl+ลูกศร ที่เป็น blocker รอบที่แล้ว

## Verdict รอบ 3

**ship the plan** — ไม่เหลือ blocker แล้ว Major H (บังคับ session เดียว) กับ I
(ลำดับตอน connect) เป็นการเขียนกฎที่มีอยู่แล้วให้ชัด ไม่ใช่การรื้อสถาปัตยกรรม
แก้ 4 ข้อ (H, I, J, K) แล้วเขียน implementation plan ได้เลย
