import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { dependencias } from './entorno.js';
import { crearServidor } from './servidor.js';

const deps = dependencias('http');
// La fábrica se ejecuta una vez por petición HTTP: no hay nada que recordar entre dos POST.
const handler = createMcpHandler(() => crearServidor(deps));

const app = createMcpExpressApp(); // express.json() y validación de Host y Origin
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));

const PORT = Number(process.env.PORT ?? 3000);
const httpServer = app.listen(PORT, '127.0.0.1', () => {
    console.error(`nortia-pedidos (${deps.inquilino}) en http://127.0.0.1:${PORT}/mcp`);
});

process.on('SIGTERM', async () => {
    await handler.close();
    httpServer.close();
});
