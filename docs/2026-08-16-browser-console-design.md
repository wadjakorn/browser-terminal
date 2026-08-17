# browser-console — MVP design

วันที่ 2026-08-16 · rev 3 (แก้ตาม `2026-08-16-mvp-design-review.md` รอบ 1–3)

## Dependencies (ตรวจเวอร์ชันจริงแล้ว)

| package | version | หมายเหตุ |
|---|---|---|
| `node-pty` | 1.1.0 | native module |
| `@xterm/xterm` | 6.0.0 | |
| `@xterm/addon-fit` | 0.11.0 | |
| `ws` | 8.21.3 | |
| `vite` | 8.2.1 | build `web/` |
| `vitest`, `tsx` | latest | |

**ไม่ใช้โดยตั้งใจ**
- `@xterm/addon-attach` — มันต่อ `onData` เข้า ws ตรงๆ ซึ่ง**ข้าม `input-pipeline`
  ทั้งก้อน** ใช้เมื่อไหร่ปุ่มมือถือพังทันที
- `@xterm/addon-webgl` — YAGNI สำหรับ MVP บนมือถือ

## เป้าหมาย

เข้าถึง shell ของ `example-host` จาก Chrome บน Android ได้สะดวกกว่า SSH client
โดยมีปุ่ม `Esc` / `Ctrl` / ลูกศร ที่คีย์บอร์ดมือถือไม่มี

**คุณค่าเดียวที่โปรเจกต์นี้มีเหนือ `ttyd` คือแถวปุ่มมือถือ** — ทุกอย่างที่เหลือคือ
งานประกอบให้ปุ่มนั้นได้ใช้จริง ถ้าส่วนนี้ออกมากลางๆ ควรเลิกแล้วไปใช้ `ttyd`

## Non-goals (MVP)

หลาย session / หลายแท็บ · scrollback ฝั่ง server · file transfer · multi-user ·
tmux/herdr integration ระดับ API · ปุ่ม macro กำหนดเอง

---

## สถาปัตยกรรม

```
Android Chrome
   │ HTTPS (cert จริงจาก tailnet)
   ▼
tailscaled  100.64.0.1:8443   ← tailscale serve --bg --https=8443 7000
   │ HTTP (loopback เท่านั้น)
   ▼
Node 22  127.0.0.1:7000
   ├── POST /login      password → signed cookie
   ├── GET  /           static จาก web/dist/
   └── WS   /pty        ตรวจ cookie + Origin → spawn PTY
                             │
                             ▼
                        $SHELL_CMD  (default: herdr)
```

### ทำไม `tailscale serve` แทนการ bind Tailscale IP

เครื่องนี้เปิด `tailscale serve` ใช้งานอยู่แล้ว (`100.64.0.1:443` มี listener จริง)
การ bind `127.0.0.1` แล้วให้ tailscaled proxy ให้ ได้ 4 อย่างฟรี:

1. TLS จริง → รหัสผ่านไม่วิ่ง plaintext, cookie ตั้ง `Secure` ได้
2. ไม่มีทางหลุด LAN แม้ config ผิด (loopback อย่างเดียว)
3. ไม่ผูกกับลำดับ boot — bind Tailscale IP ตรงๆ เสี่ยง `EADDRNOTAVAIL` ถ้า service
   สตาร์ทก่อน `tailscaled` ยก interface
4. URL เป็นชื่อโดเมน พิมพ์บนมือถือง่ายกว่าตัวเลข IP

ใช้พอร์ต `8443` แยก ไม่ทับ `/` ที่เดิม proxy ไป `127.0.0.1:5174` และเลี่ยงปัญหา
base-path ของ WebSocket ใต้ subpath

> **✅ พิสูจน์บนเครื่องนี้แล้ว ไม่ต้องทำซ้ำ**: ยิง WebSocket ผ่าน
> `wss://example-host.tailnet.ts.net:8443` ไปยัง ws server ที่ `127.0.0.1`
> — upgrade ผ่าน, **query string ผ่าน**, **`Origin` มาถึงไม่ถูกแก้**,
> **`Cookie` มาถึงครบ** ทั้งหมดที่ design นี้พึ่งพาใช้ได้จริง
> (`tailscale serve` รับเฉพาะพอร์ต 443 / 8443 / 10000 — 8443 ยืนยันแล้ว)

---

## PTY lifecycle — ผูกกับ WebSocket, ให้ herdr ถือ persistence

**กฎเดียว: หนึ่ง WebSocket = หนึ่ง PTY = หนึ่ง `SHELL_CMD` และตายพร้อมกันทั้งสองทาง**

```
ws เปิด   → ตรวจ cookie + Origin → spawn SHELL_CMD ใน PTY
ws ปิด    → pty.kill('SIGHUP')      ← ต้องมี ไม่งั้น process รั่ว
PTY exit → ws.close(1000, reason)
```

นี่ทำงานได้เพราะ **herdr server อยู่นอก PTY นี้** ฆ่า PTY = ฆ่า client ของ herdr
ไม่ใช่ session งานที่ยังรันอยู่ต่อไปตามปกติ

`SHELL_CMD` อ่านจาก `.env` default `herdr` ตั้งเป็น `bash` ได้ถ้าต้องการ shell เปล่า

### บังคับ session เดียว — connection ใหม่เตะตัวเก่า

non-goal "หลาย session" ต้องเป็นกฎที่บังคับจริง ไม่ใช่แค่ความตั้งใจ ไม่งั้น:
แท็บ desktop ที่ลืมปิด + เปิดบนมือถือ = herdr client 2 ตัว attach session เดียวกัน
สองจอคนละขนาด → แย่ง resize กันไปมาไม่จบ ซึ่งจะดูเหมือน "จอเพี้ยนสุ่มๆ"

server เก็บ ws ที่ active ไว้ **ตัวเดียว** connection ใหม่เข้ามา → ปิดตัวเก่าด้วย
`ws.close(4000, 'superseded')` + kill PTY เก่า
client ที่ได้ code `4000` แสดง "เปิดที่อื่นแล้ว" และ **ไม่ reconnect**
(แยกจากการหลุดปกติ) — พฤติกรรมนี้ตรงกับ use case: หยิบมือถือขึ้นมา = อยากใช้ที่มือถือ

> **ต้องยืนยันตอน implement (5 นาที)**: herdr client ปล่อย state ฝั่ง server สะอาด
> ตอนโดน `SIGHUP` หรือไม่ — kill PTY แล้วเช็คว่า client count ของ session ลดจริง
> ถ้าไม่ลด ต้องส่ง detach command ก่อน kill อาการถ้าพลาดคือ "reconnect แล้วจอเพี้ยน"
> ซึ่งกลืนกับปัญหาหลาย session จนแยกไม่ออก

### Reconnect

```
ws.onclose (ไม่ใช่ code 1000)
  → แถบสถานะ "กำลังต่อใหม่…"  (backoff 1→2→4→8s, สูงสุด 8s, พยายามไม่จำกัด)
  → ws เปิดใหม่สำเร็จ
  → term.reset()               ← ล้างจอก่อนเสมอ
  → PTY ใหม่รัน herdr → herdr วาดหน้าจอเต็มจาก session เดิม
```

`term.reset()` จำเป็นเพราะ PTY ใหม่คือ process ใหม่ ไม่รู้ว่าจออยู่ในสภาพไหน
จอเก่าค้างไว้จะทำให้ผู้ใช้เข้าใจผิดว่ายังเป็น shell เดิม

**ถ้า `SHELL_CMD=bash`**: หลัง `term.reset()` เขียนเส้นคั่น
`── reconnected · new shell ──` ก่อน เพื่อไม่ให้เข้าใจผิดว่า cwd/env เดิม
(กับ `herdr` ไม่ต้อง เพราะ session กลับมาเหมือนเดิมจริง)

`term.reset()` ลบ scrollback ของ xterm ด้วย — trade-off ที่ยอมรับได้เพราะ default
คือ herdr ซึ่งถือ scrollback เอง กรณี `SHELL_CMD=bash` จะเสียประวัติที่เลื่อนดูได้

### env ของ PTY

```ts
env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
```
`TERM` จำเป็น: systemd service ไม่มี tty จึงไม่มี `TERM` ใน env และ herdr เป็น Rust
TUI เต็มรูปแบบ — ถ้า `TERM` ว่าง สีหาย เส้นกรอบเพี้ยน key chord อาจไม่ทำงาน
แล้วจะดูเหมือนบั๊กของ herdr ทั้งที่เป็นของ proxy ตัวนี้

---

### ขนาดจอตอน spawn — ลำดับบังคับ

`cols/rows` ต้องรู้ **ก่อน** เปิด ws และการจะรู้ต้อง `fit()` ซึ่งต้องการ element ที่มี
ขนาดจริงแล้ว สลับลำดับจะได้ค่า default 80×24 กลับมาแบบเงียบๆ ไม่มี error:

```
1. ซ่อนหน้า login / แสดง container ให้มีขนาดจริง
2. term.open(container)
3. รอ 1 เฟรม (requestAnimationFrame) ให้ visualViewport settle
4. fitAddon.fit()
5. อ่าน term.cols / term.rows
6. เปิด ws พร้อม ?cols=&rows=
```

ใช้ลำดับเดียวกันซ้ำตอน reconnect — จออาจหมุนไปแล้วระหว่างที่หลุด ต้อง fit ใหม่ก่อน

client ส่งขนาดมาใน query string ตอนเปิด ws: `/pty?cols=52&rows=38`
server validate เป็นจำนวนเต็ม 1–1000 (ไม่มี/ผิดรูป → fallback 80×24) แล้ว spawn
ด้วยขนาดนั้นเลย

ถ้า spawn ที่ 80×24 ก่อนแล้วรอ resize message ตามมา herdr จะวาด layout ที่ขนาดผิด
แล้วโดน SIGWINCH ทันที → จอกระพริบทุกครั้งที่เข้า และ TUI บางตัวจัด layout ค้างผิด
ถ้าได้ SIGWINCH ระหว่าง init

## Wire protocol

WebSocket เส้นเดียว แยกด้วยชนิดของ frame:

| frame | ทิศทาง | ความหมาย |
|---|---|---|
| **binary** | ทั้งสองทาง | ข้อมูล PTY ดิบ (UTF-8 bytes) |
| **text** | client → server | control JSON: `{"t":"resize","cols":80,"rows":24}` |

ไม่มี framing เอง ไม่มี escaping ข้อมูล PTY ไม่ถูก parse เลย

`term.onData` คืน **string** (ตรวจ `@xterm/xterm@6.0.0` typings `xterm.d.ts:943`)
จึงต้อง `new TextEncoder().encode(s)` ก่อนส่ง ไม่ปล่อยให้ ws แปลงเอง

---

## โครงไฟล์

```
browser-console/
├── package.json          pnpm workspace เดียว
├── vite.config.ts        build web/ → web/dist/
├── .env.example
├── docs/
├── server/
│   ├── config.ts         อ่าน+validate .env (ไม่ครบ = ไม่ยอมสตาร์ท)
│   ├── auth.ts           verifyPassword / signCookie / verifyCookie  (pure)
│   ├── ratelimit.ts      นับ login ที่ล้มเหลว                        (pure)
│   ├── pty.ts            ws หนึ่งเส้น ↔ PTY หนึ่งตัว
│   └── index.ts          HTTP + static + upgrade routing
├── web/
│   ├── index.html
│   ├── main.ts           xterm + ws + reconnect
│   ├── input-pipeline.ts สาย input + sticky modifier            (pure)
│   ├── keybar.ts         DOM ของแถวปุ่ม
│   └── style.css
└── browser-console.service
```

**ขอบเขต**: `pty.ts` ไม่รู้จัก auth · `auth.ts`/`ratelimit.ts`/`input-pipeline.ts`
เป็นฟังก์ชันบริสุทธิ์ เทสได้โดยไม่ต้องมี server หรือ DOM

---

## แถวปุ่มมือถือ — หัวใจของโปรเจกต์

แถวเดียวเลื่อนแนวนอน ยึดอยู่เหนือคีย์บอร์ด:

```
Esc  Tab  Ctrl  Alt  ↑ ↓ ← →  |  ~  /  -  ^C
```

### `BarKey` มีสองชนิดเท่านั้น

| ชนิด | ปุ่ม | พฤติกรรม |
|---|---|---|
| `Modifier` | `Ctrl` `Alt` | sticky — กด = ค้าง, กดซ้ำ = ปลด, ไม่ส่ง byte ออกเอง |
| `Literal` | ที่เหลือทั้งหมด | ป้อนเข้า pipeline **เหมือน input จากคีย์บอร์ดทุกประการ** |

`Literal` ผ่านกติกา modifier เดียวกันหมด ไม่มีข้อยกเว้น:
`Esc`→`"\x1b"`, `Tab`→`"\t"`, `←`→`"\x1b[D"`, `|`→`"|"`, `-`→`"-"`
ดังนั้น `Alt`+`Esc` ได้ `ESC ESC` และ `Ctrl`+`-` ได้ `0x1f` โดยอัตโนมัติ ไม่ต้อง
เขียนเคสพิเศษ

ข้อยกเว้นเดียว: `^C` เป็น shortcut ที่ส่ง `0x03` ตรงๆ แล้ว**ล้าง modifier ที่ค้างอยู่**
(มันคือปุ่ม "หยุด" ต้องทำงานเสมอไม่ว่าสถานะจะเป็นอะไร)

### `Ctrl` / `Alt` เป็นปุ่ม sticky

กดแล้วค้าง → key ถัดไปที่พิมพ์ถูกแปลง → ปลด flag เอง (กดซ้ำ = toggle ปลดเอง)

`input-pipeline.ts` ต้องอยู่ **บนสาย input** ไม่ใช่ปลายทาง เพราะต้องเห็น key ถัดไป
และต้องรู้ **โหมดของ terminal** ด้วย:

```ts
export function createInputPipeline(deps: {
  send: (b: Uint8Array) => void;
  getModes: () => { applicationCursorKeysMode: boolean };  // = term.modes
}): {
  onTerminalData(data: string): void;   // ต่อจาก term.onData
  onBarKey(key: BarKey): void;          // ต่อจากปุ่มบนแถบ
  modifierState(): { ctrl: boolean; alt: boolean };  // ให้ UI ไฮไลต์ปุ่ม
}
```

#### จำแนก input ด้วย **โครงสร้าง** ไม่ใช่ความยาว

นี่คือกฎที่สำคัญที่สุดของทั้งโปรเจกต์ ปุ่มลูกศรจากคีย์บอร์ดจริงยิง `onData` ยาว 3 ตัว
(`ESC [ D`) ถ้าใช้ความยาวตัดสิน "paste" ลูกศรจะถูกเข้าใจผิดเป็น paste และ **Ctrl+ลูกศร
จะสร้างไม่ได้เลย** ทั้งที่เป็น chord พื้นฐานของ multiplexer และ shell

| input | จำแนกเป็น | ทำอะไร |
|---|---|---|
| ขึ้นต้นด้วย `\x1b` | key sequence | ผสม modifier ตามกติกา CSI |
| ยาว 1 ตัวอักษร | ตัวอักษรเดี่ยว | แปลงตามกติกา control code |
| ยาวเกิน 1 และไม่ขึ้นต้นด้วย `\x1b` | paste จริง | **ยกเลิก modifier ทั้งหมด** ส่งดิบ |

#### กติกาแปลงตัวอักษรเดี่ยว

- `ctrl` + `a`–`z` / `A`–`Z` → `code & 0x1f` (`a` → `0x01`)
- `ctrl` + `[` `\` `]` `^` `_` `?` → control code ตามมาตรฐาน (`?` → `0x7f`)
- `alt` + ตัวใดก็ได้ → นำหน้าด้วย `ESC` (`0x1b`)
- `ctrl` + `alt` ร่วมกัน: แปลง ctrl ก่อน แล้วเติม `ESC` นำหน้า
- `ctrl` + ตัวที่ไม่มี control code (`1`, `ก`, emoji) → ยกเลิก modifier ส่งดิบ

#### กติกาแปลง key sequence + ปุ่มลูกศรบนแถบ

**ห้าม hardcode byte ของลูกศร** — ต้องอ่าน `applicationCursorKeysMode` ทุกครั้ง:

| สถานการณ์ | byte ที่ต้องส่ง (ตัวอย่าง: ←) |
|---|---|
| ไม่มี modifier, โหมดปกติ | `ESC [ D` |
| ไม่มี modifier, **application cursor mode** | `ESC O D` |
| มี modifier | `ESC [ 1 ; <n> D` |

`<n>` = 1 + (shift 1 · alt 2 · ctrl 4) → ctrl อย่างเดียว = `5`, ctrl+alt = `7`

herdr / vim / htop เป็น full-screen TUI จึงเปิด DECCKM (application cursor mode)
ถ้าส่ง `ESC [ D` ในโหมดนั้น ลูกศรซ้ายจะไม่ขยับ pane ใน herdr และแทรกตัวอักษรขยะใน vim
— และจะดูเหมือน "herdr มีปัญหา" ทั้งที่เป็นบั๊กของ proxy ตัวนี้

> ปุ่มลูกศรคือเหตุผลอันดับหนึ่งที่โปรเจกต์นี้มีอยู่ ถ้าลูกศรพังใน TUI โปรเจกต์นี้ไม่เหลือ
> คุณค่าอะไรเลยเมื่อเทียบกับ `ttyd`

### Focus — ปุ่มต้องไม่ปิดคีย์บอร์ด Android

ปุ่มบนแถบเป็น DOM element ที่กดได้ ถ้าปล่อยตามปกติ การแตะจะย้าย focus ออกจาก hidden
textarea ของ xterm → **Android ปิดคีย์บอร์ดทันที**

flow ปกติคือ `[Ctrl]` แล้วตามด้วย `c` — พอกด `[Ctrl]` แล้วคีย์บอร์ดปิด ยังไม่ทันพิมพ์
`c` เลย ฟีเจอร์หลักของแอปพังจากบั๊กบรรทัดเดียว

**ทุกปุ่มบนแถบต้อง `preventDefault()` ใน `pointerdown`** (ไม่ใช่ `click`) เพื่อกัน
focus ย้าย แล้วค่อยทำงานจริงใน `click`

### Layout — คีย์บอร์ดที่โผล่ขึ้นมาไม่หด viewport

บน Android Chrome คีย์บอร์ดไม่ทำให้ layout viewport หด `position: fixed; bottom: 0`
จะไปอยู่ **ใต้** คีย์บอร์ด มองไม่เห็น นี่เป็นงานชิ้นหนึ่ง ไม่ใช่รายละเอียด CSS:

- ฟัง `window.visualViewport` ทั้ง `resize` และ `scroll` → จัดตำแหน่งแถบเอง
- ใช้ `100dvh` ไม่ใช่ `100vh`
- ทุกครั้งที่ visualViewport เปลี่ยน → `fitAddon.fit()` (debounce ~100ms) แล้วส่ง
  `resize` ลง ws

---

## Auth

`.env`: `CONSOLE_PASSWORD`, `SESSION_SECRET`, `SHELL_CMD`, `PORT`, `ALLOWED_ORIGINS`

`ALLOWED_ORIGINS` เป็น list คั่นด้วย comma — dev รัน `vite dev` ที่
`http://localhost:5173` ส่วน prod เป็น `https://example-host.tailnet.ts.net:8443`
ค่าเดียวรับได้ทีละแบบ ทำให้ dev ใช้ไม่ได้

มี `POST /logout` ที่ล้าง cookie (3 บรรทัด) — ไม่งั้นยกเลิก session ไม่ได้เลยนอกจาก
เปลี่ยน `SESSION_SECRET` ซึ่งเตะทุก device พร้อมกัน

login สำเร็จ → cookie ที่ HMAC-SHA256 sign พร้อม expiry 30 วัน
`HttpOnly; Secure; SameSite=Strict; Path=/`

Cookie เดินทางไปกับ WebSocket handshake อัตโนมัติ จึงใช้ `HttpOnly` ได้

**rate limit เป็น global โดยตั้งใจ ไม่ใช่ลืม**: server bind `127.0.0.1` หลัง
`tailscale serve` ทุก request จึงมาจาก `127.0.0.1` เสมอ — bucket ต่อ IP ไม่มีความหมาย
และ `X-Forwarded-For` ปลอมได้ MVP มีรหัสผ่านเดียวและผู้ใช้คนเดียวอยู่แล้ว global
ตรงไปตรงมากว่าและได้ผลจริง

**สาม guard ที่ราคาถูกแต่จำเป็น** — รางวัลของผู้โจมตีคือ shell เต็มสิทธิ์ user:

| guard | ทำไม |
|---|---|
| `crypto.timingSafeEqual` เทียบรหัสผ่านและ cookie signature | `===` รั่ว timing |
| rate limit `POST /login` — **global** fail เกิน 10 ครั้ง/นาที → 429 | endpoint นี้ไม่ต้อง auth |
| เช็ค `Origin` header ตอน WS upgrade ไม่ตรง = 403 | เว็บอื่นใน Chrome เครื่องเดียวกันเปิด ws มาที่ URL นี้ได้ และ cookie จะติดไปด้วย — `SameSite=Strict` ช่วยได้แต่ไม่ควรพึ่งพฤติกรรมเบราว์เซอร์อย่างเดียว |

---

## Error handling

| กรณี | พฤติกรรม |
|---|---|
| `.env` ไม่ครบ | ไม่สตาร์ท พร้อมบอกชื่อตัวแปรที่ขาด |
| password ผิด | 401 + ข้อความกลางๆ (ไม่บอกว่าผิดตรงไหน) |
| login ล้มเหลวถี่ | 429 |
| cookie หมดอายุ / ปลอม | WS upgrade → 401 → หน้าเว็บเด้งกลับ login |
| Origin ไม่ตรง | WS upgrade → 403 (ไม่ spawn PTY) |
| PTY exit | เขียน `[process exited: code N]`, ws close 1000, ปุ่ม "เริ่มใหม่" |
| ws หลุด (code ≠ 1000, ≠ 4000) | reset + reconnect backoff, แถบสถานะบอกสถานะ |
| ws ปิดด้วย code 4000 | "เปิดที่อื่นแล้ว" + **ไม่ reconnect** + ปุ่ม "ใช้ที่นี่แทน" |
| `SHELL_CMD` ไม่มีอยู่จริง | PTY exit ทันทีด้วย 127 → ข้อความบอกให้เช็ค `.env` |

---

## Build & deploy

```
pnpm build     # vite build web/ → web/dist/ ; tsc server/ → server/dist/
pnpm start     # node server/dist/index.js
```

- dev: `tsx watch server/index.ts` + `vite dev` (proxy `/pty` ไป 7000)
- systemd **user** service (`Linger=yes` เปิดอยู่แล้วบนเครื่องนี้ ไม่ต้องแตะ root)
- พอร์ต 7000 ว่าง (ที่ใช้อยู่: 22, 3000, 3011, 3012, 5678, 8080, 443)
- `node-pty@1.1.0` เป็น native module — **อัปเกรด Node แล้วต้อง `pnpm rebuild`**
  ไม่งั้นจะพังด้วย `NODE_MODULE_VERSION mismatch` (เขียนไว้ใน README)
  เครื่องนี้มี `g++`/`make`/`python3` ครบ จึง build ได้ถ้าไม่มี prebuild

---

## Testing

| หน่วย | ชนิด | ครอบอะไร |
|---|---|---|
| `auth.ts` | unit | รหัสถูก/ผิด, cookie ปลอม, cookie หมดอายุ, timing-safe |
| `ratelimit.ts` | unit | ผ่านใต้ลิมิต, บล็อกเกินลิมิต, หน้าต่างเวลารีเซ็ต |
| `input-pipeline.ts` | unit | ตารางด้านล่าง — หนาแน่นที่สุดในโปรเจกต์ |
| `pty.ts` | integration | `echo hi` ได้ `hi`, `echo $TERM` ได้ `xterm-256color`, spawn ด้วย cols/rows จาก query แล้ว `stty size` ตรง, resize มีผล, **ws ปิดแล้ว process ตายจริง** (`process.kill(pid,0)` ต้อง throw ESRCH) |
| upgrade guard | integration | ไม่มี cookie → 401, Origin ผิด → 403, cols/rows ผิดรูป → fallback 80×24, ทุกกรณีที่ปฏิเสธต้องไม่ spawn process |
| single session | integration | ws#2 เข้ามา → ws#1 ได้ code 4000 และ PTY#1 ตายจริง |
| มือถือจริง | manual | ดูรายการด้านล่าง |

### `input-pipeline.ts` — ทุกเคสต้องมีเทส

`getModes` เป็น dependency ที่ inject ได้ จึงเทสทั้งสองโหมดได้โดยไม่ต้องมี xterm จริง

| เคส | input | คาดหวัง |
|---|---|---|
| ctrl + ตัวอักษร | `Ctrl`, `"a"` | `0x01` |
| ctrl + สัญลักษณ์ | `Ctrl`, `"?"` | `0x7f` |
| alt | `Alt`, `"x"` | `ESC x` |
| ctrl+alt | `Ctrl`,`Alt`,`"a"` | `ESC 0x01` |
| ลูกศร โหมดปกติ | `"\x1b[D"` | `ESC [ D` (ผ่านไม่แตะ) |
| **ลูกศร app cursor mode** | `"\x1b[D"` + mode on | `ESC O D` |
| **ctrl + ลูกศร** | `Ctrl`, `"\x1b[D"` | `ESC [ 1 ; 5 D` |
| ctrl+alt + ลูกศร | `Ctrl`,`Alt`,`"\x1b[D"` | `ESC [ 1 ; 7 D` |
| **paste ระหว่างค้าง ctrl** | `Ctrl`, `"hello world"` | `"hello world"` ดิบ, modifier ถูกล้าง |
| ctrl + ตัวที่ไม่มี control code | `Ctrl`, `"ก"` | `"ก"` ดิบ (UTF-8), modifier ถูกล้าง |
| toggle | `Ctrl`, `Ctrl` | ไม่ส่งอะไร, `modifierState().ctrl === false` |
| ปุ่มลูกศรบนแถบ | `onBarKey("Left")` | เหมือนเคสลูกศรทุกประการ (โหมด + modifier) |
| Literal ผ่านกติกาเดียวกัน | `Alt`, `onBarKey("Esc")` | `ESC ESC` |
| Literal + ctrl | `Ctrl`, `onBarKey("-")` | `0x1f` |
| `^C` ล้าง modifier | `Ctrl`, `onBarKey("^C")` | `0x03`, `modifierState().ctrl === false` |

### manual บนมือถือจริง — checklist

1. `herdr` เปิดขึ้นมาเองโดยไม่ต้องพิมพ์ และสลับ pane/tab ด้วยแถวปุ่มได้
2. **กด `[Ctrl]` แล้วคีย์บอร์ดต้องไม่ปิด**
3. ลูกศรขยับ pane ใน herdr และขยับ cursor ใน `vim` ได้จริง
4. `Ctrl+←` เลื่อนทีละคำใน shell prompt ได้
5. แถวปุ่มยังมองเห็นตลอดขณะคีย์บอร์ดเปิด และหมุนจอแล้วยัง fit ถูก
6. ปิด/เปิด wifi → reconnect แล้วกลับเข้า herdr session เดิมเอง
7. เปิดบน desktop ค้างไว้แล้วเปิดบนมือถือ → desktop ขึ้น "เปิดที่อื่นแล้ว" และมือถือ
   ใช้งานได้ปกติ ไม่มีการแย่ง resize

โปรเจกต์เล็กเกินกว่าจะคุ้ม Playwright — e2e เป็น manual
