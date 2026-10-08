// Arranca los servidores de prueba reales en un puerto libre y los recorre con el cliente oficial por HTTP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Client, ProtocolError, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ABONO = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

let proceso: ChildProcess;
let stderr = '';
let pedidos: Client;
let facturacion: Client;

async function puertoLibre(): Promise<number> {
    const servidor = createServer().listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const { port } = servidor.address() as { port: number };
    servidor.close();
    return port;
}

async function conectar(url: string): Promise<Client> {
    const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    return client;
}

const texto = (r: { content: unknown }) => (r.content as { type: string; text: string }[])[0]!.text;
const json = (r: { content: unknown }) => JSON.parse(texto(r));

before(async () => {
    const puerto = await puertoLibre();
    proceso = spawn(process.execPath, ['--import', 'tsx', 'src/servidores-de-prueba.ts'], {
        env: { ...process.env, PORT: String(puerto), RETARDO_FACTURACION_MS: '0' },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    proceso.stderr!.setEncoding('utf8');
    await new Promise<void>((resolve, reject) => {
        proceso.stderr!.on('data', (trozo: string) => {
            stderr += trozo;
            if (stderr.includes(`http://127.0.0.1:${puerto}`)) resolve();
        });
        proceso.once('exit', codigo => reject(new Error(`los servidores terminaron con ${codigo}:\n${stderr}`)));
    });
    pedidos = await conectar(`http://127.0.0.1:${puerto}/pedidos/mcp`);
    facturacion = await conectar(`http://127.0.0.1:${puerto}/facturacion/mcp`);
});

after(async () => {
    await pedidos?.close();
    await facturacion?.close();
    proceso?.kill();
});

describe('nortia-pedidos', () => {
    it('habla 2026-07-28 y lista buscar_pedido con todas sus anotaciones', async () => {
        assert.equal(pedidos.getNegotiatedProtocolVersion(), '2026-07-28');
        const { tools } = await pedidos.listTools();
        assert.deepEqual(tools.map(t => [t.name, t.annotations]), [['buscar_pedido', SOLO_LECTURA]]);
    });

    it('buscar_pedido devuelve el pedido', async () => {
        const r = await pedidos.callTool({ name: 'buscar_pedido', arguments: { pedido_id: 'PED-2026-004812' } });
        assert.notEqual(r.isError, true);
        assert.deepEqual(json(r), { id: 'PED-2026-004812', estado: 'incidencia', factura: 'F-2026-0142', almacen: 'MAD-01' });
    });

    it('buscar_pedido con un id inexistente es isError con el formato esperado', async () => {
        const r = await pedidos.callTool({ name: 'buscar_pedido', arguments: { pedido_id: 'PED-2026-4812' } });
        assert.equal(r.isError, true);
        assert.equal(texto(r), 'No existe el pedido PED-2026-4812. Formato esperado: PED-2026-004812.');
    });
});

describe('nortia-facturacion', () => {
    it('lista buscar_factura (solo lectura) y emitir_abono (destructiva, no idempotente)', async () => {
        const { tools } = await facturacion.listTools();
        assert.deepEqual(tools.map(t => [t.name, t.annotations]), [
            ['buscar_factura', SOLO_LECTURA],
            ['emitir_abono', ABONO]
        ]);
    });

    it('buscar_factura devuelve la factura', async () => {
        const r = await facturacion.callTool({ name: 'buscar_factura', arguments: { factura_id: 'F-2026-0142' } });
        assert.notEqual(r.isError, true);
        assert.deepEqual(json(r), { id: 'F-2026-0142', pedido: 'PED-2026-004812', total: 1210, moneda: 'EUR', abonado: 0 });
    });

    it('buscar_factura con un id inexistente es isError', async () => {
        const r = await facturacion.callTool({ name: 'buscar_factura', arguments: { factura_id: 'F-2026-142' } });
        assert.equal(r.isError, true);
        assert.equal(texto(r), 'No existe la factura F-2026-142. Formato esperado: F-2026-0142.');
    });

    it('emitir_abono rechaza con isError un importe mayor que lo abonable, sin contabilizar nada', async () => {
        const r = await facturacion.callTool({
            name: 'emitir_abono',
            arguments: { factura_id: 'F-2026-0142', importe: 5000, motivo: 'Mercancía dañada en la entrega' }
        });
        assert.equal(r.isError, true);
        assert.equal(texto(r), 'El importe 5000 supera lo abonable (1210 EUR).');
        assert.doesNotMatch(stderr, /contabilizado/);
    });

    it('emitir_abono con un motivo demasiado corto es isError (validación de entrada)', async () => {
        const r = await facturacion.callTool({
            name: 'emitir_abono',
            arguments: { factura_id: 'F-2026-0142', importe: 10, motivo: 'roto' }
        });
        assert.equal(r.isError, true);
    });

    it('emitir_abono contabiliza el abono y cambia lo abonado de la factura', async () => {
        const r = await facturacion.callTool({
            name: 'emitir_abono',
            arguments: { factura_id: 'F-2026-0142', importe: 184.5, motivo: 'Mercancía dañada en la entrega' }
        });
        assert.notEqual(r.isError, true);
        assert.deepEqual(json(r), {
            abono: 'R-2026-0017', factura: 'F-2026-0142', importe: 184.5, moneda: 'EUR', motivo: 'Mercancía dañada en la entrega'
        });
        assert.match(stderr, /abono de 184.5 EUR contabilizado en F-2026-0142/);
        const factura = await facturacion.callTool({ name: 'buscar_factura', arguments: { factura_id: 'F-2026-0142' } });
        assert.equal(json(factura).abonado, 184.5);
    });

    it('una tool desconocida es un error de protocolo -32602', async () => {
        await assert.rejects(facturacion.callTool({ name: 'anular_factura', arguments: {} }), (error: unknown) => {
            assert.ok(error instanceof ProtocolError);
            assert.equal(error.code, -32602);
            return true;
        });
    });
});
