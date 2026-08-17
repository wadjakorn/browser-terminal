# node-pty เป็น native module — ต้อง build บน image ที่มี toolchain แล้วค่อยย้าย
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim
WORKDIR /app

# รันด้วยผู้ใช้ธรรมดา ไม่ใช่ root — ใครที่ผ่านหน้า login ไปได้จะได้ shell
# ที่มีสิทธิ์เท่าผู้ใช้นี้ ถ้าเป็น root ก็คือยกเครื่องทั้งเครื่องให้
RUN useradd --create-home --shell /bin/bash console
COPY --from=build --chown=console:console /app/node_modules ./node_modules
COPY --from=build --chown=console:console /app/dist ./dist
COPY --from=build --chown=console:console /app/package.json ./
USER console

# ในคอนเทนเนอร์ต้อง bind 0.0.0.0 เสมอ — loopback ในนี้คือ loopback ของคอนเทนเนอร์เอง
# ไม่มีอะไรเข้าถึงได้แม้แต่ host ความปลอดภัยไปอยู่ที่การ publish port แทน:
#   docker run -p 127.0.0.1:7000:7000 ...
ENV HOST=0.0.0.0 PORT=7000 NODE_ENV=production
EXPOSE 7000
CMD ["node", "dist/server/index.js"]
