import { loadConfig } from './config.ts';
import { createChatServer } from './server.ts';

const config = loadConfig();
const chat = createChatServer(config);

chat.server.listen(config.port, config.host, () => {
  // Deliberately no request/IP/room logging – the server keeps no record of who talked.
  console.log(`quietroom relay listening on ${config.host}:${config.port}`);
  console.log(`allowed origins: ${[...config.allowedOrigins].join(', ')}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  await chat.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
