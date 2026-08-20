# TODO

รายการที่ตั้งใจเลื่อนไว้ ไม่ใช่บั๊กที่กระทบผู้ใช้ตอนนี้ แต่ละข้อบอกไว้ว่าจะพังเมื่อไหร่
เพื่อให้ตัดสินใจได้ว่าคุ้มทำหรือยัง

## ฟีเจอร์

### เชื่อตัวตนจาก Tailscale แล้วข้ามหน้า login

`tailscale serve` ส่ง header `tailscale-user-login` / `tailscale-user-name` ที่ยืนยัน
ตัวตนมาแล้ว (ตรวจของจริงแล้วว่าส่งมาจริง — ดู
`docs/2026-08-17-deployment-security-research.md`) ถ้าเปิดโหมดนี้ ผู้ใช้ใน tailnet
ของตัวเองจะไม่ต้องพิมพ์รหัสผ่านอีก

**ข้อควรระวังที่ต้องออกแบบให้ถูก:** header พวกนี้ปลอมได้ฟรีถ้าไม่ได้อยู่หลัง
`tailscale serve` จริง จึงต้องเปิดด้วย env var แยก (`TRUST_TAILSCALE_IDENTITY=1`)
และควรบังคับให้ `PUBLIC_ORIGIN` เป็น `.ts.net` ด้วย ไม่งั้นคนที่ยิงตรงมาที่พอร์ต
7000 แนบ header เองจะได้ shell ฟรี — นี่คือช่องที่แย่กว่าไม่มีฟีเจอร์นี้เลย

## ความปลอดภัย — ควรทำก่อนเปิด repo เป็น public

### ไม่มี security header สักตัว

ตอบกลับมาแค่ `content-type` — ไม่มี `X-Content-Type-Options: nosniff`,
`X-Frame-Options` / `frame-ancestors`, `Referrer-Policy` หรือ CSP เลย (ตรวจแล้ว)

`SameSite=Strict` กัน clickjacking ที่ต้องใช้ cookie ไปได้เกือบหมด (หน้าที่ถูก frame
จะเห็นแค่หน้า login) แต่สำหรับโปรเจกต์ที่ขายเรื่องความปลอดภัยเป็นจุดเด่น การไม่มี
เลยคือสิ่งแรกที่คนอ่านจะทัก

แก้: ใส่ชุด header พื้นฐานตอนเสิร์ฟ static และตั้ง CSP ที่ยอม `'self'` โดยต้องเปิด
`'unsafe-inline'` ให้ style เพราะ xterm ฉีด style ของตัวเองเข้ามา

### ชื่อใน LICENSE ยังเป็นของเก่า

`LICENSE` เขียนว่า `browser-console contributors` แต่ repo ชื่อ `browser-terminal`
แล้ว และ `package.json` ยังมี `"private": true` ซึ่งไม่ได้ห้าม repo เป็น public
แต่ควรเอาออกถ้าคิดจะ publish ลง npm สักวัน

### เอกสารทั้ง repo เป็นภาษาไทยล้วน

README, คอมเมนต์ในโค้ด, ข้อความ error ที่ผู้ใช้เห็น และ commit message ทั้งหมด
ไม่ใช่ปัญหาความปลอดภัย แต่ถ้าเป้าหมายคืออยากให้คนนอกเอาไปใช้จริง อย่างน้อย README
กับข้อความ error ควรมีภาษาอังกฤษด้วย

## ความทนทาน

### `SHELL_CMD` ไม่ถูก trim

`server/config.ts:129` — `env.SHELL_CMD || 'herdr'` ใช้ค่าดิบ ถ้า `.env` มีช่องว่าง
ต่อท้าย (`SHELL_CMD=bash `) จะ spawn คำสั่งชื่อ `"bash "` แล้วตายด้วย ENOENT
ที่อ่านไม่รู้เรื่อง เพราะช่องว่างมองไม่เห็นในข้อความ error

แก้: `.trim()` แล้วเช็คว่าไม่ว่างหลัง trim

### `readJsonBody` ไม่ปิด stream ตอน body ใหญ่เกิน

`server/index.ts:29-38` — throw ออกจาก `for await` แต่ไม่เรียก `req.destroy()`
ฝั่งที่ส่งจะยังไถ byte ต่อไปจนหมดหรือ timeout กิน socket ไว้ฟรีๆ ยิงพร้อมกันหลาย
request ก็กิน fd ได้ (จำกัดที่ 4096 byte แล้วจึงไม่ใช่ช่องหน่วยความจำ)

แก้: `req.destroy()` ก่อน throw + เพิ่มเทสว่า body เกินลิมิตได้ 401 ไม่ใช่ค้าง

### `socket.onclose` ไม่เช็คว่าเป็น socket ตัวปัจจุบัน

`web/main.ts:297` — ตั้ง `ws = null` โดยไม่เช็ค `socket === ws` ถ้า socket เก่าปิด
ช้ากว่าตัวใหม่เปิด (เน็ตกระตุก แล้ว reconnect ทับ) handler ของตัวเก่าจะไป null
ตัวใหม่ที่ต่อติดอยู่ อาการคือพิมพ์ไม่ออกทั้งที่จอยังสด

แก้: `if (socket !== ws) return;` เป็นบรรทัดแรกของ handler

### entrypoint guard เทียบแค่ basename

`server/index.ts:179` — `import.meta.url.endsWith(process.argv[1].split('/').pop())`
ไฟล์ชื่อ `index.js` ที่ path อื่นก็ผ่าน guard นี้ ตอนนี้ยังไม่มีผลเพราะมีไฟล์เดียว
แต่ถ้าเพิ่ม entrypoint ที่สองจะกลายเป็นรัน server ซ้อนตอน import

แก้: เทียบ path เต็มด้วย `fileURLToPath(import.meta.url) === resolve(process.argv[1])`

### `$<T>()` cast โดยไม่ตรวจ

`web/main.ts:356` — cast element เป็น type ที่ขอโดยไม่ตรวจจริง ถ้า HTML เปลี่ยน
จะพังเป็น `undefined` ตอน runtime แทนที่จะบอกว่าหา element ไม่เจอ

## เทสที่ยังขาด

- **path traversal บน static server** — **ทดสอบด้วยมือแล้วว่ากันอยู่จริง** ยิง 12 แบบ
  (`/../.env`, `..%2f`, `%2e%2e`, double-encode, backslash, absolute-form ผ่าน raw
  socket) รวมถึงยิงหาไฟล์ที่มีอยู่จริงนอก static root เพราะ SPA fallback บังผลได้
  เหลือแค่ทำให้เป็นเทสอัตโนมัติ กันคนแก้ `serveStatic` แล้วเปิดช่องโดยไม่รู้ตัว
- **body ใหญ่เกินลิมิต** — ผูกกับข้อ `readJsonBody` ข้างบน
- **`COLORTERM=truecolor`** — `server/pty.ts:33` ตั้งไว้แต่ไม่มีเทสว่าไปถึง shell จริง
- **ctrl+alt กับตัวที่แปลงไม่ได้** — `input-pipeline.ts` ยังไม่มีเทสเคสนี้

## เอกสาร

- `pnpm.onlyBuiltDependencies` (`package.json:31`) มีไว้เพื่อให้ `node-pty` build ได้
  แต่ไม่มีคำอธิบายในไฟล์ ใครลบทิ้งจะเจอ error ที่โยงกลับมาไม่ถูก

## ประสิทธิภาพการเชื่อมต่อ (เลื่อนออกไป)

- **first-load ช้าบน cellular** — `serveStatic()` ส่ง JS 368 KB โดยไม่บีบอัดและไม่มี
  `Cache-Control`/`ETag` ทั้งที่ชื่อไฟล์เป็น content-hash อยู่แล้ว (gzip เหลือ 95 KB)
  ของถูกและได้ผลชัด แค่ยังไม่ใช่อาการที่เจอจริง
- **predictive local echo แบบ mosh** — ชั้นเดียวที่ลด RTT ที่ผู้ใช้รู้สึกได้จริง
  ต้องรู้ว่า terminal อยู่ใน mode ไหน (`input-pipeline.ts` มีข้อมูลนี้บางส่วนแล้ว)
  ควรมีตัวเลข baseline จาก key→echo RTT probe ก่อนตัดสินใจลงทุน
- **protocol flow-control เต็มรูปแบบ (client ack)** — ทำเมื่อพิสูจน์ว่า
  `bufferedAmount` อย่างเดียวไม่พอ

## รู้ไว้ แก้ที่นี่ไม่ได้

**เส้นแบ่ง sidebar ของ herdr กว้าง 1 คอลัมน์ (~7.8px)** ทำให้ท่ากดค้างแล้วลาก
ต้องเล็งแม่นเกินไปบนมือถือ hit test อยู่ที่ `src/app/input/sidebar.rs:236-252`
ของ repo `herdr` — ต้องไปขยายที่นั่น แก้ในโปรเจกต์นี้ไม่ได้
