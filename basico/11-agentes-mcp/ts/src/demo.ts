// Ejecuta el bucle y el puente reales contra los servidores MCP, con un modelo guionizado en lugar de Claude.
import { rm } from 'node:fs/promises';
import { ejecutarAgente, paraClaude, type Bloque, type PedirTurno } from './agente.js';
import { Puente } from './puente.js';

const abono = { factura_id: 'F-2026-0142', importe: 184.5, motivo: 'Mercancía dañada en la entrega' };
const guion: Bloque[][] = [
    [{ type: 'tool_use', id: 'tu_1', name: 'buscar_pedido', input: { pedido_id: 'PED-2026-004812' } }],
    [{ type: 'tool_use', id: 'tu_2', name: 'buscar_factura', input: { factura_id: 'F-2026-142' } }],
    [{ type: 'tool_use', id: 'tu_3', name: 'buscar_factura', input: { factura_id: 'F-2026-0142' } }],
    [{ type: 'tool_use', id: 'tu_4', name: 'emitir_abono', input: abono }],
    [{ type: 'text', text: '(texto final del guion)' }]
];
const enBucle = process.argv.includes('--bucle');
let turno = 0;
// Las cifras de tokens son del guion, no mediciones: solo sirven para ejercitar el límite de coste.
const modeloGuionizado: PedirTurno = async mensajes => {
    const ultimo = mensajes.at(-1)!.content;
    if (typeof ultimo !== 'string') {
        for (const b of ultimo) if (b.type === 'tool_result') console.log(`   tool_result is_error=${b.is_error}: ${b.content}`);
    }
    const content = guion[enBucle ? 0 : turno]!;
    turno++;
    for (const b of content) if (b.type === 'tool_use') console.log(`${turno}. tool_use ${b.name} ${JSON.stringify(b.input)}`);
    return { content, usage: { input_tokens: 1500 + 400 * turno, output_tokens: 80 } };
};

const auditoria = 'auditoria.jsonl';
await rm(auditoria, { force: true });
const puente = new Puente({
    conversacion: 'TCK-88213',
    usuario: 'soporte-0417',
    inquilino: 'es',
    timeoutMs: Number(process.env.TIMEOUT_MS ?? 5000),
    maxCaracteres: 4000,
    auditoria,
    // En producción esto es un botón en la consola de soporte; aquí, una variable de entorno.
    aprobar: async ({ servidor, tool, args }) => {
        const decision = process.env.APROBAR === 'si';
        console.log(`   aprobación: ${servidor}/${tool} ${JSON.stringify(args)} -> ${decision ? 'aprobada' : 'denegada'}`);
        return decision;
    }
});
const base = process.env.MCP_BASE ?? 'http://127.0.0.1:3211';
const tools = paraClaude(
    await puente.conectar([
        { alias: 'nortia-pedidos', url: `${base}/pedidos/mcp`, sinAprobacion: ['buscar_pedido'] },
        { alias: 'nortia-facturacion', url: `${base}/facturacion/mcp`, sinAprobacion: ['buscar_factura'] }
    ])
);
console.log(`tools: ${tools.map(t => t.name).join(', ')} | ${JSON.stringify(tools).length} caracteres de definiciones`);

const limites = { maxIteraciones: 6, maxTokens: Number(process.env.MAX_TOKENS ?? 40000), maxErroresSeguidos: 3 };
const final = await ejecutarAgente(modeloGuionizado, puente, tools, 'El pedido PED-2026-004812 llegó con un palé dañado. Abona los 184,50 EUR de esa línea.', limites);
console.log('final:', JSON.stringify(final));
await puente.cerrar();
