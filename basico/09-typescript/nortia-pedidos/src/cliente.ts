import { Client, ProtocolError } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { pedidoSchema } from './servidor.js';

const info = { name: 'prueba-nortia', version: '1.0.0' };
const client = new Client(info, { versionNegotiation: { mode: 'auto' } });
await client.connect(
    new StdioClientTransport({
        command: 'npx',
        args: ['tsx', 'src/stdio.ts'],
        env: { ...process.env, NORTIA_INQUILINO: 'es' } as Record<string, string>,
        stderr: 'inherit'
    })
);
console.log('versión:', client.getNegotiatedProtocolVersion(), JSON.stringify(client.getServerVersion()));
console.log('tools:', JSON.stringify((await client.listTools()).tools.map(t => [t.name, t.annotations])));
console.log('resources:', JSON.stringify((await client.listResources()).resources.map(r => r.uri)));
const { resourceTemplates } = await client.listResourceTemplates();
console.log('plantillas:', JSON.stringify(resourceTemplates.map(t => t.uriTemplate)));
console.log('prompts:', JSON.stringify((await client.listPrompts()).prompts.map(p => p.name)));

const buscar = (id: string) => client.callTool({ name: 'buscar_pedido', arguments: { pedido_id: id } });
const texto = (r: { contents: unknown[] }) => (r.contents[0] as { text: string }).text;

const ok = await buscar('PED-2026-004812');
const pedido = pedidoSchema.parse(ok.structuredContent); // es unknown: se valida antes de leer propiedades
console.log('1) pedido:', pedido.id, pedido.estado, pedido.entregaPrevista);

const fallidos = {
    '2) no existe': 'PED-2026-999999', '3) otro inquilino': 'PED-2026-003120', '4) formato': '4812'
};
for (const [etiqueta, id] of Object.entries(fallidos)) {
    const r = await buscar(id);
    console.log(`${etiqueta}:`, JSON.stringify({ isError: r.isError, content: r.content }));
}

const estados = JSON.parse(texto(await client.readResource({ uri: 'pedidos://catalogo/estados' })));
console.log('5) estados:', Object.keys(estados).join(', '));
console.log('6) ficha:', texto(await client.readResource({ uri: 'pedidos://pedido/PED-2026-004797' })));
const prompt = await client.getPrompt({ name: 'respuesta_retraso', arguments: { pedido_id: 'PED-2026-004797' } });
console.log('7) prompt:', JSON.stringify(prompt.messages[0]!.content).slice(0, 96), '[...]');

const rechazos = {
    '8) tool desconocida': () => client.callTool({ name: 'borrar_pedido', arguments: {} }),
    '9) resource inexistente': () => client.readResource({ uri: 'pedidos://pedido/PED-2026-999999' }),
    '10) prompt inválido': () => client.getPrompt({ name: 'respuesta_retraso', arguments: { pedido_id: '4812' } })
};
for (const [etiqueta, llamada] of Object.entries(rechazos)) {
    try {
        await llamada();
    } catch (error) {
        if (!(error instanceof ProtocolError)) throw error;
        const { code, message, data } = error;
        console.log(`${etiqueta}:`, JSON.stringify({ code, message, data }));
    }
}

await client.close();
