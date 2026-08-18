# Repository instructions

`AGENTS.md` is the canonical instruction file for AI coding agents in this repository. `CLAUDE.md` must remain a symlink to this file so all agents use the same guidance.

## Project

Browser Terminal is a security-sensitive TypeScript web terminal optimized for mobile browsers. The Node.js server exposes a local shell through a WebSocket, while the Vite frontend renders xterm.js and mobile input controls.

## Tooling and commands

- Use Node.js 22+ and pnpm.
- Install dependencies with `pnpm install`.
- Run the test suite with `pnpm test`.
- Build both frontend and server with `pnpm build`.
- Run development processes with `pnpm dev:server` and `DEV_ORIGINS=http://localhost:5173 pnpm dev:web`.
- Generate a password hash with `pnpm hash-password`; never pass passwords as command-line arguments.

## Structure

- `server/`: authentication, configuration, rate limiting, PTY, and WebSocket server code.
- `web/`: xterm.js UI, mobile keyboard controls, viewport handling, and touch gestures.
- `scripts/`: maintenance and operator utilities.
- `docs/`: design, review, and deployment/security notes.

## Development guidelines

- Treat authentication, cookies, origin validation, proxy trust, PTY access, and WebSocket handling as security-critical.
- Never commit `.env`, credentials, session secrets, password hashes, or other sensitive runtime data.
- Preserve the mobile interaction contract documented in `README.md`, especially explicit keyboard toggling, sticky modifiers, touch gestures, and responsive keybar pagination.
- Keep `web/keybar.ts` layout constants synchronized with the corresponding CSS values in `web/style.css`.
- Do not use `@xterm/addon-attach`; terminal input must pass through `web/input-pipeline.ts`.
- Add or update focused Vitest coverage for behavioral changes.
- Before considering a change complete, run `pnpm test` and `pnpm build` unless the change is documentation-only.
- Keep changes scoped and do not overwrite unrelated work in a dirty worktree.

## Documentation

Use `README.md` for operator and contributor guidance, `TODO.md` for deferred work, and the files under `docs/` for architectural context. Update documentation when behavior, configuration, deployment, or security assumptions change.
