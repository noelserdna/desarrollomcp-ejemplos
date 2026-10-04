// Dobles de nortia-pedidos y nortia-facturacion: datos en memoria, un proceso, dos endpoints MCP.
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const RETARDO_MS = Number(process.env.RETARDO_FACTURACION_MS ?? 0);
const pedidos = new Map([['PED-2026-004812', { estado: 'incidencia', factura: 'F-2026-0142', almacen: 'MAD-01' }]]);
const facturas = new Map([['F-2026-0142', { pedido: 'PED-2026-004812', total: 1210, moneda: 'EUR', abonado: 0 }]]);
const fallo = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
const json = (valor: object) => ({ content: [{ type: 'text' as const, text: JSON.stringify(valor) }] });

function nortiaPedidos(): McpServer {
    const server = new McpServer({ name: 'nortia-pedidos', version: '1.4.0' });
    server.registerTool(
        'buscar_pedido',
        {
            description: 'Devuelve estado, factura y almacén de un pedido. Formato del id: PED-2026-004812.',
            inputSchema: z.object({ pedido_id: z.string() }),
            annotations: { readOnlyHint: true }
        },
        async ({ pedido_id }) => {
            const pedido = pedidos.get(pedido_id);
            return pedido ? json({ id: pedido_id, ...pedido }) : fallo(`No existe el pedido ${pedido_id}. Formato esperado: PED-2026-004812.`);
        }
    );
    return server;
}

function nortiaFacturacion(): McpServer {
    const server = new McpServer({ name: 'nortia-facturacion', version: '1.4.0' });
    server.registerTool(
        'buscar_factura',
        {
            description: 'Devuelve total, moneda e importe ya abonado de una factura. Formato del id: F-2026-0142.',
            inputSchema: z.object({ factura_id: z.string() }),
            annotations: { readOnlyHint: true }
        },
        async ({ factura_id }) => {
            await new Promise(resolve => setTimeout(resolve, RETARDO_MS));
            const factura = facturas.get(factura_id);
            return factura ? json({ id: factura_id, ...factura }) : fallo(`No existe la factura ${factura_id}. Formato esperado: F-2026-0142.`);
        }
    );
    server.registerTool(
        'emitir_abono',
        {
            description: 'Emite un abono parcial o total sobre una factura. Tiene efecto contable inmediato.',
            inputSchema: z.object({ factura_id: z.string(), importe: z.number().positive(), motivo: z.string().min(10) }),
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
        },
        async ({ factura_id: id, importe, motivo }) => {
            await new Promise(resolve => setTimeout(resolve, RETARDO_MS));
            const factura = facturas.get(id);
            if (!factura) return fallo(`No existe la factura ${id}.`);
            const disponible = factura.total - factura.abonado;
            if (importe > disponible) return fallo(`El importe ${importe} supera lo abonable (${disponible} ${factura.moneda}).`);
            factura.abonado += importe;
            console.error(`[nortia-facturacion] abono de ${importe} ${factura.moneda} contabilizado en ${id}`);
            return json({ abono: 'R-2026-0017', factura: id, importe, moneda: factura.moneda, motivo });
        }
    );
    return server;
}

const app = createMcpExpressApp();
for (const [ruta, fabrica] of [['/pedidos/mcp', nortiaPedidos], ['/facturacion/mcp', nortiaFacturacion]] as const) {
    const node = toNodeHandler(createMcpHandler(fabrica));
    app.all(ruta, (req, res) => void node(req, res, req.body));
}
const PORT = Number(process.env.PORT ?? 3211);
app.listen(PORT, '127.0.0.1', () => console.error(`nortia-pedidos y nortia-facturacion en http://127.0.0.1:${PORT}`));
