// Lado MCP del agente: conecta con los servidores, enruta cada tool y aplica la política.
import { appendFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport, type Tool } from '@modelcontextprotocol/client';

export type Servidor = { alias: string; url: string; sinAprobacion: string[] };
export type Solicitud = { servidor: string; tool: string; args: Record<string, unknown> };
export type Resultado = { texto: string; esError: boolean };
export type Contexto = {
    conversacion: string;
    usuario: string;
    inquilino: 'es' | 'mx';
    timeoutMs: number;
    maxCaracteres: number;
    auditoria: string;
    aprobar: (solicitud: Solicitud) => Promise<boolean>;
};
type Ruta = { servidor: Servidor; client: Client };

export class Puente {
    private rutas = new Map<string, Ruta>();
    constructor(private contexto: Contexto) {}

    async conectar(servidores: Servidor[]): Promise<Tool[]> {
        const todas: Tool[] = [];
        for (const servidor of servidores) {
            const client = new Client({ name: 'agente-soporte', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
            await client.connect(new StreamableHTTPClientTransport(new URL(servidor.url)));
            const { tools } = await client.listTools();
            for (const tool of tools) {
                const previa = this.rutas.get(tool.name);
                if (previa) throw new Error(`${tool.name} existe en ${previa.servidor.alias} y en ${servidor.alias}`);
                this.rutas.set(tool.name, { servidor, client });
            }
            todas.push(...tools);
        }
        return todas;
    }

    async llamar(tool: string, args: Record<string, unknown>): Promise<Resultado> {
        const inicio = Date.now();
        const ruta = this.rutas.get(tool);
        const conEfecto = ruta !== undefined && !ruta.servidor.sinAprobacion.includes(tool);
        let desenlace: 'ok' | 'error_tool' | 'desconocida' | 'denegada' | 'sin_resultado';
        let texto: string;

        if (!ruta) {
            desenlace = 'desconocida';
            texto = `La tool ${tool} no existe. Disponibles: ${[...this.rutas.keys()].join(', ')}.`;
        } else if (conEfecto && !(await this.contexto.aprobar({ servidor: ruta.servidor.alias, tool, args }))) {
            desenlace = 'denegada';
            texto = `Una persona ha denegado ${tool}. No lo reintentes: explica al usuario que la acción no se ha hecho.`;
        } else {
            try {
                const signal = AbortSignal.timeout(this.contexto.timeoutMs);
                const r = await ruta.client.callTool({ name: tool, arguments: args }, { signal });
                desenlace = r.isError ? 'error_tool' : 'ok';
                texto = r.content.map(b => (b.type === 'text' ? b.text : `[contenido ${b.type} omitido]`)).join('\n');
            } catch (error) {
                desenlace = 'sin_resultado';
                texto = `${tool} no ha devuelto resultado (${error instanceof Error ? error.message : String(error)}). `;
                texto += conEfecto ? 'Puede haberse ejecutado: no la repitas y escala el caso.' : 'Puedes reintentarla una vez.';
            }
        }
        if (texto.length > this.contexto.maxCaracteres) texto = `${texto.slice(0, this.contexto.maxCaracteres)} [resultado truncado]`;

        const { conversacion, usuario, inquilino, auditoria } = this.contexto;
        const registro = { ts: new Date().toISOString(), conversacion, usuario, inquilino, servidor: ruta?.servidor.alias ?? null,
            tool, args, aprobacion: !conEfecto ? 'no_requerida' : desenlace === 'denegada' ? 'denegada' : 'aprobada',
            desenlace, ms: Date.now() - inicio };
        await appendFile(auditoria, JSON.stringify(registro) + '\n');
        return { texto, esError: desenlace !== 'ok' };
    }

    async cerrar(): Promise<void> {
        for (const client of new Set([...this.rutas.values()].map(r => r.client))) await client.close();
    }
}
