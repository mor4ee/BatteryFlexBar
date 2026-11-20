type SupervisedPlugin = {
  start(): void;
  transport?: {
    start(): void;
    ws?: { once(event: 'close', handler: () => void): unknown } | null;
  };
};

const started = new WeakSet<SupervisedPlugin>();

/** SDK 1.0.9 only: the host supervisor, not the old socket, owns restarts. */
export function startSupervisedPlugin(
  client: SupervisedPlugin,
  stop: () => void,
  exit: () => void
): void {
  if (started.has(client)) return;
  started.add(client);
  const transport = client.transport;
  if (transport) transport.start = transport.start.bind(transport);
  client.start();
  transport?.ws?.once('close', () => {
    try { stop(); } finally { exit(); }
  });
}
