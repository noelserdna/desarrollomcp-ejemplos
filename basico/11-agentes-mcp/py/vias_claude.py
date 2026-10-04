"""Vías 2 y 3, en seco: construye las peticiones y prueba el puente del helper. No llama a la API de Anthropic."""
import os

import anyio
from anthropic import AsyncAnthropic
from anthropic.lib.tools.mcp import async_mcp_tool
from mcp import Client

MODEL = os.environ.get("ANTHROPIC_MODEL", "sin-definir")
MENSAJES = [{"role": "user", "content": "¿En qué estado está el pedido PED-2026-004812?"}]


async def main() -> None:
    anthropic = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", "sin-usar"))

    # Vía 2: el tool runner del SDK de Anthropic hace el bucle y llama a tu cliente MCP.
    async with Client("http://127.0.0.1:3211/pedidos/mcp") as mcp_client:
        ejecutables = [async_mcp_tool(t, mcp_client) for t in (await mcp_client.list_tools()).tools]
        print("definición para Claude:", ejecutables[0].to_dict())
        print("call() a mano ->", await ejecutables[0].call({"pedido_id": "PED-2026-004812"}))
        runner = anthropic.beta.messages.tool_runner(model=MODEL, max_tokens=1024, tools=ejecutables, messages=MENSAJES)
        print("runner sin iterar:", type(runner).__name__)

    # Vía 3: conector MCP. La API de Anthropic se conecta al servidor; tu proceso no ve las llamadas.
    peticion_conector = {
        "model": MODEL,
        "max_tokens": 1024,
        "betas": ["mcp-client-2025-11-20"],
        "mcp_servers": [{
            "type": "url", "url": "https://mcp.nortia.example/pedidos/mcp", "name": "nortia-pedidos",
            "authorization_token": os.environ.get("NORTIA_MCP_TOKEN"),
        }],
        "tools": [{"type": "mcp_toolset", "mcp_server_name": "nortia-pedidos"}],
        "messages": MENSAJES,
    }
    # Sin ejecutar: await anthropic.beta.messages.create(**peticion_conector)
    print("petición del conector sin enviar:", sorted(peticion_conector))


anyio.run(main)
