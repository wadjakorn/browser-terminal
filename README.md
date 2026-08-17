# browser-terminal

เว็บเทอร์มินัลสำหรับเข้าถึง shell ของเครื่องคุณจากมือถือ — ออกแบบมาเพื่อจอเล็กและนิ้วมือ
โดยเฉพาะ มีแถวปุ่ม `Esc`/`Ctrl`/`Alt`/ลูกศร ที่คีย์บอร์ด Android ไม่มี และรองรับท่าทาง
touch ครบ (เลื่อน สะบัดให้ไหลต่อ บีบซูม กดค้างแล้วลาก)

นี่คือสิ่งที่แยกโปรเจกต์นี้ออกจาก `ttyd` และ `gotty` — ตัวอื่นเสิร์ฟ xterm.js เฉยๆ
แล้วปล่อยให้คุณสู้กับคีย์บอร์ดบนจอเอาเอง

---

## ⚠️ อ่านก่อนติดตั้ง

**แอปนี้คือการรันโค้ดอะไรก็ได้จากระยะไกล โดยเจตนา** ใครก็ตามที่ผ่านหน้า login ไปได้
จะได้ shell ที่มีสิทธิ์เท่ากับผู้ใช้ที่รัน service — อ่านไฟล์ทุกไฟล์ที่คนนั้นอ่านได้
ใช้ SSH key ที่มีอยู่ ต่อไปยังเครื่องอื่นในเครือข่ายได้

- **รหัสผ่านคือกำแพงทั้งหมด** ถ้าไม่มีการยืนยันตัวตนชั้นเครือข่ายมารองรับ
- **"แค่ LAN ในบ้าน" ไม่ใช่ขอบเขตที่ไว้ใจได้** — อุปกรณ์ IoT ที่ถูกเจาะ แขกที่ต่อ WiFi
  หรือเพื่อนบ้านที่เดารหัส WiFi ได้ ล้วนอยู่ในวงเดียวกับคุณ
- **อย่ารันเป็น root** ให้รันด้วยผู้ใช้ธรรมดาเสมอ

คำแนะนำ: อย่าให้รหัสผ่านของแอปนี้เป็นด่านเดียว — เอาไปวางไว้หลัง Tailscale, SSH tunnel
หรือ tunnel ที่มีการยืนยันตัวตนของผู้ให้บริการ

---

## เลือกวิธี deploy

| วิธี | TLS | ใครยิงหน้า login ได้ | เหมาะกับ |
|---|---|---|---|
| **SSH tunnel** | ไม่ต้อง (SSH ห่อให้) | เฉพาะคนที่มี SSH key | นักพัฒนา — ปลอดภัยที่สุด |
| **Tailscale** | ฟรีจาก Tailscale | เฉพาะเครื่องใน tailnet | มือถือส่วนตัว — สมดุลดีที่สุด |
| **Tunnel + auth ของผู้ให้บริการ** | ฟรีจากผู้ให้บริการ | เฉพาะคนที่ผ่าน auth | เข้าจากเน็ตนอก |
| **reverse proxy สาธารณะ** | Let's Encrypt | **ทั้งอินเทอร์เน็ต** | คนที่รู้ว่ากำลังทำอะไร |
| **LAN แบบ http** | ไม่มี | ทุกคนในวง + ดักอ่านได้ | ไม่แนะนำ ต้องเปิด `ALLOW_INSECURE` |

### SSH tunnel

```bash
# บนเครื่อง server
PUBLIC_ORIGIN=http://localhost:7000 pnpm start
# บนเครื่องของคุณ
ssh -L 7000:localhost:7000 user@server
```

เปิด `http://localhost:7000` — ไม่ต้องมี TLS เพราะ SSH เข้ารหัสให้แล้ว และเบราว์เซอร์
ถือว่า loopback เป็น secure context จึงยอมเก็บ cookie

### Tailscale

```bash
PUBLIC_ORIGIN=https://<เครื่อง>.<tailnet>.ts.net:8443 pnpm start
tailscale serve --bg --https=8443 7000
```

`tailscale serve` รองรับเฉพาะพอร์ต 443, 8443 และ 10000

### Docker

```bash
docker build -t browser-terminal .
docker run -d --env-file .env -p 127.0.0.1:7000:7000 browser-terminal
```

image ตั้ง `HOST=0.0.0.0` ไว้ให้แล้ว (ในคอนเทนเนอร์ bind loopback ไม่ได้) ความปลอดภัย
จึงไปอยู่ที่ `-p 127.0.0.1:...` ซึ่งเปิดให้เฉพาะ loopback ของ host — ถ้าเขียนเป็น
`-p 7000:7000` เฉยๆ จะเปิดสู่เครือข่ายทั้งวง

---

## ติดตั้ง

```bash
pnpm install
cp .env.example .env     # แล้วตั้ง CONSOLE_PASSWORD, SESSION_SECRET, PUBLIC_ORIGIN
pnpm build
pnpm start
```

### รหัสผ่านแบบ hash

```bash
pnpm hash-password        # พิมพ์รหัส แล้วเอาบรรทัดที่ได้ไปใส่ .env
```

`CONSOLE_PASSWORD` รับได้ทั้งรหัสดิบและ hash (`scrypt:...`) — แนะนำให้ใช้ hash เมื่อ
เปิดสู่เครือข่ายจริง สคริปต์รับรหัสทาง stdin ไม่ใช่ argument เพื่อไม่ให้ไปโผล่ใน `ps`
หรือค้างใน shell history

server จะไม่ยอม start ถ้า config อันตราย — รหัสผ่านสั้นหรือเป็นค่าตัวอย่าง,
`SESSION_SECRET` ยังไม่ได้ตั้ง, หรือเสิร์ฟผ่าน http ไปยัง host ที่ไม่ใช่ loopback

### รันเป็น systemd user service

```bash
cp browser-console.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now browser-console
```

---

## การใช้งานบนมือถือ

| ท่า | ผล |
|---|---|
| แตะ 1 ครั้ง | คลิกซ้ายส่งให้ TUI — **ไม่เปิดคีย์บอร์ด** |
| แตะ 2 ครั้ง | คลิกสองครั้งส่งให้ TUI (herdr ใช้เลือกคำแล้วคัดลอก) — **ไม่เปิดคีย์บอร์ด** |
| ปุ่ม `⌨` ท้ายแถว | เปิด/ปิดคีย์บอร์ด (สว่างเมื่อเปิดอยู่) — ทางเดียวที่เปิดคีย์บอร์ดได้ |
| นิ้วเดียวลากขึ้น/ลง | เลื่อนเนื้อหา · สะบัดเร็วแล้วปล่อยจะไหลต่อ · แตะเพื่อหยุด |
| กดค้าง ~0.4 วิ แล้วลาก | ลากเมาส์ (เช่น ย่อ/ขยาย sidebar) — สั่นสั้นๆ ตอนเข้าโหมด |
| สองนิ้วบีบ/ถ่าง | ปรับขนาดฟอนต์ 8–24px (จำค่าไว้ในเครื่อง) |
| `Ctrl` / `Alt` บนแถบ | กดค้างแบบ sticky — กดแล้วพิมพ์ตัวถัดไป กดซ้ำเพื่อปลด |

recognizer ไม่รวบสองแตะเป็นท่าของตัวเองเลย ทุกแตะเป็นคลิกที่ส่งถึง TUI ตรงๆ
เพื่อไม่ให้แย่งดับเบิลคลิกไปจากแอปข้างใน — herdr ใช้มันเลือกคำแล้วคัดลอกให้อัตโนมัติ
(ต้องแตะสองครั้งให้ห่างกันไม่เกิน 1 คอลัมน์ ซึ่งบนมือถือแปลว่าต้องเล็งนิ่งพอสมควร)

การเลื่อนถูกส่งเป็น wheel event ให้แอปข้างในตัดสินใจเอง ว่าจะเลื่อน scrollback ของมัน
หรือส่งต่อให้แอปที่ซ้อนอยู่ ตามที่แอปนั้นขอ mouse reporting ไว้หรือไม่

---

## สิ่งที่ต้องรู้

- **proxy นี้ไม่ทำ persistence ให้** — ปิดเว็บหรือเน็ตหลุด = PTY ตาย งานที่ค้างหายหมด
  ถ้าต้องการให้ session อยู่รอด ตั้ง `SHELL_CMD` เป็น multiplexer เช่น
  `tmux new -A -s web` หรือ `herdr` แล้วต่อใหม่จะ attach กลับ session เดิม
- **session เดียวเท่านั้น** เปิดที่ใหม่จะเตะที่เก่าออก (โดยตั้งใจ)
- **logout เพิกถอน session ทุกใบ** ไม่ใช่แค่เครื่องที่กด — เพราะถ้า cookie รั่ว
  การลบฝั่งเบราว์เซอร์ไม่ได้ทำให้ token ที่อยู่ในมือคนอื่นใช้ไม่ได้
- **rate limit แยกตาม IP** แต่จะได้ IP จริงก็ต่อเมื่อตั้ง `TRUST_PROXY=1` ตอนอยู่หลัง
  proxy — ยืนยันแล้วว่า `tailscale serve` ส่ง `X-Forwarded-For` มาให้จริง
- **อัปเกรด Node แล้วต้อง `pnpm rebuild`** — `node-pty` เป็น native module
  ถ้าไม่ rebuild service จะพังด้วย `NODE_MODULE_VERSION mismatch` ที่อ่านไม่รู้เรื่อง
- **`PUBLIC_ORIGIN` ต้องตรงกับที่เปิดในเบราว์เซอร์เป๊ะๆ** ถ้าไม่ตรง WebSocket จะโดน
  ปฏิเสธ 403 และถ้าใส่ `https` ทั้งที่เสิร์ฟจริงเป็น `http` เบราว์เซอร์จะทิ้ง cookie
  เงียบๆ อาการคือล็อกอินสำเร็จแล้ววนกลับหน้า login
- **`focus` ไม่ใช่ตัวชี้วัดว่าคีย์บอร์ดบนจอเปิดอยู่** — Android ซ่อนคีย์บอร์ดโดยไม่ blur
  ใช้ `keyboard-visibility.ts` ที่วัดจาก `visualViewport` เท่านั้น
- **การลากต้องตั้ง `buttons: 1` บน `mousemove` ด้วย ไม่ใช่แค่ `mousedown`** — xterm
  แยก "ลากทั้งที่กดปุ่มอยู่" ออกจาก "เลื่อนเมาส์เฉยๆ" ด้วยฟิลด์นี้ล้วนๆ และ listener
  ของการลากอยู่ที่ `document` ไม่ใช่ที่ `term.element`
- **ห้ามใช้ `@xterm/addon-attach`** — มันข้าม `input-pipeline.ts` ทั้งก้อน
  ใช้เมื่อไหร่แถวปุ่มมือถือพังทันที

---

## พัฒนาต่อ

```bash
pnpm dev:server                        # tsx watch
DEV_ORIGINS=http://localhost:5173 pnpm dev:web
pnpm test
```

`DEV_ORIGINS` ถูกเมินทั้งหมดเมื่อ `NODE_ENV=production` จึงหลุดติดไปเครื่องจริงไม่ได้

### เอกสาร

- Design: `docs/2026-08-16-browser-console-design.md`
- Review 3 รอบ: `docs/2026-08-16-mvp-design-review.md`
- Plan: `docs/superpowers/plans/2026-08-16-browser-console-mvp.md`
- Review ของ touch gesture: `docs/2026-08-17-touch-gestures-review.md`
- วิธี deploy และความปลอดภัย: `docs/2026-08-17-deployment-security-research.md`
- งานที่ตั้งใจเลื่อนไว้: `TODO.md`

## License

MIT
