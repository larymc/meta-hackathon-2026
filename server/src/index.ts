import { buildApp } from "./app.js";
import { config } from "./config.js";
const app = buildApp();
await app.listen({ port: config.port, host: config.host });
console.log(`Relais API on http://${config.host}:${config.port} (mode via /api/health)`);
