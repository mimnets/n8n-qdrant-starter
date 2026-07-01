import { config } from './config/index.js';
import { createServer } from './server.js';

async function main() {
  const app = await createServer();
  await app.listen({ port: config.port, host: config.host });
  console.log(`CutEngine v0.1.0 listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
