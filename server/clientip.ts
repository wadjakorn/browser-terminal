/**
 * หา IP ของผู้เรียกจริง สำหรับใช้แยกถัง rate limit
 *
 * `X-Forwarded-For` เป็น header ที่ใครก็ปลอมได้ ถ้าเชื่อมันโดยไม่มีเงื่อนไข ผู้โจมตี
 * แค่ใส่ค่าสุ่มใหม่ทุก request ก็หนี rate limit ได้ทุกครั้ง — กลายเป็นว่าการแยกถัง
 * ตาม IP ทำให้แย่ลงกว่าไม่แยกเสียอีก จึงต้องให้ผู้ใช้ประกาศเองว่าอยู่หลัง proxy
 * ที่เชื่อได้ (`TRUST_PROXY=1`) ไม่ใช่เดาเอง
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddr: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const raw = headers['x-forwarded-for'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    // ตัวซ้ายสุดคือผู้เรียกเดิม ตัวถัดไปคือ proxy ที่ผ่านมาตามลำดับ
    const first = value?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socketAddr ?? '';
}
