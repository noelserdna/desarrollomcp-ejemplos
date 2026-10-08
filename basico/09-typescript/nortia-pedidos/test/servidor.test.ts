import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Client, InMemoryTransport, ProtocolError, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { RepositorioEnMemoria } from '../src/pedidos.js';
import { crearServidor, pedidoSchema } from '../src/servidor.js';
import type { EventoAuditoria } from '../src/servidor.js';

// Mismas dependencias que src/entorno.ts, pero la auditoría se guarda en un array para comprobarla.
let eventos: EventoAuditoria[] = [];
const fabrica = () => crearServidor({ repo: new RepositorioEnMemoria(), inquilino: 'es', auditar: e => void eventos.push(e) });
const texto = (r: { content: unknown }) => (r.content as { type: string; text: string }[])[0]!.text;

// Las mismas aserciones contra las dos eras del protocolo.
function suite(cliente: () => Client, version: string) {
    it(`negocia ${version}`, () => {
        assert.equal(cliente().getNegotiatedProtocolVersion(), version);
    });

    it('lista buscar_pedido con todas sus anotaciones', async () => {
        const { tools } = await cliente().listTools();
        assert.deepEqual(tools.map(t => t.name), ['buscar_pedido']);
        assert.deepEqual(tools[0]!.annotations, {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        });
    });

    it('devuelve el pedido en structuredContent, sin el inquilino', async () => {
        const r = await cliente().callTool({ name: 'buscar_pedido', arguments: { pedido_id: 'PED-2026-004812' } });
        assert.notEqual(r.isError, true);
        const pedido = pedidoSchema.parse(r.structuredContent);
        assert.equal(pedido.estado, 'en_reparto');
        assert.equal(pedido.entregaPrevista, '2026-10-02');
        assert.equal('inquilino' in (r.structuredContent as object), false);
        assert.deepEqual(eventos, [{ operacion: 'buscar_pedido', pedido: 'PED-2026-004812', resultado: 'ok' }]);
    });

    it('un pedido inexistente es un error de negocio (isError), no una excepción', async () => {
        const r = await cliente().callTool({ name: 'buscar_pedido', arguments: { pedido_id: 'PED-2026-999999' } });
        assert.equal(r.isError, true);
        assert.match(texto(r), /^No existe el pedido PED-2026-999999 en este entorno/);
        assert.equal(eventos[0]!.resultado, 'no_encontrado');
    });

    it('un pedido de otro inquilino responde igual que uno inexistente', async () => {
        const r = await cliente().callTool({ name: 'buscar_pedido', arguments: { pedido_id: 'PED-2026-003120' } });
        assert.equal(r.isError, true);
        assert.match(texto(r), /^No existe el pedido PED-2026-003120 en este entorno/);
    });

    it('un formato inválido es isError y no llega al handler', async () => {
        const r = await cliente().callTool({ name: 'buscar_pedido', arguments: { pedido_id: '4812' } });
        assert.equal(r.isError, true);
        assert.match(texto(r), /Formato esperado: PED-AAAA-NNNNNN/);
        assert.deepEqual(eventos, []);
    });

    it('una tool desconocida es un error de protocolo -32602', async () => {
        await assert.rejects(cliente().callTool({ name: 'borrar_pedido', arguments: {} }), (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.equal(error.code, -32602);
            return true;
        });
    });
}

describe('era 2026-07-28: createMcpHandler + handler.fetch en proceso', () => {
    let client: Client;
    let handler: ReturnType<typeof createMcpHandler>;
    beforeEach(async () => {
        eventos = [];
        handler = createMcpHandler(fabrica);
        client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
        await client.connect(
            new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
                fetch: (url, init) => handler.fetch(new Request(url, init))
            })
        );
    });
    afterEach(async () => {
        await client.close();
        await handler.close();
    });
    suite(() => client, '2026-07-28');
});

describe('era 2025: InMemoryTransport.createLinkedPair()', () => {
    let client: Client;
    beforeEach(async () => {
        eventos = [];
        // Las dos mitades salen del mismo paquete (@modelcontextprotocol/client).
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        client = new Client({ name: 'test', version: '1.0.0' });
        await fabrica().connect(serverTransport);
        await client.connect(clientTransport);
    });
    afterEach(async () => {
        await client.close();
    });
    suite(() => client, '2025-11-25');
});
