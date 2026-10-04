import { McpServer, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { ESTADOS } from './pedidos.js';
import type { EstadoEnvio, Inquilino, Pedido, RepositorioPedidos } from './pedidos.js';

export interface EventoAuditoria {
    operacion: string;
    pedido: string;
    resultado: 'ok' | 'no_encontrado';
}

export interface Dependencias {
    repo: RepositorioPedidos;
    inquilino: Inquilino;
    auditar: (evento: EventoAuditoria) => void;
}

const idPedido = z
    .string()
    .regex(/^PED-\d{4}-\d{6}$/, 'Formato esperado: PED-AAAA-NNNNNN')
    .describe('Identificador del pedido, por ejemplo PED-2026-004812');

export const pedidoSchema = z.object({
    id: z.string(),
    estado: z.enum(Object.keys(ESTADOS) as [EstadoEnvio, ...EstadoEnvio[]]),
    almacen: z.string(),
    transportista: z.string(),
    entregaPrevista: z.string().describe('Fecha ISO, AAAA-MM-DD'),
    clienteRef: z.string()
});

// Lo que sale del servidor se elige campo a campo: el inquilino y las columnas futuras se quedan dentro.
function publico(pedido: Pedido): z.infer<typeof pedidoSchema> {
    const { id, estado, almacen, transportista, entregaPrevista, clienteRef } = pedido;
    return { id, estado, almacen, transportista, entregaPrevista, clienteRef };
}

const json = (uri: URL, datos: unknown) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(datos) }]
});

export function crearServidor({ repo, inquilino, auditar }: Dependencias): McpServer {
    const server = new McpServer({ name: 'nortia-pedidos', version: '1.4.0' });

    server.registerTool(
        'buscar_pedido',
        {
            title: 'Buscar pedido',
            description:
                'Devuelve estado, almacén, transportista y fecha prevista de entrega de un pedido ' +
                'de Nortia. Úsala cuando el usuario dé un identificador PED-AAAA-NNNNNN. ' +
                'No busca por cliente ni por fecha.',
            inputSchema: z.object({ pedido_id: idPedido }),
            outputSchema: pedidoSchema,
            annotations: { readOnlyHint: true, openWorldHint: false }
        },
        async ({ pedido_id }) => {
            const pedido = await repo.buscarPorId(inquilino, pedido_id);
            auditar({ operacion: 'buscar_pedido', pedido: pedido_id, resultado: pedido ? 'ok' : 'no_encontrado' });
            if (!pedido) {
                const text =
                    `No existe el pedido ${pedido_id} en este entorno. ` +
                    'Pide al usuario que confirme el identificador; no pruebes con otros.';
                return { content: [{ type: 'text', text }], isError: true };
            }
            const salida = publico(pedido);
            return { content: [{ type: 'text', text: JSON.stringify(salida) }], structuredContent: salida };
        }
    );

    server.registerResource(
        'estados-envio',
        'pedidos://catalogo/estados',
        { title: 'Estados de envío', description: 'Qué significa cada estado', mimeType: 'application/json' },
        async uri => json(uri, ESTADOS)
    );

    server.registerResource(
        'ficha-pedido',
        new ResourceTemplate('pedidos://pedido/{pedidoId}', {
            list: async () => {
                const recientes = await repo.listarRecientes(inquilino, 20);
                return {
                    resources: recientes.map(p => ({ uri: `pedidos://pedido/${p.id}`, name: `Pedido ${p.id}` }))
                };
            }
        }),
        { title: 'Ficha de pedido', description: 'Datos de un pedido', mimeType: 'application/json' },
        async (uri, variables) => {
            const id = String(variables.pedidoId);
            const pedido = await repo.buscarPorId(inquilino, id);
            auditar({ operacion: 'resources/read', pedido: id, resultado: pedido ? 'ok' : 'no_encontrado' });
            if (!pedido) throw new ResourceNotFoundError(uri.href);
            return json(uri, publico(pedido));
        }
    );

    server.registerPrompt(
        'respuesta_retraso',
        {
            title: 'Respuesta a un cliente por retraso',
            description: 'Borrador de respuesta de soporte sobre un pedido retrasado',
            argsSchema: z.object({ pedido_id: idPedido })
        },
        ({ pedido_id }) => {
            const text =
                `Consulta el pedido ${pedido_id} con buscar_pedido y redacta una respuesta al cliente sobre ` +
                'su retraso.\nNormas: indica el estado actual y la fecha prevista tal como constan; ' +
                'no prometas otra fecha; si el estado es "incidencia", ofrece abrir un ticket; ' +
                'no incluyas datos personales.';
            return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
        }
    );

    return server;
}
