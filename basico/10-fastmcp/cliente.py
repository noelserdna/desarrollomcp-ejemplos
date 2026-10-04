"""Cliente mínimo. Sin argumentos lanza el servidor por stdio; con una URL usa Streamable HTTP."""
import sys

import anyio

from mcp import Client, StdioServerParameters


async def main() -> None:
    stdio = StdioServerParameters(command=sys.executable, args=["servidor.py"])
    destino = sys.argv[1] if len(sys.argv) > 1 else stdio
    async with Client(destino, read_timeout_seconds=10) as client:
        print("protocolo:", client.protocol_version, "| servidor:", client.server_info.name)
        for tool in (await client.list_tools()).tools:
            print("tool:", tool.name, "| argumentos:", list(tool.input_schema["properties"]))
        r = await client.call_tool("alertas_rotura_stock", {"almacen": "MAD-01"})
        print("alertas MAD-01 ->", r.structured_content)
        r = await client.call_tool("consultar_existencias", {"almacen": "MEX-01"})
        print("otro inquilino -> is_error:", r.is_error, "|", r.content[0].text)
        rr = await client.read_resource("almacen://almacenes")
        print("almacen://almacenes ->", rr.contents[0].text.replace("\n", ""))
        gp = await client.get_prompt("plan_reposicion", {"almacen": "BCN-02"})
        print("prompt ->", gp.messages[0].role, "|", gp.messages[0].content.text[:60] + "...")


anyio.run(main)
