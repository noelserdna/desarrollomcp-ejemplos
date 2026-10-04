import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { dependencias } from './entorno.js';
import { crearServidor } from './servidor.js';

const deps = dependencias('stdio'); // falla al arrancar si la configuración es inválida
const handle = serveStdio(() => crearServidor(deps));
console.error(`nortia-pedidos (${deps.inquilino}) escuchando por stdio`);

process.on('SIGINT', () => void handle.close());
