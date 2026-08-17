/**
 * สร้างค่า CONSOLE_PASSWORD แบบ hash
 *
 * รับรหัสผ่านทาง stdin ไม่ใช่ argument โดยตั้งใจ — argument จะไปโผล่ใน `ps` ให้ผู้ใช้
 * คนอื่นบนเครื่องเดียวกันเห็น และค้างอยู่ใน shell history ด้วย
 *
 *   pnpm hash-password
 */
import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../server/auth.js';

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = (await rl.question('รหัสผ่าน: ')).trim();
rl.close();

if (password.length < 8) {
  console.error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  process.exit(1);
}

// ลง stdout ล้วนๆ เพื่อให้ pipe ต่อได้ ส่วนคำอธิบายไป stderr
console.error('\nนำบรรทัดนี้ไปใส่ใน .env:\n');
console.log(`CONSOLE_PASSWORD=${hashPassword(password)}`);
