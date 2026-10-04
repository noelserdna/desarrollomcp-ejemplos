// Vías 2 y 3, en seco: construye las peticiones y prueba el puente del helper. No llama a la API de Anthropic.
import Anthropic from '@anthropic-ai/sdk';
import { type MCPClientLike, mcpTools } from '@anthropic-ai/sdk/helpers/beta/mcp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'sin-definir';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? 'sin-usar' });
const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: '¿En qué estado está el pedido PED-2026-004812?' }];

// Vía 2: el tool runner del SDK de Anthropic hace el bucle y llama a tu cliente MCP.
const mcp = new Client({ name: 'agente-soporte', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
await mcp.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3211/pedidos/mcp')));
const { tools } = await mcp.listTools();
// El Client de MCP v2 no encaja en el tipo MCPClientLike del helper (structuredContent es unknown); este adaptador sí.
// Es también el sitio donde meter aprobación y auditoría si usas esta vía.
const mcpLike: MCPClientLike = { callTool: params => mcp.callTool(params) as ReturnType<MCPClientLike['callTool']> };
const ejecutables = mcpTools(tools, mcpLike);
console.log('run() a mano ->', JSON.stringify(await ejecutables[0]!.run({ pedido_id: 'PED-2026-004812' })));
const crearRunner = () => anthropic.beta.messages.toolRunner({ model: MODEL, max_tokens: 1024, max_iterations: 6, tools: ejecutables, messages });

// Vía 3: conector MCP. La API de Anthropic se conecta al servidor; tu proceso no ve las llamadas.
const peticionConector: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 1024,
    betas: ['mcp-client-2025-11-20'],
    mcp_servers: [{ type: 'url', url: 'https://mcp.nortia.example/pedidos/mcp', name: 'nortia-pedidos', authorization_token: process.env.NORTIA_MCP_TOKEN }],
    tools: [{ type: 'mcp_toolset', mcp_server_name: 'nortia-pedidos' }],
    messages
};
const llamarConector = () => anthropic.beta.messages.create(peticionConector);

console.log('sin ejecutar:', typeof crearRunner, typeof llamarConector, '| mcp_servers:', peticionConector.mcp_servers?.length);
await mcp.close();
