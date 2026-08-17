import { readFileSync, writeFileSync } from 'node:fs';

/**
 * ตัวนับที่ทำให้ logout เพิกถอน session ได้จริง
 *
 * เก็บลงไฟล์โดยตั้งใจ ไม่ใช่ในหน่วยความจำ — จุดขายทั้งหมดของ cookie อายุยาวคือ
 * ไม่ต้องพิมพ์รหัสบนมือถือบ่อยๆ ถ้า `systemctl restart` หรือ reboot แล้วทุกคนหลุด
 * ฟีเจอร์นั้นก็ตายไปด้วย
 *
 * เขียนไฟล์ไม่ได้ก็ยังทำงานต่อ (เช่นใน container ที่ filesystem อ่านอย่างเดียว)
 * แต่เตือนให้เห็น เพราะผลคือ logout จะไม่รอด restart ซึ่งผู้ใช้ควรรู้ ไม่ใช่เดาเอง
 */
export function createEpochStore(file: string, log: (msg: string) => void = console.warn) {
  let epoch = 0;
  try {
    const raw = readFileSync(file, 'utf8').trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) epoch = n;
  } catch {
    // ยังไม่มีไฟล์ = ยังไม่เคย logout ซึ่งเป็นเรื่องปกติ ไม่ต้องเตือน
  }

  return {
    current: (): number => epoch,
    /** เพิ่มค่า = token ทุกใบที่เซ็นด้วย epoch เก่าใช้ไม่ได้ทันที */
    bump: (): number => {
      epoch += 1;
      try {
        writeFileSync(file, String(epoch), { mode: 0o600 });
      } catch (err) {
        log(
          `เขียน ${file} ไม่ได้ (${(err as Error).message}) — logout จะเพิกถอน session ` +
          `ได้เฉพาะจนกว่าจะ restart ครั้งถัดไป`,
        );
      }
      return epoch;
    },
  };
}
