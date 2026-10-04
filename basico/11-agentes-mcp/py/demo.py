"""Ejecuta el bucle y el puente reales contra los servidores MCP, con un modelo guionizado en lugar de Claude."""
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

import anyio
from anthropic.types import MessageParam, ToolParam

from agente import Limites, Turno, ejecutar_agente, para_claude
from puente import Contexto, Puente, Servidor

ABONO = {"factura_id": "F-2026-0142", "importe": 184.5, "motivo": "Mercancía dañada en la entrega"}
GUION: list[list[dict]] = [
    [{"type": "tool_use", "id": "tu_1", "name": "buscar_pedido", "input": {"pedido_id": "PED-2026-004812"}}],
    [{"type": "tool_use", "id": "tu_2", "name": "buscar_factura", "input": {"factura_id": "F-2026-142"}}],
    [{"type": "tool_use", "id": "tu_3", "name": "buscar_factura", "input": {"factura_id": "F-2026-0142"}}],
    [{"type": "tool_use", "id": "tu_4", "name": "emitir_abono", "input": ABONO}],
    [{"type": "text", "text": "(texto final del guion)"}],
]
EN_BUCLE = "--bucle" in sys.argv
turno = 0


# Las cifras de tokens son del guion, no mediciones: solo sirven para ejercitar el límite de coste.
async def modelo_guionizado(mensajes: list[MessageParam], tools: list[ToolParam]) -> Turno:
    global turno
    ultimo = mensajes[-1]["content"]
    if not isinstance(ultimo, str):
        for b in ultimo:
            if b["type"] == "tool_result":
                print(f"   tool_result is_error={str(b['is_error']).lower()}: {b['content']}")
    content = GUION[0 if EN_BUCLE else turno]
    turno += 1
    for b in content:
        if b["type"] == "tool_use":
            print(f"{turno}. tool_use {b['name']} {json.dumps(b['input'], ensure_ascii=False)}")
    return {"content": content, "usage": {"input_tokens": 1500 + 400 * turno, "output_tokens": 80}}


# En producción esto es un botón en la consola de soporte; aquí, una variable de entorno.
async def aprobar(servidor: str, tool: str, args: dict) -> bool:
    decision = os.environ.get("APROBAR") == "si"
    print(f"   aprobación: {servidor}/{tool} {json.dumps(args, ensure_ascii=False)} -> {'aprobada' if decision else 'denegada'}")
    return decision


async def main() -> None:
    auditoria = "auditoria.jsonl"
    Path(auditoria).unlink(missing_ok=True)
    puente = Puente(Contexto(
        conversacion="TCK-88213", usuario="soporte-0417", inquilino="es",
        timeout_s=float(os.environ.get("TIMEOUT_S", "5")), max_caracteres=4000, auditoria=auditoria, aprobar=aprobar,
    ))
    base = os.environ.get("MCP_BASE", "http://127.0.0.1:3211")
    try:
        tools = para_claude(await puente.conectar([
            Servidor("nortia-pedidos", f"{base}/pedidos/mcp", frozenset({"buscar_pedido"})),
            Servidor("nortia-facturacion", f"{base}/facturacion/mcp", frozenset({"buscar_factura"})),
        ]))
        print(f"tools: {', '.join(t['name'] for t in tools)}")
        limites = Limites(max_iteraciones=6, max_tokens=int(os.environ.get("MAX_TOKENS", "40000")), max_errores_seguidos=3)
        final = await ejecutar_agente(modelo_guionizado, puente, tools, "El pedido PED-2026-004812 llegó con un palé dañado. Abona los 184,50 EUR de esa línea.", limites)
        print("final:", json.dumps(asdict(final), ensure_ascii=False))
    finally:
        await puente.cerrar()


anyio.run(main)
