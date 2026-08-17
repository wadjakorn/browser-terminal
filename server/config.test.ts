import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

const full = {
  CONSOLE_PASSWORD: 'a-real-password', SESSION_SECRET: 'a'.repeat(32), SHELL_CMD: 'bash',
  PORT: '7000', PUBLIC_ORIGIN: 'https://a.example',
};

describe('loadConfig', () => {
  it('อ่านค่าครบ', () => {
    const c = loadConfig(full);
    expect(c.password).toBe('a-real-password');
    expect(c.port).toBe(7000);
    expect(c.publicOrigin).toBe('https://a.example');
  });

  it('SHELL_CMD default เป็น herdr', () => {
    const { SHELL_CMD, ...rest } = full;
    expect(loadConfig(rest).shellCmd).toBe('herdr');
  });

  it('PORT default เป็น 7000', () => {
    const { PORT, ...rest } = full;
    expect(loadConfig(rest).port).toBe(7000);
  });

  it('PORT ผิดรูป (ไม่ใช่จำนวนเต็มบวก) แล้ว throw พร้อมชื่อตัวแปร', () => {
    expect(() => loadConfig({ ...full, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...full, PORT: '-1' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...full, PORT: '1.5' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...full, PORT: '0' })).toThrow(/PORT/);
  });

  it('ขาดตัวแปรที่จำเป็นแล้ว throw พร้อมชื่อตัวแปร', () => {
    for (const key of ['CONSOLE_PASSWORD', 'SESSION_SECRET', 'PUBLIC_ORIGIN']) {
      const rest = { ...full } as Record<string, string>;
      delete rest[key];
      expect(() => loadConfig(rest)).toThrow(new RegExp(key));
    }
  });
});

describe('HOST — default ต้องปลอดภัย', () => {
  it('ไม่ตั้งอะไร = ผูกกับ loopback เท่านั้น', () => {
    expect(loadConfig(full).host).toBe('127.0.0.1');
  });

  it('ตั้งเองได้ สำหรับ container ที่ bind loopback ไม่ได้', () => {
    expect(loadConfig({ ...full, HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });
});

describe('cookieSecure — ตัดสินจาก PUBLIC_ORIGIN ไม่ใช่ HOST', () => {
  it('https = ใส่ธง Secure', () => {
    expect(loadConfig({ ...full, PUBLIC_ORIGIN: 'https://a.example' }).cookieSecure).toBe(true);
  });

  it('http = ห้ามใส่ธง Secure ไม่งั้นเบราว์เซอร์ทิ้ง cookie เงียบๆ', () => {
    const c = loadConfig({ ...full, PUBLIC_ORIGIN: 'http://localhost:7000' });
    expect(c.cookieSecure).toBe(false);
  });

  // เคสที่พลาดง่ายที่สุด: Docker ต้อง bind 0.0.0.0 เสมอ แต่ publish เฉพาะ loopback
  // ถ้าเอา HOST มาเป็นตัวชี้วัด กฎจะเด้งผิดกับการตั้งค่าที่ปลอดภัยที่สุด
  it('HOST=0.0.0.0 แต่เปิดผ่าน localhost = ยังไม่ต้องมี Secure และต้อง start ได้', () => {
    const c = loadConfig({ ...full, HOST: '0.0.0.0', PUBLIC_ORIGIN: 'http://localhost:7000' });
    expect(c.cookieSecure).toBe(false);
    expect(c.host).toBe('0.0.0.0');
  });
});

describe('origins ที่อนุญาต', () => {
  it('PUBLIC_ORIGIN ถูกอนุญาตเสมอโดยไม่ต้องประกาศซ้ำ', () => {
    expect(loadConfig(full).allowedOrigins).toEqual(['https://a.example']);
  });

  it('DEV_ORIGINS เพิ่มเข้ามาได้ตอนพัฒนา', () => {
    const c = loadConfig({ ...full, DEV_ORIGINS: 'http://localhost:5173' });
    expect(c.allowedOrigins).toEqual(['https://a.example', 'http://localhost:5173']);
  });

  // ถ้าข้อนี้พัง origin ของ dev จะใช้ได้จริงบนเครื่อง production โดยไม่มีใครรู้
  it('**DEV_ORIGINS ถูกเมินทั้งหมดเมื่อ NODE_ENV=production**', () => {
    const c = loadConfig({ ...full, DEV_ORIGINS: 'http://evil.example', NODE_ENV: 'production' });
    expect(c.allowedOrigins).toEqual(['https://a.example']);
  });

  it('ตัดช่องว่างและค่าว่างทิ้ง', () => {
    const c = loadConfig({ ...full, DEV_ORIGINS: ' http://a.test , , http://b.test ' });
    expect(c.allowedOrigins).toEqual(['https://a.example', 'http://a.test', 'http://b.test']);
  });
});

describe('ไม่ยอม start เมื่อ config อันตราย', () => {
  it('รหัสผ่านเป็นค่าตัวอย่าง = ไม่ยอม start', () => {
    expect(() => loadConfig({ ...full, CONSOLE_PASSWORD: 'changeme' })).toThrow(/CONSOLE_PASSWORD/);
  });

  it('รหัสผ่านสั้นเกินไป = ไม่ยอม start', () => {
    expect(() => loadConfig({ ...full, CONSOLE_PASSWORD: 'abc' })).toThrow(/CONSOLE_PASSWORD/);
  });

  it('SESSION_SECRET เป็นค่า placeholder หรือสั้นเกินไป = ไม่ยอม start', () => {
    expect(() => loadConfig({ ...full, SESSION_SECRET: 'generate-with-openssl-rand-hex-32' }))
      .toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...full, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('เสิร์ฟผ่าน http ไปยัง host ที่ไม่ใช่ loopback = ไม่ยอม start', () => {
    expect(() => loadConfig({ ...full, PUBLIC_ORIGIN: 'http://192.168.1.50:7000' }))
      .toThrow(/ALLOW_INSECURE/);
  });

  it('เปิด ALLOW_INSECURE เองอย่างจงใจ = ยอม แต่ไม่ใส่ธง Secure', () => {
    const c = loadConfig({ ...full, PUBLIC_ORIGIN: 'http://192.168.1.50:7000', ALLOW_INSECURE: '1' });
    expect(c.cookieSecure).toBe(false);
    expect(c.allowedOrigins).toEqual(['http://192.168.1.50:7000']);
  });

  it('http ไปยัง loopback ไม่ต้องขออนุญาต — เป็นกรณีปกติของ SSH tunnel', () => {
    for (const origin of ['http://localhost:7000', 'http://127.0.0.1:7000', 'http://[::1]:7000']) {
      expect(() => loadConfig({ ...full, PUBLIC_ORIGIN: origin })).not.toThrow();
    }
  });

  it('PUBLIC_ORIGIN ผิดรูป = throw พร้อมชื่อตัวแปร', () => {
    expect(() => loadConfig({ ...full, PUBLIC_ORIGIN: 'ไม่ใช่ url' })).toThrow(/PUBLIC_ORIGIN/);
    // ต้องเป็น origin เปล่าๆ ไม่ใช่ URL ที่มี path ติดมา ไม่งั้นเทียบกับ header ไม่ตรง
    expect(() => loadConfig({ ...full, PUBLIC_ORIGIN: 'https://a.example/path' })).toThrow(/PUBLIC_ORIGIN/);
  });
});

describe('ตัวเลือกสำหรับการเปิดสู่เครือข่ายจริง', () => {
  it('TRUST_PROXY ปิดไว้เป็น default — เชื่อ X-Forwarded-For เองไม่ได้', () => {
    expect(loadConfig(full).trustProxy).toBe(false);
    expect(loadConfig({ ...full, TRUST_PROXY: '1' }).trustProxy).toBe(true);
  });

  it('อายุ session default 30 วัน และตั้งเองได้', () => {
    expect(loadConfig(full).sessionTtlMs).toBe(30 * 24 * 3_600_000);
    expect(loadConfig({ ...full, SESSION_TTL_DAYS: '1' }).sessionTtlMs).toBe(24 * 3_600_000);
    expect(loadConfig({ ...full, SESSION_TTL_DAYS: '0.5' }).sessionTtlMs).toBe(12 * 3_600_000);
  });

  it('SESSION_TTL_DAYS ผิดรูป = throw พร้อมชื่อตัวแปร', () => {
    for (const bad of ['abc', '0', '-1']) {
      expect(() => loadConfig({ ...full, SESSION_TTL_DAYS: bad })).toThrow(/SESSION_TTL_DAYS/);
    }
  });
});
