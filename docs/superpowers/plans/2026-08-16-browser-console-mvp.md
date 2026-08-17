# browser-console MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เว็บเทอร์มินัลที่เข้าถึง shell ของ `example-host` จาก Chrome บน Android ผ่าน Tailscale โดยมีแถวปุ่ม `Esc`/`Ctrl`/ลูกศร ที่คีย์บอร์ดมือถือไม่มี

**Architecture:** Node 22 bind `127.0.0.1:7000` อยู่หลัง `tailscale serve --https=8443` (ได้ TLS จริงฟรี) · WebSocket หนึ่งเส้น = PTY หนึ่งตัว = `$SHELL_CMD` (default `herdr`) ตายพร้อมกันสองทาง persistence เป็นหน้าที่ของ herdr ไม่ใช่ของ proxy · ฝั่ง browser เป็น xterm.js + **input pipeline** ที่นั่งคั่นระหว่าง `term.onData` กับ WebSocket เพื่อทำ sticky modifier ให้ถูกต้องตามโหมดของ terminal

**Tech Stack:** TypeScript · `node-pty@1.1.0` · `ws@8.21.3` · `@xterm/xterm@6.0.0` · `@xterm/addon-fit@0.11.0` · `vite@8.2.1` · `vitest` · `tsx`

**Spec:** `docs/2026-08-16-browser-console-design.md` (rev 3)
**Review ที่ทำให้ spec เป็น rev 3:** `docs/2026-08-16-mvp-design-review.md` (3 รอบ)

## Global Constraints

- **ห้ามใช้ `@xterm/addon-attach`** — มันต่อ `term.onData` เข้า WebSocket ตรงๆ ซึ่งข้าม `input-pipeline` ทั้งก้อน ใช้เมื่อไหร่แถวปุ่มมือถือพังทันที
- **ห้าม hardcode byte ของปุ่มลูกศร** — ต้องอ่าน `term.modes.applicationCursorKeysMode` ทุกครั้ง herdr/vim/htop เปิดโหมดนี้
- **ห้าม bind interface อื่นนอกจาก `127.0.0.1`** — TLS และการเข้าถึงเป็นหน้าที่ของ `tailscale serve`
- Node ≥ 22 (เครื่องนี้ v22.23.2) · pnpm (เครื่องนี้ 10.34.5)
- ทุกไฟล์ใน `server/` และ `web/` เป็น TypeScript ESM (`"type": "module"`)
- PTY env ต้องมี `TERM=xterm-256color` และ `COLORTERM=truecolor` เสมอ
- เทียบความลับทุกครั้งด้วย `crypto.timingSafeEqual` ห้ามใช้ `===`
- พอร์ต: server `7000` (ว่าง) · `tailscale serve` `8443` (รับเฉพาะ 443/8443/10000)
- Origin ปลายทาง prod: `https://example-host.tailnet.ts.net:8443`

---

## File Structure

| ไฟล์ | หน้าที่เดียวของมัน |
|---|---|
| `server/config.ts` | อ่าน+validate `.env` ครั้งเดียวตอนบูต ไม่ครบ = ไม่ยอมสตาร์ท |
| `server/auth.ts` | pure — `verifyPassword`, `signSession`, `verifySession` |
| `server/ratelimit.ts` | pure — ถังนับ login ที่ล้มเหลว แบบ global |
| `server/pty.ts` | ws หนึ่งเส้น ↔ PTY หนึ่งตัว ไม่รู้จัก auth เลย |
| `server/index.ts` | HTTP routes + static + upgrade guard + บังคับ session เดียว |
| `web/input-pipeline.ts` | pure — สาย input ทั้งหมด sticky modifier + CSI + โหมด cursor |
| `web/keybar.ts` | DOM ของแถวปุ่ม + กัน focus หลุด |
| `web/viewport.ts` | จัดการ visualViewport + fit + ส่ง resize |
| `web/main.ts` | ประกอบทุกอย่าง: login, xterm, ws, reconnect |
| `web/index.html`, `web/style.css` | โครงหน้าและสไตล์ |

`input-pipeline.ts` แยกจาก `keybar.ts` โดยตั้งใจ — ตัวแรกเป็นตรรกะบริสุทธิ์ที่มีเทสหนาแน่นที่สุดในโปรเจกต์ ตัวหลังเป็น DOM ล้วน

---

### Task 1: Scaffold โปรเจกต์และ toolchain

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `vitest.config.ts`

**Interfaces:**
- Consumes: —
- Produces: คำสั่ง `pnpm test`, `pnpm build`, `pnpm dev`, `pnpm start` ที่ทุก task ถัดไปใช้

- [ ] **Step 1: `git init` และวางไฟล์กันหลุด**

```bash
cd /home/user/development/browser-console
git init
printf 'node_modules/\ndist/\nweb/dist/\n.env\n' > .gitignore
```

- [ ] **Step 2: สร้าง `package.json`**

```json
{
  "name": "browser-console",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:server": "tsx watch server/index.ts",
    "dev:web": "vite",
    "build": "vite build && tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "node-pty": "1.1.0",
    "ws": "8.21.3"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/ws": "^8",
    "@xterm/addon-fit": "0.11.0",
    "@xterm/xterm": "6.0.0",
    "tsx": "^4",
    "typescript": "^5",
    "vite": "8.2.1",
    "vitest": "^3"
  }
}
```

- [ ] **Step 3: สร้าง `tsconfig.json` และ `tsconfig.server.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["server", "web"]
}
```

`tsconfig.server.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["server"]
}
```

- [ ] **Step 4: สร้าง `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7000',
      '/pty': { target: 'ws://127.0.0.1:7000', ws: true },
    },
  },
});
```

- [ ] **Step 5: สร้าง `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['**/*.test.ts'] },
});
```

- [ ] **Step 6: สร้าง `.env.example`**

```bash
CONSOLE_PASSWORD=changeme
SESSION_SECRET=generate-with-openssl-rand-hex-32
SHELL_CMD=herdr
PORT=7000
ALLOWED_ORIGINS=https://example-host.tailnet.ts.net:8443,http://localhost:5173
```

- [ ] **Step 7: ติดตั้งและยืนยันว่า `node-pty` compile ผ่าน**

```bash
pnpm install
node -e "import('node-pty').then(m => console.log('node-pty OK', typeof m.spawn))"
```
Expected: `node-pty OK function`
ถ้าพัง: เครื่องนี้มี `g++`/`make`/`python3` ครบแล้ว ให้ดู error ของ `node-gyp` ตรงๆ

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold project, toolchain, deps"
```

---

### Task 2: `server/config.ts` — validate `.env` ตอนบูต

**Files:**
- Create: `server/config.ts`, `server/config.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  ```ts
  export interface Config {
    password: string; sessionSecret: string; shellCmd: string;
    port: number; allowedOrigins: string[];
  }
  export function loadConfig(env: NodeJS.ProcessEnv): Config;  // throws Error ถ้าไม่ครบ
  ```

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

```ts
// server/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

const full = {
  CONSOLE_PASSWORD: 'pw', SESSION_SECRET: 'sec', SHELL_CMD: 'bash',
  PORT: '7000', ALLOWED_ORIGINS: 'https://a.example,http://localhost:5173',
};

describe('loadConfig', () => {
  it('อ่านค่าครบและแยก origins ด้วย comma', () => {
    const c = loadConfig(full);
    expect(c.password).toBe('pw');
    expect(c.port).toBe(7000);
    expect(c.allowedOrigins).toEqual(['https://a.example', 'http://localhost:5173']);
  });

  it('SHELL_CMD default เป็น herdr', () => {
    const { SHELL_CMD, ...rest } = full;
    expect(loadConfig(rest).shellCmd).toBe('herdr');
  });

  it('PORT default เป็น 7000', () => {
    const { PORT, ...rest } = full;
    expect(loadConfig(rest).port).toBe(7000);
  });

  it('ขาด CONSOLE_PASSWORD แล้ว throw พร้อมชื่อตัวแปร', () => {
    const { CONSOLE_PASSWORD, ...rest } = full;
    expect(() => loadConfig(rest)).toThrow(/CONSOLE_PASSWORD/);
  });

  it('ขาด SESSION_SECRET แล้ว throw พร้อมชื่อตัวแปร', () => {
    const { SESSION_SECRET, ...rest } = full;
    expect(() => loadConfig(rest)).toThrow(/SESSION_SECRET/);
  });

  it('ขาด ALLOWED_ORIGINS แล้ว throw', () => {
    const { ALLOWED_ORIGINS, ...rest } = full;
    expect(() => loadConfig(rest)).toThrow(/ALLOWED_ORIGINS/);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าพัง**

Run: `pnpm vitest run server/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config.js"`

- [ ] **Step 3: เขียน implementation ให้น้อยที่สุดที่ผ่าน**

```ts
// server/config.ts
export interface Config {
  password: string;
  sessionSecret: string;
  shellCmd: string;
  port: number;
  allowedOrigins: string[];
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`ตัวแปรใน .env ขาดหรือว่าง: ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    password: required(env, 'CONSOLE_PASSWORD'),
    sessionSecret: required(env, 'SESSION_SECRET'),
    shellCmd: env.SHELL_CMD || 'herdr',
    port: Number(env.PORT) || 7000,
    allowedOrigins: required(env, 'ALLOWED_ORIGINS')
      .split(',').map(s => s.trim()).filter(Boolean),
  };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `pnpm vitest run server/config.test.ts`
Expected: PASS 6 tests

- [ ] **Step 5: Commit**

```bash
git add server/config.ts server/config.test.ts
git commit -m "feat(server): config loader ที่ปฏิเสธการบูตเมื่อ .env ไม่ครบ"
```

---

### Task 3: `server/auth.ts` — password + signed session cookie

**Files:**
- Create: `server/auth.ts`, `server/auth.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  ```ts
  export function verifyPassword(input: string, expected: string): boolean;
  export function signSession(secret: string, expiresAtMs: number): string;
  export function verifySession(secret: string, token: string, nowMs: number): boolean;
  export function parseCookie(header: string | undefined, name: string): string | undefined;
  ```
  รูปแบบ token: `<expiresAtMs>.<hexHmacSha256(secret, expiresAtMs)>`

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

```ts
// server/auth.test.ts
import { describe, it, expect } from 'vitest';
import { verifyPassword, signSession, verifySession, parseCookie } from './auth.js';

const SECRET = 'test-secret';
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

describe('verifyPassword', () => {
  it('รหัสถูกต้องผ่าน', () => expect(verifyPassword('hunter2', 'hunter2')).toBe(true));
  it('รหัสผิดไม่ผ่าน', () => expect(verifyPassword('nope', 'hunter2')).toBe(false));
  it('ความยาวต่างกันไม่ผ่านและไม่ throw', () =>
    expect(verifyPassword('short', 'muchlongerpassword')).toBe(false));
  it('ค่าว่างไม่ผ่าน', () => expect(verifyPassword('', 'hunter2')).toBe(false));
});

describe('session token', () => {
  it('token ที่เพิ่ง sign ผ่าน', () => {
    const t = signSession(SECRET, NOW + HOUR);
    expect(verifySession(SECRET, t, NOW)).toBe(true);
  });

  it('token หมดอายุไม่ผ่าน', () => {
    const t = signSession(SECRET, NOW - 1);
    expect(verifySession(SECRET, t, NOW)).toBe(false);
  });

  it('secret คนละตัวไม่ผ่าน', () => {
    const t = signSession(SECRET, NOW + HOUR);
    expect(verifySession('other-secret', t, NOW)).toBe(false);
  });

  it('แก้ expiry แล้วลายเซ็นไม่ตรง จึงไม่ผ่าน', () => {
    const t = signSession(SECRET, NOW + HOUR);
    const sig = t.split('.')[1]!;
    expect(verifySession(SECRET, `${NOW + HOUR * 999}.${sig}`, NOW)).toBe(false);
  });

  it('token รูปแบบพังไม่ throw', () => {
    for (const bad of ['', 'garbage', 'a.b.c', '.', '123.']) {
      expect(verifySession(SECRET, bad, NOW)).toBe(false);
    }
  });
});

describe('parseCookie', () => {
  it('ดึงค่าที่ต้องการจากหลายคุกกี้', () =>
    expect(parseCookie('a=1; bc_session=xyz; d=2', 'bc_session')).toBe('xyz'));
  it('ไม่มี header คืน undefined', () =>
    expect(parseCookie(undefined, 'bc_session')).toBeUndefined());
  it('ไม่มีชื่อนั้นคืน undefined', () =>
    expect(parseCookie('a=1', 'bc_session')).toBeUndefined());
  it('ไม่จับชื่อที่เป็นส่วนท้ายของชื่ออื่น', () =>
    expect(parseCookie('xbc_session=wrong', 'bc_session')).toBeUndefined());
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าพัง**

Run: `pnpm vitest run server/auth.test.ts`
Expected: FAIL — resolve `./auth.js` ไม่ได้

- [ ] **Step 3: เขียน implementation**

```ts
// server/auth.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'bc_session';
export const SESSION_TTL_MS = 30 * 24 * 3_600_000; // 30 วัน

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual ต้องยาวเท่ากัน — เทียบความยาวแยกแล้วยังเทียบ buffer
  // เพื่อให้เวลาที่ใช้ไม่ผูกกับตำแหน่งตัวอักษรที่ต่างกัน
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyPassword(input: string, expected: string): boolean {
  if (!input || !expected) return false;
  return safeEqual(input, expected);
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function signSession(secret: string, expiresAtMs: number): string {
  const payload = String(expiresAtMs);
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySession(secret: string, token: string, nowMs: number): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts as [string, string];
  if (!payload || !sig) return false;
  if (!safeEqual(sig, sign(secret, payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `pnpm vitest run server/auth.test.ts`
Expected: PASS 12 tests

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts server/auth.test.ts
git commit -m "feat(server): password + HMAC session cookie แบบ timing-safe"
```

---

### Task 4: `server/ratelimit.ts` — ถัง login แบบ global

**Files:**
- Create: `server/ratelimit.ts`, `server/ratelimit.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  ```ts
  export function createLoginLimiter(opts?: { max?: number; windowMs?: number }): {
    isBlocked(nowMs: number): boolean;
    recordFailure(nowMs: number): void;
    reset(): void;
  };
  ```

**หมายเหตุการออกแบบ:** limiter นี้เป็น **global โดยตั้งใจ ไม่ใช่ลืม** — server bind `127.0.0.1` อยู่หลัง `tailscale serve` ทุก request จึงมาจาก `127.0.0.1` เสมอ (พิสูจน์แล้วในรอบ review ที่ 3) bucket ต่อ IP จึงไม่มีความหมาย และ `X-Forwarded-For` ปลอมได้ MVP มีรหัสผ่านเดียวและผู้ใช้คนเดียว

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

```ts
// server/ratelimit.test.ts
import { describe, it, expect } from 'vitest';
import { createLoginLimiter } from './ratelimit.js';

const T = 1_000_000;

describe('createLoginLimiter', () => {
  it('เริ่มต้นไม่บล็อก', () => {
    expect(createLoginLimiter().isBlocked(T)).toBe(false);
  });

  it('ล้มเหลวใต้ลิมิตยังไม่บล็อก', () => {
    const l = createLoginLimiter({ max: 3, windowMs: 60_000 });
    l.recordFailure(T); l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(false);
  });

  it('ล้มเหลวถึงลิมิตแล้วบล็อก', () => {
    const l = createLoginLimiter({ max: 3, windowMs: 60_000 });
    l.recordFailure(T); l.recordFailure(T); l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(true);
  });

  it('พ้นหน้าต่างเวลาแล้วปลดบล็อกเอง', () => {
    const l = createLoginLimiter({ max: 2, windowMs: 60_000 });
    l.recordFailure(T); l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(true);
    expect(l.isBlocked(T + 60_001)).toBe(false);
  });

  it('ความล้มเหลวเก่ากว่าหน้าต่างไม่ถูกนับ', () => {
    const l = createLoginLimiter({ max: 2, windowMs: 60_000 });
    l.recordFailure(T);
    l.recordFailure(T + 60_001);
    expect(l.isBlocked(T + 60_001)).toBe(false);
  });

  it('reset ล้างถังทันที', () => {
    const l = createLoginLimiter({ max: 1, windowMs: 60_000 });
    l.recordFailure(T);
    expect(l.isBlocked(T)).toBe(true);
    l.reset();
    expect(l.isBlocked(T)).toBe(false);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าพัง**

Run: `pnpm vitest run server/ratelimit.test.ts`
Expected: FAIL — resolve `./ratelimit.js` ไม่ได้

- [ ] **Step 3: เขียน implementation**

```ts
// server/ratelimit.ts
export function createLoginLimiter(opts: { max?: number; windowMs?: number } = {}) {
  const max = opts.max ?? 10;
  const windowMs = opts.windowMs ?? 60_000;
  let failures: number[] = [];

  const prune = (nowMs: number) => {
    failures = failures.filter(t => nowMs - t < windowMs);
  };

  return {
    isBlocked(nowMs: number): boolean {
      prune(nowMs);
      return failures.length >= max;
    },
    recordFailure(nowMs: number): void {
      prune(nowMs);
      failures.push(nowMs);
    },
    reset(): void {
      failures = [];
    },
  };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `pnpm vitest run server/ratelimit.test.ts`
Expected: PASS 6 tests

- [ ] **Step 5: Commit**

```bash
git add server/ratelimit.ts server/ratelimit.test.ts
git commit -m "feat(server): global login rate limiter"
```

---

### Task 5: `web/input-pipeline.ts` — หัวใจของโปรเจกต์

**Files:**
- Create: `web/input-pipeline.ts`, `web/input-pipeline.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  ```ts
  export type BarKey =
    | { kind: 'modifier'; name: 'ctrl' | 'alt' }
    | { kind: 'literal'; data: string }
    | { kind: 'interrupt' };

  export interface Modes { applicationCursorKeysMode: boolean }

  export function createInputPipeline(deps: {
    send: (bytes: Uint8Array) => void;
    getModes: () => Modes;
  }): {
    onTerminalData(data: string): void;
    onBarKey(key: BarKey): void;
    modifierState(): { ctrl: boolean; alt: boolean };
  };
  ```

**ทำไมต้องพิถีพิถัน:** `herdr` เป็น multiplexer ที่ใช้ key chord สลับ pane/tab และมันเปิด application cursor mode (DECCKM) ถ้าส่ง `ESC [ D` ในโหมดนั้น ลูกศรจะไม่ทำงาน และจะดูเหมือนเป็นบั๊กของ herdr โมดูลนี้คือเหตุผลเดียวที่โปรเจกต์นี้มีอยู่แทนที่จะใช้ `ttyd`

**กติกาที่ implement:**

1. จำแนก input ด้วย **โครงสร้าง ไม่ใช่ความยาว** — ปุ่มลูกศรจริงยิง `onData` ยาว 3 ตัว
   | input | จำแนก | ทำ |
   |---|---|---|
   | ขึ้นต้น `\x1b` | key sequence | ผสม modifier แบบ CSI |
   | ยาว 1 ตัว | ตัวอักษรเดี่ยว | แปลงเป็น control code |
   | ยาว > 1 และไม่ขึ้นต้น `\x1b` | paste | **ล้าง modifier** ส่งดิบ |
2. ตัวอักษรเดี่ยว: `ctrl` + `a`–`z`/`A`–`Z` → `code & 0x1f` · `ctrl` + `[ \ ] ^ _ ? -` → ตามตาราง · `alt` → เติม `ESC` นำหน้า · ctrl+alt = แปลง ctrl ก่อนแล้วเติม ESC · ctrl กับตัวที่ไม่มี control code → ล้าง modifier ส่งดิบ
3. cursor sequence (`\x1b[X` หรือ `\x1bOX` เมื่อ X ∈ `A B C D H F`):
   - มี modifier → `ESC [ 1 ; n X` เสมอ (แม้อยู่ใน app cursor mode) — ตรงกับที่ xterm ทำเองที่ `Keyboard.ts:117-121`
   - ไม่มี modifier + app cursor mode → `ESC O X`
   - ไม่มี modifier + โหมดปกติ → `ESC [ X`
   - `n = 1 + (alt?2:0) + (ctrl?4:0)` → ctrl = 5, alt = 3, ctrl+alt = 7
4. sequence อื่นที่ขึ้นต้น `\x1b` → ส่งผ่านตามเดิม ล้าง modifier
5. modifier ถูกใช้แล้วปลดเองเสมอ · กดปุ่ม modifier เดิมซ้ำ = toggle ปลด
6. `interrupt` (`^C`) → ส่ง `0x03` และล้าง modifier ทุกครั้ง

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

```ts
// web/input-pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createInputPipeline, type BarKey, type Modes } from './input-pipeline.js';

const CTRL: BarKey = { kind: 'modifier', name: 'ctrl' };
const ALT: BarKey = { kind: 'modifier', name: 'alt' };
const lit = (data: string): BarKey => ({ kind: 'literal', data });

let sent: number[][];
let modes: Modes;
let p: ReturnType<typeof createInputPipeline>;

beforeEach(() => {
  sent = [];
  modes = { applicationCursorKeysMode: false };
  p = createInputPipeline({
    send: b => sent.push([...b]),
    getModes: () => modes,
  });
});

const bytes = (s: string) => [...new TextEncoder().encode(s)];
const only = () => { expect(sent).toHaveLength(1); return sent[0]!; };

describe('ตัวอักษรเดี่ยว', () => {
  it('ไม่มี modifier ส่งผ่านเป็น UTF-8', () => {
    p.onTerminalData('a');
    expect(only()).toEqual([0x61]);
  });

  it('ctrl + ตัวอักษร', () => {
    p.onBarKey(CTRL); p.onTerminalData('a');
    expect(only()).toEqual([0x01]);
  });

  it('ctrl + ตัวพิมพ์ใหญ่ก็ได้ control code เดียวกัน', () => {
    p.onBarKey(CTRL); p.onTerminalData('A');
    expect(only()).toEqual([0x01]);
  });

  it('ctrl + สัญลักษณ์', () => {
    p.onBarKey(CTRL); p.onTerminalData('?');
    expect(only()).toEqual([0x7f]);
  });

  it('alt เติม ESC นำหน้า', () => {
    p.onBarKey(ALT); p.onTerminalData('x');
    expect(only()).toEqual([0x1b, 0x78]);
  });

  it('ctrl + alt แปลง ctrl ก่อนแล้วเติม ESC', () => {
    p.onBarKey(CTRL); p.onBarKey(ALT); p.onTerminalData('a');
    expect(only()).toEqual([0x1b, 0x01]);
  });

  it('ctrl กับตัวที่ไม่มี control code ส่งดิบและล้าง modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('ก');
    expect(only()).toEqual(bytes('ก'));
    expect(p.modifierState().ctrl).toBe(false);
  });

  it('modifier ถูกปลดหลังใช้', () => {
    p.onBarKey(CTRL); p.onTerminalData('a'); p.onTerminalData('b');
    expect(sent).toEqual([[0x01], [0x62]]);
  });
});

describe('ปุ่มลูกศร — โหมด cursor', () => {
  it('โหมดปกติ ส่งผ่าน CSI ตามเดิม', () => {
    p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1b[D'));
  });

  it('application cursor mode แปลงเป็น SS3', () => {
    modes.applicationCursorKeysMode = true;
    p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1bOD'));
  });

  it('input ที่เป็น SS3 อยู่แล้วในโหมดปกติ ถูกแปลงกลับเป็น CSI', () => {
    p.onTerminalData('\x1bOD');
    expect(only()).toEqual(bytes('\x1b[D'));
  });

  it('ctrl + ลูกศร ได้ CSI แบบมี modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1b[1;5D'));
  });

  it('ctrl + ลูกศร ใน app cursor mode ก็ยังเป็น CSI แบบมี modifier', () => {
    modes.applicationCursorKeysMode = true;
    p.onBarKey(CTRL); p.onTerminalData('\x1b[D');
    expect(only()).toEqual(bytes('\x1b[1;5D'));
  });

  it('alt + ลูกศร ได้ n = 3', () => {
    p.onBarKey(ALT); p.onTerminalData('\x1b[A');
    expect(only()).toEqual(bytes('\x1b[1;3A'));
  });

  it('ctrl + alt + ลูกศร ได้ n = 7', () => {
    p.onBarKey(CTRL); p.onBarKey(ALT); p.onTerminalData('\x1b[C');
    expect(only()).toEqual(bytes('\x1b[1;7C'));
  });

  it('Home/End ก็ใช้กติกาเดียวกัน', () => {
    p.onBarKey(CTRL); p.onTerminalData('\x1b[H');
    expect(only()).toEqual(bytes('\x1b[1;5H'));
  });
});

describe('paste และ sequence อื่น', () => {
  it('paste ระหว่างค้าง ctrl ส่งดิบและล้าง modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('hello world');
    expect(only()).toEqual(bytes('hello world'));
    expect(p.modifierState().ctrl).toBe(false);
  });

  it('paste ที่มีภาษาไทยเข้ารหัส UTF-8 ถูกต้อง', () => {
    p.onTerminalData('สวัสดี');
    expect(only()).toEqual(bytes('สวัสดี'));
  });

  it('sequence อื่นที่ไม่ใช่ cursor ส่งผ่านและล้าง modifier', () => {
    p.onBarKey(CTRL); p.onTerminalData('\x1b[3~');
    expect(only()).toEqual(bytes('\x1b[3~'));
    expect(p.modifierState().ctrl).toBe(false);
  });
});

describe('BarKey', () => {
  it('modifier ไม่ส่ง byte ออกเอง', () => {
    p.onBarKey(CTRL);
    expect(sent).toHaveLength(0);
    expect(p.modifierState().ctrl).toBe(true);
  });

  it('กด modifier ซ้ำคือ toggle ปลด', () => {
    p.onBarKey(CTRL); p.onBarKey(CTRL);
    expect(p.modifierState().ctrl).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('literal ผ่านกติกา modifier เหมือน input จากคีย์บอร์ด — alt + Esc', () => {
    p.onBarKey(ALT); p.onBarKey(lit('\x1b'));
    expect(only()).toEqual([0x1b, 0x1b]);
  });

  it('literal — ctrl + ขีดกลาง ได้ 0x1f', () => {
    p.onBarKey(CTRL); p.onBarKey(lit('-'));
    expect(only()).toEqual([0x1f]);
  });

  it('literal — ปุ่มลูกศรบนแถบใช้กติกาโหมดเดียวกัน', () => {
    modes.applicationCursorKeysMode = true;
    p.onBarKey(lit('\x1b[D'));
    expect(only()).toEqual(bytes('\x1bOD'));
  });

  it('literal — Tab ธรรมดา', () => {
    p.onBarKey(lit('\t'));
    expect(only()).toEqual([0x09]);
  });

  it('interrupt ส่ง 0x03 และล้าง modifier ที่ค้างอยู่', () => {
    p.onBarKey(CTRL); p.onBarKey({ kind: 'interrupt' });
    expect(only()).toEqual([0x03]);
    expect(p.modifierState().ctrl).toBe(false);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าพัง**

Run: `pnpm vitest run web/input-pipeline.test.ts`
Expected: FAIL — resolve `./input-pipeline.js` ไม่ได้

- [ ] **Step 3: เขียน implementation**

```ts
// web/input-pipeline.ts
export type BarKey =
  | { kind: 'modifier'; name: 'ctrl' | 'alt' }
  | { kind: 'literal'; data: string }
  | { kind: 'interrupt' };

export interface Modes {
  applicationCursorKeysMode: boolean;
}

const ESC = '\x1b';
const encoder = new TextEncoder();

/** ปุ่มที่มีทั้งรูปแบบ CSI (`ESC[X`) และ SS3 (`ESCOX`) */
const CURSOR_FINALS = new Set(['A', 'B', 'C', 'D', 'H', 'F']);

/** ctrl + สัญลักษณ์เหล่านี้มี control code ตามมาตรฐาน */
const CTRL_SYMBOLS: Record<string, number> = {
  '[': 0x1b, '\\': 0x1c, ']': 0x1d, '^': 0x1e,
  '_': 0x1f, '-': 0x1f, '?': 0x7f, ' ': 0x00,
};

interface Parsed {
  kind: 'cursor' | 'sequence' | 'single' | 'paste';
  final?: string;
}

function classify(data: string): Parsed {
  // ESC เดี่ยวเป็น "ตัวอักษร" ไม่ใช่ sequence — ไม่งั้น Alt+Esc จะกลืน modifier ทิ้ง
  if (data === ESC) return { kind: 'single' };
  if (data.startsWith(ESC)) {
    const m = /^\x1b(?:\[|O)([A-Z])$/.exec(data);
    if (m && CURSOR_FINALS.has(m[1]!)) return { kind: 'cursor', final: m[1]! };
    return { kind: 'sequence' };
  }
  // นับเป็นตัวอักษรเดี่ยวเมื่อเป็น code point เดียว ไม่ใช่จำนวน UTF-16 unit
  return [...data].length === 1 ? { kind: 'single' } : { kind: 'paste' };
}

export function createInputPipeline(deps: {
  send: (bytes: Uint8Array) => void;
  getModes: () => Modes;
}) {
  let ctrl = false;
  let alt = false;

  const clear = () => { ctrl = false; alt = false; };

  const sendText = (s: string) => deps.send(encoder.encode(s));

  function handleSingle(ch: string): void {
    let bytes: number[] | null = null;

    if (ctrl) {
      const code = ch.charCodeAt(0);
      if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        bytes = [code & 0x1f];
      } else if (ch in CTRL_SYMBOLS) {
        bytes = [CTRL_SYMBOLS[ch]!];
      }
      // ctrl กับตัวที่ไม่มี control code → bytes ยังเป็น null, ตกไปส่งดิบ
    }

    if (bytes === null) {
      const raw = [...encoder.encode(ch)];
      bytes = alt ? [0x1b, ...raw] : raw;
    } else if (alt) {
      bytes = [0x1b, ...bytes];
    }

    clear();
    deps.send(new Uint8Array(bytes));
  }

  function handleCursor(final: string): void {
    if (ctrl || alt) {
      const n = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
      clear();
      sendText(`${ESC}[1;${n}${final}`);
      return;
    }
    clear();
    sendText(deps.getModes().applicationCursorKeysMode
      ? `${ESC}O${final}`
      : `${ESC}[${final}`);
  }

  function feed(data: string): void {
    const parsed = classify(data);
    switch (parsed.kind) {
      case 'cursor':   return handleCursor(parsed.final!);
      case 'single':   return handleSingle(data);
      case 'sequence':
      case 'paste':    clear(); return sendText(data);
    }
  }

  return {
    onTerminalData(data: string): void {
      feed(data);
    },

    onBarKey(key: BarKey): void {
      if (key.kind === 'modifier') {
        if (key.name === 'ctrl') ctrl = !ctrl;
        else alt = !alt;
        return;
      }
      if (key.kind === 'interrupt') {
        clear();
        deps.send(new Uint8Array([0x03]));
        return;
      }
      feed(key.data);
    },

    modifierState(): { ctrl: boolean; alt: boolean } {
      return { ctrl, alt };
    },
  };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `pnpm vitest run web/input-pipeline.test.ts`
Expected: PASS 25 tests

- [ ] **Step 5: Commit**

```bash
git add web/input-pipeline.ts web/input-pipeline.test.ts
git commit -m "feat(web): input pipeline พร้อม sticky modifier และ CSI/SS3 ตามโหมด cursor"
```

---

### Task 6: `server/pty.ts` — ws หนึ่งเส้น ↔ PTY หนึ่งตัว

**Files:**
- Create: `server/pty.ts`, `server/pty.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  ```ts
  export interface PtyOptions { shellCmd: string; cols: number; rows: number }
  export function attachPty(ws: import('ws').WebSocket, opts: PtyOptions): { pid: number };
  export function parseDims(url: string): { cols: number; rows: number };
  ```

**สัญญาของโมดูลนี้ — สองทาง ห้ามขาดข้างใดข้างหนึ่ง:**
- `ws` ปิด → `pty.kill('SIGHUP')` (ไม่มีข้อนี้ = process รั่วทุกครั้งที่เน็ตมือถือสะดุด)
- PTY exit → `ws.close(1000, ...)`

`env` ต้องมี `TERM=xterm-256color` เสมอ เพราะ systemd service ไม่มี tty จึงไม่มี `TERM` และ herdr เป็น Rust TUI ที่จะเพี้ยนถ้า `TERM` ว่าง

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

```ts
// server/pty.test.ts
import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { attachPty, parseDims } from './pty.js';

describe('parseDims', () => {
  it('อ่าน cols/rows จาก query', () =>
    expect(parseDims('/pty?cols=52&rows=38')).toEqual({ cols: 52, rows: 38 }));
  it('ไม่มี query → 80x24', () =>
    expect(parseDims('/pty')).toEqual({ cols: 80, rows: 24 }));
  it('ค่าไม่ใช่ตัวเลข → 80x24', () =>
    expect(parseDims('/pty?cols=abc&rows=-')).toEqual({ cols: 80, rows: 24 }));
  it('ค่านอกช่วง 1-1000 → 80x24', () =>
    expect(parseDims('/pty?cols=0&rows=99999')).toEqual({ cols: 80, rows: 24 }));
  it('ทศนิยมถูกปฏิเสธ', () =>
    expect(parseDims('/pty?cols=52.5&rows=38')).toEqual({ cols: 80, rows: 24 }));
});

/** เปิด ws server ชั่วคราวแล้วคืนคู่ (serverSideSocket, clientSocket) */
async function pair(): Promise<{
  server: WebSocket; client: WebSocket; close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const { port } = wss.address() as { port: number };
  const serverP = new Promise<WebSocket>(r => wss.once('connection', ws => r(ws)));
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>(r => client.once('open', () => r()));
  const server = await serverP;
  return {
    server, client,
    close: () => new Promise<void>(r => wss.close(() => r())),
  };
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/** รอจนกว่า predicate เป็นจริง หรือหมดเวลา */
async function until(fn: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return fn();
}

/** เก็บ output ที่ server ส่งกลับมาหา client จนกว่าจะเจอ pattern */
function collect(client: WebSocket): { text: () => string } {
  let buf = '';
  client.on('message', d => { buf += d.toString(); });
  return { text: () => buf };
}

describe('attachPty', () => {
  it('รันคำสั่งแล้ว stream output กลับมา', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('echo marker-hi\n'));
    expect(await until(() => out.text().includes('marker-hi'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('ตั้ง TERM เป็น xterm-256color', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('echo TERM=$TERM\n'));
    expect(await until(() => out.text().includes('TERM=xterm-256color'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('spawn ด้วยขนาดที่ให้มา ไม่ใช่ 80x24', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 52, rows: 38 });
    client.send(Buffer.from('stty size\n'));
    expect(await until(() => out.text().includes('38 52'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('control frame resize มีผลจริง', async () => {
    const { server, client, close } = await pair();
    const out = collect(client);
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(JSON.stringify({ t: 'resize', cols: 100, rows: 40 }));
    await new Promise(r => setTimeout(r, 300));
    client.send(Buffer.from('stty size\n'));
    expect(await until(() => out.text().includes('40 100'))).toBe(true);
    client.close(); await close();
  }, 15000);

  it('ws ปิดแล้ว process ตายจริง', async () => {
    const { server, client, close } = await pair();
    const { pid } = attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    expect(alive(pid)).toBe(true);
    client.close();
    expect(await until(() => !alive(pid))).toBe(true);
    await close();
  }, 15000);

  it('process ตายแล้ว ws ถูกปิดด้วย code 1000', async () => {
    const { server, client, close } = await pair();
    const closed = new Promise<number>(r => client.once('close', c => r(c)));
    attachPty(server, { shellCmd: 'bash', cols: 80, rows: 24 });
    client.send(Buffer.from('exit\n'));
    expect(await closed).toBe(1000);
    await close();
  }, 15000);
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าพัง**

Run: `pnpm vitest run server/pty.test.ts`
Expected: FAIL — resolve `./pty.js` ไม่ได้

- [ ] **Step 3: เขียน implementation**

```ts
// server/pty.ts
import * as pty from 'node-pty';
import type { WebSocket } from 'ws';

export interface PtyOptions {
  shellCmd: string;
  cols: number;
  rows: number;
}

const DEFAULT_DIMS = { cols: 80, rows: 24 };

function dim(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 1000 ? n : null;
}

export function parseDims(url: string): { cols: number; rows: number } {
  const q = new URL(url, 'http://localhost').searchParams;
  const cols = dim(q.get('cols'));
  const rows = dim(q.get('rows'));
  return cols !== null && rows !== null ? { cols, rows } : { ...DEFAULT_DIMS };
}

export function attachPty(ws: WebSocket, opts: PtyOptions): { pid: number } {
  const [cmd, ...args] = opts.shellCmd.split(/\s+/) as [string, ...string[]];

  const term = pty.spawn(cmd, args, {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { term.kill('SIGHUP'); } catch { /* ตายไปแล้ว */ }
  };

  term.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'));
  });

  term.onExit(({ exitCode }) => {
    disposed = true;
    if (ws.readyState === ws.OPEN) ws.close(1000, `exit:${exitCode}`);
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      term.write(Buffer.from(raw as Buffer).toString('utf8'));
      return;
    }
    // text frame = control JSON
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.t === 'resize') {
        const cols = dim(String(msg.cols));
        const rows = dim(String(msg.rows));
        if (cols !== null && rows !== null) term.resize(cols, rows);
      }
    } catch {
      // control frame ที่พัง — ทิ้งไปเงียบๆ ไม่ควรทำให้ session ตาย
    }
  });

  ws.on('close', dispose);
  ws.on('error', dispose);

  return { pid: term.pid };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `pnpm vitest run server/pty.test.ts`
Expected: PASS 11 tests

- [ ] **Step 5: Commit**

```bash
git add server/pty.ts server/pty.test.ts
git commit -m "feat(server): PTY ผูกกับ ws สองทาง พร้อม TERM และ resize"
```

---

### Task 7: `server/index.ts` — HTTP, upgrade guard, บังคับ session เดียว

**Files:**
- Create: `server/index.ts`, `server/index.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `verifyPassword`/`signSession`/`verifySession`/`parseCookie`/`COOKIE_NAME`/`SESSION_TTL_MS`, `createLoginLimiter`, `attachPty`/`parseDims`
- Produces:
  ```ts
  export function createServer(cfg: Config): {
    listen(port: number): Promise<void>;
    close(): Promise<void>;
  };
  ```
  Routes: `POST /api/login` · `POST /api/logout` · `GET /*` static จาก `dist/web` · `WS /pty`

**บังคับ session เดียว:** เก็บ ws ที่ active ไว้ตัวเดียว connection ใหม่เข้ามาให้ปิดตัวเก่าด้วย `ws.close(4000, 'superseded')` ถ้าไม่ทำ แท็บ desktop ที่ลืมปิดกับมือถือจะเป็น herdr client สองตัวที่แย่ง resize กันไปมา แล้วจะดูเหมือน "จอเพี้ยนสุ่มๆ"

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน**

```ts
// server/index.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from './index.js';
import { signSession } from './auth.js';

const cfg = {
  password: 'hunter2',
  sessionSecret: 'test-secret',
  shellCmd: 'bash',
  port: 0,
  allowedOrigins: ['http://localhost:5173'],
};

const PORT = 7345;
const ORIGIN = 'http://localhost:5173';
const base = `http://127.0.0.1:${PORT}`;
let srv: ReturnType<typeof createServer>;

beforeAll(async () => { srv = createServer(cfg); await srv.listen(PORT); });
afterAll(async () => { await srv.close(); });

const login = (password: string) =>
  fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ password }),
  });

const goodCookie = () =>
  `bc_session=${signSession(cfg.sessionSecret, Date.now() + 3_600_000)}`;

function openWs(headers: Record<string, string>): Promise<
  { ok: true; ws: WebSocket } | { ok: false; status: number }
> {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty?cols=80&rows=24`, { headers });
    ws.once('open', () => resolve({ ok: true, ws }));
    ws.once('unexpected-response', (_req, res) => resolve({ ok: false, status: res.statusCode! }));
    ws.once('error', () => resolve({ ok: false, status: 0 }));
  });
}

describe('POST /api/login', () => {
  it('รหัสถูกต้องได้ 200 พร้อม Set-Cookie ที่มี HttpOnly', async () => {
    const res = await login('hunter2');
    expect(res.status).toBe(200);
    const c = res.headers.get('set-cookie')!;
    expect(c).toContain('bc_session=');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
  });

  it('รหัสผิดได้ 401', async () => {
    expect((await login('wrong')).status).toBe(401);
  });

  it('ผิดซ้ำเกินลิมิตได้ 429', async () => {
    for (let i = 0; i < 12; i++) await login('wrong');
    expect((await login('wrong')).status).toBe(429);
    // ถูกบล็อกแล้วคือบล็อก ไม่สนว่ารหัสถูกหรือผิด — guard เช็ค isBlocked ก่อน verify
    // เสมอ นี่เป็นพฤติกรรมที่ตั้งใจของ rate limit
    expect((await login('hunter2')).status).toBe(429);
  });
});

describe('WS /pty guard', () => {
  it('ไม่มี cookie ถูกปฏิเสธด้วย 401', async () => {
    const r = await openWs({ origin: ORIGIN });
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it('cookie ปลอมถูกปฏิเสธด้วย 401', async () => {
    const r = await openWs({ origin: ORIGIN, cookie: 'bc_session=garbage' });
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it('Origin ไม่อยู่ในลิสต์ถูกปฏิเสธด้วย 403', async () => {
    const r = await openWs({ origin: 'https://evil.example', cookie: goodCookie() });
    expect(r).toEqual({ ok: false, status: 403 });
  });

  it('cookie และ origin ถูกต้อง เปิดได้', async () => {
    const r = await openWs({ origin: ORIGIN, cookie: goodCookie() });
    expect(r.ok).toBe(true);
    if (r.ok) r.ws.close();
  });
});

describe('บังคับ session เดียว', () => {
  it('connection ใหม่เตะตัวเก่าออกด้วย code 4000', async () => {
    const first = await openWs({ origin: ORIGIN, cookie: goodCookie() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const kicked = new Promise<number>(r => first.ws.once('close', c => r(c)));
    const second = await openWs({ origin: ORIGIN, cookie: goodCookie() });
    expect(second.ok).toBe(true);

    expect(await kicked).toBe(4000);
    if (second.ok) second.ws.close();
  }, 10000);
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าพัง**

Run: `pnpm vitest run server/index.test.ts`
Expected: FAIL — resolve `./index.js` ไม่ได้

- [ ] **Step 3: เขียน implementation**

```ts
// server/index.ts
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig, type Config } from './config.js';
import {
  COOKIE_NAME, SESSION_TTL_MS,
  parseCookie, signSession, verifyPassword, verifySession,
} from './auth.js';
import { createLoginLimiter } from './ratelimit.js';
import { attachPty, parseDims } from './pty.js';

const STATIC_ROOT = new URL('../web/', import.meta.url).pathname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new Error('body ใหญ่เกินไป');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function cookieHeader(token: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

export function createServer(cfg: Config) {
  const limiter = createLoginLimiter();
  let active: WebSocket | null = null;

  const originAllowed = (origin: string | undefined): boolean =>
    !!origin && cfg.allowedOrigins.includes(origin);

  const sessionValid = (req: IncomingMessage): boolean => {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    return !!token && verifySession(cfg.sessionSecret, token, Date.now());
  };

  function serveStatic(url: string, res: ServerResponse): void {
    const rel = normalize(url.split('?')[0]!).replace(/^(\.\.[/\\])+/, '');
    let file = join(STATIC_ROOT, rel === '/' ? 'index.html' : rel);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(STATIC_ROOT, 'index.html'); // SPA fallback
    }
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }

  const http = createHttpServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/login') {
      const now = Date.now();
      if (limiter.isBlocked(now)) { res.writeHead(429).end('ลองใหม่ภายหลัง'); return; }
      let password = '';
      try {
        const body = await readJsonBody(req) as { password?: string };
        password = body.password ?? '';
      } catch { /* body พัง = ถือว่ารหัสผิด */ }

      if (!verifyPassword(password, cfg.password)) {
        limiter.recordFailure(now);
        res.writeHead(401).end('เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
      limiter.reset();
      const token = signSession(cfg.sessionSecret, now + SESSION_TTL_MS);
      res.writeHead(200, { 'set-cookie': cookieHeader(token, SESSION_TTL_MS / 1000) }).end('ok');
      return;
    }

    if (req.method === 'POST' && req.url === '/api/logout') {
      res.writeHead(200, { 'set-cookie': cookieHeader('', 0) }).end('ok');
      return;
    }

    if (req.method === 'GET') { serveStatic(req.url ?? '/', res); return; }
    res.writeHead(405).end('method not allowed');
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const reject = (code: number, text: string) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };

    if (!url.startsWith('/pty')) return reject(404, 'Not Found');
    if (!originAllowed(req.headers.origin)) return reject(403, 'Forbidden');
    if (!sessionValid(req)) return reject(401, 'Unauthorized');

    wss.handleUpgrade(req, socket, head, ws => {
      // บังคับ session เดียว: เตะตัวเก่าออกก่อนเสมอ
      if (active && active.readyState === active.OPEN) {
        active.close(4000, 'superseded');
      }
      active = ws;
      ws.on('close', () => { if (active === ws) active = null; });

      const { cols, rows } = parseDims(url);
      attachPty(ws, { shellCmd: cfg.shellCmd, cols, rows });
    });
  });

  return {
    listen: (port: number) =>
      new Promise<void>(r => http.listen(port, '127.0.0.1', () => r())),
    close: () =>
      new Promise<void>(r => { wss.close(); http.close(() => r()); }),
  };
}

// entrypoint — ไม่รันตอน import จากเทส
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const cfg = loadConfig(process.env);
  const server = createServer(cfg);
  await server.listen(cfg.port);
  console.log(`browser-console ฟังอยู่ที่ http://127.0.0.1:${cfg.port} (shell: ${cfg.shellCmd})`);
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `pnpm vitest run server/index.test.ts`
Expected: PASS 8 tests

- [ ] **Step 5: รันเทสทั้งหมดรวมกันให้แน่ใจว่าไม่มีอะไรพังข้ามไฟล์**

Run: `pnpm test`
Expected: PASS ทั้งหมด (config 6 · auth 12 · ratelimit 6 · input-pipeline 25 · pty 11 · index 8)

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/index.test.ts
git commit -m "feat(server): HTTP routes, upgrade guard, บังคับ session เดียว"
```

---

### Task 8: `web/keybar.ts` + `web/viewport.ts` — ชั้น DOM ของ UX มือถือ

**Files:**
- Create: `web/keybar.ts`, `web/viewport.ts`

**Interfaces:**
- Consumes: `BarKey` จาก `web/input-pipeline.ts`
- Produces:
  ```ts
  // keybar.ts
  export function mountKeybar(container: HTMLElement, handlers: {
    onKey: (key: BarKey) => void;
    modifierState: () => { ctrl: boolean; alt: boolean };
  }): void;

  // viewport.ts
  export function watchViewport(onChange: () => void): () => void;  // คืนฟังก์ชัน unsubscribe
  ```

**สองบั๊กที่ต้องกันตั้งแต่เขียนบรรทัดแรก:**
1. **focus** — ปุ่มบนแถบต้อง `preventDefault()` ใน `pointerdown` (ไม่ใช่ `click`) ถ้าไม่ทำ การแตะ `[Ctrl]` จะย้าย focus ออกจาก hidden textarea ของ xterm แล้ว Android ปิดคีย์บอร์ดทันที ยังไม่ทันพิมพ์ตัวถัดไป — ฟีเจอร์หลักของแอปพังจากบั๊กบรรทัดเดียว `click` มาหลัง focus ย้ายไปแล้วจึงสายเกินไป
2. **viewport** — บน Android Chrome คีย์บอร์ดที่โผล่ขึ้นมาไม่ทำให้ layout viewport หด `position: fixed; bottom: 0` จะไปอยู่ใต้คีย์บอร์ด ต้องอ่าน `window.visualViewport` เอง

- [ ] **Step 1: เขียน `web/viewport.ts`**

```ts
// web/viewport.ts
/**
 * เรียก onChange ทุกครั้งที่พื้นที่ที่มองเห็นจริงเปลี่ยน (คีย์บอร์ดเปิด/ปิด, หมุนจอ, zoom)
 * พร้อมอัปเดต CSS variable ที่ layout ใช้ยึดแถวปุ่มไว้เหนือคีย์บอร์ด
 */
export function watchViewport(onChange: () => void): () => void {
  const vv = window.visualViewport;

  let timer: number | undefined;
  const debounced = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 100);
  };

  const apply = () => {
    const height = vv?.height ?? window.innerHeight;
    // ระยะจากขอบล่างของ layout viewport ถึงขอบล่างของพื้นที่ที่มองเห็น = ความสูงคีย์บอร์ด
    const inset = Math.max(0, window.innerHeight - height - (vv?.offsetTop ?? 0));
    document.documentElement.style.setProperty('--visible-height', `${height}px`);
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
    debounced();
  };

  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', apply);

  return () => {
    window.clearTimeout(timer);
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
```

- [ ] **Step 2: เขียน `web/keybar.ts`**

```ts
// web/keybar.ts
import type { BarKey } from './input-pipeline.js';

interface ButtonSpec { label: string; key: BarKey }

const BUTTONS: ButtonSpec[] = [
  { label: 'Esc',  key: { kind: 'literal', data: '\x1b' } },
  { label: 'Tab',  key: { kind: 'literal', data: '\t' } },
  { label: 'Ctrl', key: { kind: 'modifier', name: 'ctrl' } },
  { label: 'Alt',  key: { kind: 'modifier', name: 'alt' } },
  { label: '↑',    key: { kind: 'literal', data: '\x1b[A' } },
  { label: '↓',    key: { kind: 'literal', data: '\x1b[B' } },
  { label: '←',    key: { kind: 'literal', data: '\x1b[D' } },
  { label: '→',    key: { kind: 'literal', data: '\x1b[C' } },
  { label: '|',    key: { kind: 'literal', data: '|' } },
  { label: '~',    key: { kind: 'literal', data: '~' } },
  { label: '/',    key: { kind: 'literal', data: '/' } },
  { label: '-',    key: { kind: 'literal', data: '-' } },
  { label: '^C',   key: { kind: 'interrupt' } },
];

export function mountKeybar(container: HTMLElement, handlers: {
  onKey: (key: BarKey) => void;
  modifierState: () => { ctrl: boolean; alt: boolean };
}): void {
  container.replaceChildren();
  const modifierButtons = new Map<'ctrl' | 'alt', HTMLButtonElement>();

  const refresh = () => {
    const state = handlers.modifierState();
    modifierButtons.get('ctrl')?.classList.toggle('active', state.ctrl);
    modifierButtons.get('alt')?.classList.toggle('active', state.alt);
  };

  for (const spec of BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'keybar-btn';
    btn.textContent = spec.label;

    // สำคัญที่สุดในไฟล์นี้: กัน focus ย้ายออกจาก terminal
    // ไม่งั้นคีย์บอร์ด Android จะปิดทุกครั้งที่แตะปุ่ม
    btn.addEventListener('pointerdown', e => e.preventDefault());

    btn.addEventListener('click', () => {
      handlers.onKey(spec.key);
      refresh();
    });

    if (spec.key.kind === 'modifier') modifierButtons.set(spec.key.name, btn);
    container.appendChild(btn);
  }

  refresh();
}
```

- [ ] **Step 3: ยืนยันว่า TypeScript ผ่าน**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: ไม่มี error

- [ ] **Step 4: Commit**

```bash
git add web/keybar.ts web/viewport.ts
git commit -m "feat(web): แถวปุ่มมือถือที่ไม่ทำให้คีย์บอร์ดปิด และตัวจัดการ visualViewport"
```

---

### Task 9: `web/main.ts` + HTML/CSS — ประกอบทั้งหมด

**Files:**
- Create: `web/index.html`, `web/style.css`, `web/main.ts`

**Interfaces:**
- Consumes: `createInputPipeline` · `mountKeybar` · `watchViewport` · endpoints `POST /api/login`, `WS /pty?cols=&rows=`
- Produces: หน้าเว็บที่ใช้งานได้จริง

**ลำดับตอน connect — สลับกันไม่ได้:** `cols/rows` ต้องรู้ก่อนเปิด ws และการจะรู้ต้อง `fit()` ซึ่งต้องการ element ที่มีขนาดจริงแล้ว ถ้าเรียก `fit()` ตอน container ยังซ่อนอยู่หลังหน้า login จะได้ค่า default 80×24 กลับมาแบบเงียบๆ ไม่มี error

```
1. ซ่อนหน้า login / แสดง container ให้มีขนาดจริง
2. term.open(container)
3. รอ 1 เฟรม (requestAnimationFrame)
4. fitAddon.fit()
5. อ่าน term.cols / term.rows
6. เปิด ws พร้อม ?cols=&rows=
```
ใช้ลำดับเดียวกันซ้ำตอน reconnect — จออาจหมุนไปแล้วระหว่างที่หลุด

- [ ] **Step 1: เขียน `web/index.html`**

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>browser-console</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div id="login" class="login">
    <form id="login-form">
      <h1>browser-console</h1>
      <input id="password" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" required>
      <button type="submit">เข้าสู่ระบบ</button>
      <p id="login-error" class="error" hidden></p>
    </form>
  </div>

  <div id="app" class="app" hidden>
    <div id="status" class="status" hidden></div>
    <div id="terminal" class="terminal"></div>
    <div id="keybar" class="keybar"></div>
  </div>

  <script type="module" src="./main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: เขียน `web/style.css`**

```css
:root {
  --bg: #101014;
  --fg: #d8d8e0;
  --accent: #6ea8fe;
  --visible-height: 100dvh;
  --keyboard-inset: 0px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, sans-serif;
  overscroll-behavior: none;
}

.login { display: grid; place-items: center; height: 100dvh; padding: 1rem; }
.login form { display: grid; gap: .75rem; width: min(20rem, 100%); }
.login input, .login button {
  padding: .75rem; font-size: 1rem; border-radius: .5rem; border: 1px solid #333;
  background: #1b1b22; color: var(--fg);
}
.login button { background: var(--accent); color: #04121f; border: 0; font-weight: 600; }
.error { color: #ff8080; margin: 0; }

/* ใช้ --visible-height ที่ viewport.ts เขียนให้ ไม่ใช่ 100vh
   เพราะคีย์บอร์ด Android ไม่หด layout viewport */
.app {
  display: flex;
  flex-direction: column;
  height: var(--visible-height);
}

.status {
  padding: .4rem .75rem; background: #3a2a12; color: #ffd79a;
  font-size: .85rem; text-align: center;
}

.terminal { flex: 1; min-height: 0; padding: .25rem; }

.keybar {
  display: flex; gap: .35rem;
  padding: .4rem .5rem calc(.4rem + env(safe-area-inset-bottom));
  overflow-x: auto;
  background: #17171d;
  border-top: 1px solid #2a2a33;
  -webkit-overflow-scrolling: touch;
}
.keybar::-webkit-scrollbar { display: none; }

.keybar-btn {
  flex: 0 0 auto;
  min-width: 2.75rem; min-height: 2.75rem;   /* touch target ขั้นต่ำ */
  border-radius: .5rem; border: 1px solid #33333f;
  background: #21212a; color: var(--fg);
  font-size: 1rem; font-family: ui-monospace, monospace;
  touch-action: manipulation;
}
.keybar-btn.active { background: var(--accent); color: #04121f; border-color: var(--accent); }
```

- [ ] **Step 3: เขียน `web/main.ts`**

```ts
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { createInputPipeline } from './input-pipeline.js';
import { mountKeybar } from './keybar.js';
import { watchViewport } from './viewport.js';

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

function initTerminal(): { term: Terminal; fit: FitAddon } {
  const t = new Terminal({
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
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

  t.onData(data => pipeline.onTerminalData(data));

  mountKeybar($('keybar'), {
    onKey: key => pipeline.onBarKey(key),
    modifierState: () => pipeline.modifierState(),
  });

  return { term: t, fit };
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
    term!.focus();
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
      showStatus('shell ปิดแล้ว — โหลดหน้านี้ใหม่เพื่อเริ่มใหม่');
      return;
    }
    showStatus(`กำลังต่อใหม่ใน ${Math.round(backoffMs / 1000)} วิ…`);
    setTimeout(() => { void connect(); }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 8000);
  };
}

function sendResize(): void {
  if (!term || !fitAddon || ws?.readyState !== WebSocket.OPEN) return;
  fitAddon.fit();
  ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
}

async function startSession(): Promise<void> {
  loginPage.hidden = true;
  appPage.hidden = false;          // ต้องแสดงก่อน terminal จึงจะมีขนาดจริง

  const created = initTerminal();
  term = created.term;
  fitAddon = created.fit;

  watchViewport(sendResize);
  await connect();
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;
  const password = $<HTMLInputElement>('password').value;

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (res.ok) { await startSession(); return; }
  errorEl.textContent = res.status === 429
    ? 'ลองผิดบ่อยเกินไป รอสักครู่แล้วลองใหม่'
    : 'รหัสผ่านไม่ถูกต้อง';
  errorEl.hidden = false;
});
```

- [ ] **Step 4: ยืนยัน type และ build ผ่าน**

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm build
```
Expected: ไม่มี error และมี `dist/web/index.html` กับ `dist/server/index.js`

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/style.css web/main.ts
git commit -m "feat(web): หน้า login, terminal, reconnect และลำดับ fit ก่อนเปิด ws"
```

---

### Task 10: ยืนยันของจริง แล้ว deploy

**Files:**
- Create: `browser-console.service`, `README.md`, `.env`

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า
- Produces: service ที่รันอยู่จริงและเข้าถึงได้จากมือถือ

- [ ] **Step 1: สร้าง `.env` จริง**

```bash
cd /home/user/development/browser-console
cp .env.example .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
```
แล้วแก้ `CONSOLE_PASSWORD` ในไฟล์ `.env` ด้วยมือ (`.env` อยู่ใน `.gitignore` แล้ว)

- [ ] **Step 2: รันแบบ dev แล้วยืนยันว่า herdr ขึ้นจริง**

```bash
pnpm build && node --env-file=.env dist/server/index.js
```
เปิดอีก terminal:
```bash
curl -si -X POST http://127.0.0.1:7000/api/login \
  -H 'content-type: application/json' -H 'origin: http://localhost:5173' \
  -d '{"password":"<รหัสที่ตั้งไว้>"}' | head -5
```
Expected: `HTTP/1.1 200 OK` และมี `set-cookie: bc_session=…`

- [ ] **Step 3: ยืนยันว่า herdr ปล่อย state สะอาดตอน PTY ตาย**

นี่คือข้อเดียวที่ review รอบ 3 ยืนยันจากนอกเครื่องไม่ได้ ถ้าพลาดอาการจะเป็น "reconnect แล้วจอเพี้ยน" ซึ่งกลืนกับปัญหาหลาย session จนแยกไม่ออก

```bash
herdr status server          # จดจำนวน client ก่อน
# เปิดหน้าเว็บ → herdr ขึ้นมา
herdr status server          # ต้องเพิ่ม 1
# ปิดแท็บเบราว์เซอร์
sleep 2
herdr status server          # ต้องลดกลับเท่าเดิม
```
ถ้าจำนวนไม่ลด: PTY ถูกฆ่าแล้วแต่ herdr server ยังคิดว่ามี client อยู่ ให้แก้ `dispose()` ใน `server/pty.ts` ให้ส่ง detach ก่อน kill แล้วรัน `pnpm vitest run server/pty.test.ts` ซ้ำให้ยังผ่าน

- [ ] **Step 4: เปิด `tailscale serve`**

```bash
tailscale serve --bg --https=8443 7000
tailscale serve status
```
Expected: `https://example-host.tailnet.ts.net:8443 → proxy http://127.0.0.1:7000`
(ยืนยันแล้วในรอบ review ที่ 3 ว่า WebSocket, query string, `Origin` และ `Cookie` ผ่าน proxy นี้ครบ — ไม่ต้องทดสอบซ้ำ)

- [ ] **Step 5: สร้าง systemd user service**

`browser-console.service`:
```ini
[Unit]
Description=browser-console — web terminal over Tailscale
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/development/browser-console
ExecStart=/usr/bin/env node --env-file=%h/development/browser-console/.env %h/development/browser-console/dist/server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
mkdir -p ~/.config/systemd/user
cp browser-console.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now browser-console
systemctl --user status browser-console --no-pager
```
Expected: `active (running)` — `Linger=yes` เปิดอยู่แล้วบนเครื่องนี้ service จึงอยู่ต่อหลัง logout

- [ ] **Step 6: manual test บนมือถือจริง — checklist**

เปิด `https://example-host.tailnet.ts.net:8443` บน Chrome Android แล้วไล่ทีละข้อ:

1. [ ] เข้าสู่ระบบด้วยรหัสผ่านได้ และ `herdr` ขึ้นมาเองโดยไม่ต้องพิมพ์
2. [ ] **กด `[Ctrl]` แล้วคีย์บอร์ดต้องไม่ปิด** (ถ้าปิด = `pointerdown` preventDefault ไม่ทำงาน)
3. [ ] ลูกศรขยับ pane ใน herdr ได้ และขยับ cursor ใน `vim` ได้จริง
4. [ ] `Ctrl` + `←` เลื่อนทีละคำใน shell prompt ได้
5. [ ] แถวปุ่มยังมองเห็นตลอดขณะคีย์บอร์ดเปิด
6. [ ] หมุนจอแล้ว terminal ยัง fit ถูก ไม่มีข้อความล้นขอบ
7. [ ] ปิด/เปิด wifi → reconnect แล้วกลับเข้า herdr session เดิมเอง
8. [ ] เปิดบน desktop ค้างไว้แล้วเปิดบนมือถือ → desktop ขึ้น "เปิดที่อื่นแล้ว" มือถือใช้งานได้ปกติ

- [ ] **Step 7: เขียน `README.md`**

```markdown
# browser-console

เว็บเทอร์มินัลเข้าถึง shell ของเครื่องนี้ผ่าน Tailscale — ออกแบบมาเพื่อใช้บนมือถือ
โดยเฉพาะ มีแถวปุ่ม `Esc`/`Ctrl`/`Alt`/ลูกศร ที่คีย์บอร์ด Android ไม่มี

- **Design:** `docs/2026-08-16-browser-console-design.md`
- **Review 3 รอบ:** `docs/2026-08-16-mvp-design-review.md`
- **Plan:** `docs/superpowers/plans/2026-08-16-browser-console-mvp.md`

## เข้าใช้งาน

https://example-host.tailnet.ts.net:8443 (ในเครือข่าย Tailscale เท่านั้น)

## รันเอง

```bash
pnpm install
cp .env.example .env    # แล้วตั้ง CONSOLE_PASSWORD และ SESSION_SECRET
pnpm build
node --env-file=.env dist/server/index.js
tailscale serve --bg --https=8443 7000
```

## สิ่งที่ต้องรู้

- **อัปเกรด Node แล้วต้อง `pnpm rebuild`** — `node-pty` เป็น native module
  ถ้าไม่ rebuild service จะพังด้วย `NODE_MODULE_VERSION mismatch` ที่อ่านไม่รู้เรื่อง
- persistence เป็นหน้าที่ของ `herdr` ไม่ใช่ของ proxy นี้ — ปิดเว็บ = PTY ตาย
  แต่ herdr server ยังอยู่ เปิดใหม่แล้ว attach กลับ session เดิม
- **session เดียวเท่านั้น** เปิดที่ใหม่จะเตะที่เก่าออก (โดยตั้งใจ)
- rate limit ของ login เป็น **global** โดยตั้งใจ — server อยู่หลัง proxy ทุก request
  จึงมาจาก `127.0.0.1` เสมอ bucket ต่อ IP ไม่มีความหมาย

## เทส

```bash
pnpm test
```
```

- [ ] **Step 8: Commit**

```bash
git add browser-console.service README.md
git commit -m "chore: systemd user service, tailscale serve, README"
```

---

## Self-Review

**Spec coverage** — ไล่ทุกหัวข้อของ `docs/2026-08-16-browser-console-design.md` rev 3:

| หัวข้อใน spec | Task |
|---|---|
| Dependencies + ห้ามใช้ addon-attach/webgl | 1, Global Constraints |
| สถาปัตยกรรม + `tailscale serve` | 10 |
| PTY lifecycle สองทาง | 6 |
| บังคับ session เดียว (code 4000) | 7 |
| ยืนยัน herdr detach บน SIGHUP | 10 Step 3 |
| Reconnect + `term.reset()` | 9 |
| env `TERM`/`COLORTERM` | 6 |
| ขนาดจอตอน spawn + ลำดับบังคับ | 6 (`parseDims`), 9 (`connect`) |
| Wire protocol binary/text | 6, 9 |
| โครงไฟล์ | File Structure |
| แถวปุ่ม + `BarKey` สองชนิด | 5, 8 |
| sticky modifier + CSI/SS3 + โหมด cursor | 5 |
| Focus / `pointerdown` | 8 |
| Layout / `visualViewport` | 8, 9 |
| Auth + 3 guard + logout + `ALLOWED_ORIGINS` list | 3, 4, 7 |
| Error handling ทั้งตาราง | 7, 9 |
| Build & deploy + `pnpm rebuild` | 1, 10 |
| Testing ทั้งตาราง + manual checklist | ทุก task, 10 Step 6 |

ไม่มีหัวข้อไหนไม่มี task รองรับ

**Placeholder scan** — ไม่มี `TBD`/`TODO`/"similar to Task N" ทุก step ที่เป็นโค้ดมี code block จริงที่รันได้

**Type consistency** — ตรวจชื่อข้ามไฟล์แล้ว: `Config` (Task 2 → 7) · `COOKIE_NAME`/`SESSION_TTL_MS`/`signSession`/`verifySession`/`verifyPassword`/`parseCookie` (Task 3 → 7) · `createLoginLimiter` (4 → 7) · `attachPty`/`parseDims`/`PtyOptions` (6 → 7) · `BarKey`/`Modes`/`createInputPipeline` (5 → 8, 9) · `mountKeybar` (8 → 9) · `watchViewport` (8 → 9) · `--visible-height`/`--keyboard-inset` (viewport.ts → style.css) ทั้งหมดตรงกัน

**Wire protocol ในเทส** — เทสของ Task 6 ส่ง input ของ shell เป็น **binary frame** (`client.send(Buffer.from(…))`) และส่ง resize เป็น **text frame** (`client.send(JSON.stringify(…))`) ตรงตามโปรโตคอลใน spec ถ้าเผลอส่ง input เป็น text frame จะเข้า branch JSON แล้วถูกกลืนเงียบๆ เทสจะ timeout โดยไม่มี error ที่อธิบายอะไร
