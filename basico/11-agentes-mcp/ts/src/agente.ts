// El bucle del agente. No sabe nada de MCP ni de qué modelo hay detrás de pedirTurno.
import type Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@modelcontextprotocol/client';
import type { Puente } from './puente.js';

export type Bloque = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
export type Turno = { content: Bloque[]; usage: { input_tokens: number; output_tokens: number } };
export type PedirTurno = (mensajes: Anthropic.MessageParam[], tools: Anthropic.Tool[]) => Promise<Turno>;
export type Limites = { maxIteraciones: number; maxTokens: number; maxErroresSeguidos: number };
export type Final = { motivo: 'respuesta' | 'max_iteraciones' | 'max_tokens' | 'errores_seguidos'; texto: string; iteraciones: number; tokens: number };

export const paraClaude = (tools: Tool[]): Anthropic.Tool[] =>
    tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));

export async function ejecutarAgente(
    pedirTurno: PedirTurno, puente: Puente, tools: Anthropic.Tool[], pregunta: string, limites: Limites
): Promise<Final> {
    const mensajes: Anthropic.MessageParam[] = [{ role: 'user', content: pregunta }];
    let tokens = 0;
    let erroresSeguidos = 0;

    for (let iteracion = 1; iteracion <= limites.maxIteraciones; iteracion++) {
        const turno = await pedirTurno(mensajes, tools);
        tokens += turno.usage.input_tokens + turno.usage.output_tokens;
        const fin = (motivo: Final['motivo'], texto: string): Final => ({ motivo, texto, iteraciones: iteracion, tokens });

        const usos = turno.content.filter(b => b.type === 'tool_use');
        if (usos.length === 0) return fin('respuesta', turno.content.map(b => (b.type === 'text' ? b.text : '')).join(''));
        // El coste se comprueba antes de ejecutar: cortar no debe dejar acciones a medias.
        if (tokens >= limites.maxTokens) return fin('max_tokens', 'Presupuesto de tokens agotado; el caso pasa a una persona.');

        mensajes.push({ role: 'assistant', content: turno.content });
        const resultados: Anthropic.ToolResultBlockParam[] = [];
        for (const uso of usos) {
            const r = await puente.llamar(uso.name, uso.input as Record<string, unknown>);
            erroresSeguidos = r.esError ? erroresSeguidos + 1 : 0;
            resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: r.texto, is_error: r.esError });
        }
        if (erroresSeguidos >= limites.maxErroresSeguidos) return fin('errores_seguidos', 'Demasiados errores de tool seguidos; el caso pasa a una persona.');
        mensajes.push({ role: 'user', content: resultados });
    }
    return { motivo: 'max_iteraciones', texto: 'Límite de iteraciones alcanzado; el caso pasa a una persona.', iteraciones: limites.maxIteraciones, tokens };
}
