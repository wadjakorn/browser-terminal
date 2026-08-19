# ปรับปรุงประสิทธิภาพการเชื่อมต่อ: coalescing, compression, backpressure

วันที่: 2026-08-19
สถานะ: อนุมัติ design แล้ว รอ implementation plan

## ปัญหา

ใช้งานจริงคือมือถือบน cellular ต่อผ่าน Tailscale อาการที่ผู้ใช้รายงาน:

1. **พิมพ์แล้วตัวอักษรขึ้นช้า** (อาการหลัก)
2. **output จากคำสั่งไหลช้า/มาเป็นก้อนๆ**

RTT บนเส้นทางนี้อยู่ที่ 60–250 ms และแกว่ง เพดานนั้นลดด้วย transport ไม่ได้
เพราะคอขวดคือ round-trip ไม่ใช่ bandwidth แต่**ตอนนี้มีสิ่งที่ทำให้แย่กว่า RTT
เปล่าๆ อยู่หลายอย่าง** และนั่นคือขอบเขตของงานนี้

## สิ่งที่เจอในโค้ดปัจจุบัน

| # | ปัญหา | ตำแหน่ง |
|---|-------|---------|
| 1 | ไม่มี coalescing — WS frame หนึ่งอันต่อ PTY chunk หนึ่งอัน | `server/pty.ts:44` |
| 2 | ไม่มี compression — `ws` ตั้ง `perMessageDeflate: false` เป็น default | `server/index.ts` (`new WebSocketServer`) |
| 3 | ไม่มี backpressure — `ws.send()` เข้าคิวไม่จำกัด | `server/pty.ts:44` |

ข้อ 3 ร้ายที่สุดและเป็นสะพานเชื่อมอาการ 1 กับ 2: เมื่อคำสั่งพ่น output เยอะ
ข้อมูลหลายร้อย KB เข้าคิวรออยู่หน้า แล้วตัวอักษรที่ผู้ใช้พิมพ์ต่อจากนั้น
**ต้องต่อแถวอยู่หลังคิวทั้งหมด** (head-of-line blocking) echo จึงหน่วงจาก
150 ms กลายเป็นหลายวินาที

node-pty มี `pause()` / `resume()` ให้อยู่แล้ว (`node-pty.d.ts:189,194`) แต่ไม่ถูกใช้

## ขอบเขต

**ทำ:** coalescing + compression + backpressure ฝั่ง server (แนวทาง A)

**ไม่ทำในรอบนี้:**
- **predictive local echo แบบ mosh** — เป็นชั้นเดียวที่ลด RTT ที่รู้สึกได้จริง
  แต่แพงและควรมี baseline ก่อน พิจารณาหลังวัดผล A
- **first-load performance** — `serveStatic()` ส่ง JS 368 KB โดยไม่บีบอัดและ
  ไม่มี `Cache-Control`/`ETag` ทั้งที่ชื่อไฟล์เป็น content-hash อยู่แล้ว
  (gzip เหลือ 95 KB) เป็นของถูกและได้ผลชัด แต่ผู้ใช้ระบุว่าไม่ใช่อาการที่เจอ
  → บันทึกไว้ใน TODO
- **protocol flow-control เต็มรูปแบบ** (client ack) — `bufferedAmount`
  ให้ข้อมูลเกือบเท่ากันโดยไม่ต้องเพิ่ม protocol YAGNI จนกว่า A จะพิสูจน์ว่าไม่พอ

## Design

### 1. Coalescing แบบ immediate-first

ข้อกำหนดสำคัญที่สุด: **ห้ามหน่วง chunk แรก** `setTimeout(flush, 5)` แบบตรงไปตรงมา
จะบวก 5 ms ให้การ echo ทุกตัวอักษร ซึ่งสวนทางกับเป้าหมายข้อ 1

พฤติกรรม:

- chunk แรกที่มาถึงหลังเงียบ → **ส่งทันที** แล้วเปิดหน้าต่าง cooldown 5 ms
- chunk ที่มาระหว่างหน้าต่าง → สะสมใน `Buffer[]`
- หมดหน้าต่าง → ถ้ามีของสะสม `Buffer.concat` แล้วส่งรวดเดียว + เปิดหน้าต่างใหม่
  ถ้าไม่มี → ปิดหน้าต่าง กลับสู่สถานะเงียบ

การพิมพ์ทีละตัว (chunk ห่างกันเกิน 5 ms เสมอ) จึงไม่ถูกหน่วงเลย ส่วน burst
จาก `cat` / build log ที่มา 100+ chunk/วินาที ถูกยุบเหลือ ~200 frame/วินาที

### 2. Compression

เปิด `perMessageDeflate` ที่ `WebSocketServer` พร้อม `threshold: 1024`

- frame ต่ำกว่า 1 KB (คือ echo ทุกตัว) ส่งดิบ ไม่เสียเวลา deflate
- frame ใหญ่ (output จริง) ถูกบีบ — ข้อความเทอร์มินัลบีบได้ 5–10 เท่า
- คง context takeover (ค่า default) เพราะ escape sequence ซ้ำสูงมาก dictionary
  ข้ามเฟรมช่วยได้เยอะ และแอปนี้จำกัด session เดียว ต้นทุนหน่วยความจำไม่ใช่ประเด็น

### 3. Backpressure

หลัง flush ทุกครั้ง ตรวจไบต์ที่ส่งเข้า ws แล้วแต่ยังไม่ถูกเขียนลง socket (`outstanding`):

- เกิน **HIGH = 32 KB** → `term.pause()` หยุดอ่านจาก PTY จริง ซึ่งจะไป block
  โปรแกรมที่พ่น output ผ่าน pipe buffer ของ OS — พฤติกรรมเดียวกับเทอร์มินัลจริง
  ที่เลื่อนจอตามไม่ทัน
- ลงต่ำกว่า **LOW = 8 KB** → `term.resume()`
- **ไม่ poll** — `ws.send(data, cb)` เรียก callback เมื่อข้อมูลถูกเขียนลง socket จริง
  จึงนับ `outstanding` เองแบบ event-driven ได้ ไม่ต้องมี interval ให้เคลียร์เลย
- `dispose` เคลียร์ cooldown timer และตั้งธง `disposed` เพื่อไม่ให้ callback ที่มา
  ทีหลัง resume PTY ที่ถูกฆ่าไปแล้ว

นี่คือส่วนที่แก้อาการ "พิมพ์แล้วหน่วงเป็นวินาทีตอนมี output ค้าง" เพราะคิวถูก
จำกัดไม่ให้ยาวเกิน ~32 KB (≈ หนึ่ง RTT) แทนที่จะโตได้ไม่จำกัด

### ค่าคงที่

| ค่า | เริ่มต้น | เหตุผล |
|-----|---------|--------|
| cooldown window | 5 ms | เล็กพอที่ RTT 150 ms กลบมิด ใหญ่พอที่จะยุบ burst |
| deflate threshold | 1 KB | กัน echo frame จิ๋วไม่ให้เสียเวลา deflate |
| outstanding HIGH | 32 KB | ≈ 130 ms ≈ หนึ่ง RTT บน cellular — ใหญ่กว่านี้คือยอมให้ echo ช้าเป็นวินาที |
| outstanding LOW | 8 KB | hysteresis กัน pause/resume กระพริบ |

ทั้งหมดปรับได้หลังวัดจริง

## การเปลี่ยนแปลง

- `server/pty.ts` — งานหลักเกือบทั้งหมด (coalescing + backpressure ใน `attachPty`)
- `server/index.ts` — เปิด `perMessageDeflate` ที่ `new WebSocketServer`
- `server/pty.test.ts` — เทสใหม่
- `README.md` / `TODO.md` — บันทึกพฤติกรรมและงานที่เลื่อนออกไป

## เทส

`server/pty.test.ts` ใช้ ws pair จริงอยู่แล้ว ต่อยอดได้เลย:

1. chunk เดี่ยวถึง client โดยไม่ต้องรอ timer — พิสูจน์ immediate-first
2. chunk รัวๆ ในหน้าต่างเดียว → client ได้รับ frame เดียว เนื้อครบ เรียงถูก
3. `outstanding` ทะลุ HIGH → `pause()` ถูกเรียก; ack จนต่ำกว่า LOW → `resume()`
   (ฉีด fake sink/source แล้วสั่ง ack เองในเทส)
4. dispose ระหว่าง pause แล้ว callback มาทีหลัง → ไม่ resume PTY ที่ตายแล้ว
5. output ก้อนสุดท้ายก่อน `onExit` ต้องถูก flush ก่อนปิด socket ไม่หายไปกับหน้าต่างรวม chunk

## การวัดผล

probe ชั่วคราวฝั่ง web วัด key→echo RTT (บันทึกเวลาตอน `send` จับคู่ตอน byte แรก
กลับมา) log p50/p95 ลง console ไว้เทียบก่อน/หลังบนมือถือจริง ไม่ commit เข้า
production path

เกณฑ์ความสำเร็จ: echo RTT p95 ตอนมี output ไหลอยู่ ต้องไม่ห่างจาก p95 ตอนจอเงียบ
อย่างมีนัยสำคัญ (ตอนนี้ห่างกันหลายเท่า)
