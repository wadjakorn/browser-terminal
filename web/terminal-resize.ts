export function fitAndSendResize(
  fitAddon: { fit(): void },
  terminal: { cols: number; rows: number },
  socket: { readyState: number; send(data: string): void } | null,
): void {
  fitAddon.fit();
  if (socket?.readyState !== 1) return;
  socket.send(JSON.stringify({ t: 'resize', cols: terminal.cols, rows: terminal.rows }));
}
