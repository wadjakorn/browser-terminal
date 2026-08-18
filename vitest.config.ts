import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    // git worktree ของเครื่องมือ agent อยู่ใต้ .claude/worktrees/ ซึ่งเป็นสำเนา
    // ทั้ง repo — ถ้าไม่กันไว้ vitest จะรันชุดเทสซ้ำสองรอบ และแย่กว่านั้นคือ
    // worktree เก่าที่ลืมลบจะพาเทสของโค้ดเวอร์ชันอื่นเข้ามาปนในผลลัพธ์
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
