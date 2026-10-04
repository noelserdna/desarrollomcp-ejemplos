"""Lado MCP del agente: conecta con los servidores, enruta cada tool y aplica la política."""
import json
import time
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from mcp import Client
from mcp.types import TextContent, Tool


@dataclass(frozen=True)
class Servidor:
    alias: str
    url: str
    sin_aprobacion: frozenset[str]


@dataclass(frozen=True)
class Resultado:
    texto: str
    es_error: bool


@dataclass(frozen=True)
class Contexto:
    conversacion: str
    usuario: str
    inquilino: Literal["es", "mx"]
    timeout_s: float
    max_caracteres: int
    auditoria: str
    aprobar: Callable[[str, str, dict[str, Any]], Awaitable[bool]]  # (servidor, tool, args)


class Puente:
    def __init__(self, contexto: Contexto) -> None:
        self._contexto = contexto
        self._rutas: dict[str, tuple[Servidor, Client]] = {}
        self._pila = AsyncExitStack()

    async def conectar(self, servidores: list[Servidor]) -> list[Tool]:
        todas: list[Tool] = []
        for servidor in servidores:
            client = await self._pila.enter_async_context(Client(servidor.url))  # mode="auto": 2026-07-28
            for tool in (await client.list_tools()).tools:
                if tool.name in self._rutas:
                    raise RuntimeError(f"{tool.name} existe en {self._rutas[tool.name][0].alias} y en {servidor.alias}")
                self._rutas[tool.name] = (servidor, client)
                todas.append(tool)
        return todas

    async def llamar(self, tool: str, args: dict[str, Any]) -> Resultado:
        inicio = time.monotonic()
        ruta = self._rutas.get(tool)
        con_efecto = ruta is not None and tool not in ruta[0].sin_aprobacion

        if ruta is None:
            desenlace = "desconocida"
            texto = f"La tool {tool} no existe. Disponibles: {', '.join(self._rutas)}."
        elif con_efecto and not await self._contexto.aprobar(ruta[0].alias, tool, args):
            desenlace = "denegada"
            texto = f"Una persona ha denegado {tool}. No lo reintentes: explica al usuario que la acción no se ha hecho."
        else:
            try:
                r = await ruta[1].call_tool(tool, args, read_timeout_seconds=self._contexto.timeout_s)
                desenlace = "error_tool" if r.is_error else "ok"
                texto = "\n".join(b.text if isinstance(b, TextContent) else f"[contenido {b.type} omitido]" for b in r.content)
            except Exception as error:  # MCPError (protocolo, timeout) o fallo de red: el bucle no debe caerse
                desenlace = "sin_resultado"
                texto = f"{tool} no ha devuelto resultado ({error}). "
                texto += "Puede haberse ejecutado: no la repitas y escala el caso." if con_efecto else "Puedes reintentarla una vez."
        if len(texto) > self._contexto.max_caracteres:
            texto = f"{texto[: self._contexto.max_caracteres]} [resultado truncado]"

        c = self._contexto
        registro = {
            "ts": datetime.now(timezone.utc).isoformat(), "conversacion": c.conversacion, "usuario": c.usuario,
            "inquilino": c.inquilino, "servidor": ruta[0].alias if ruta else None, "tool": tool, "args": args,
            "aprobacion": "no_requerida" if not con_efecto else "denegada" if desenlace == "denegada" else "aprobada",
            "desenlace": desenlace, "ms": round((time.monotonic() - inicio) * 1000),
        }
        with open(c.auditoria, "a", encoding="utf-8") as f:
            f.write(json.dumps(registro, ensure_ascii=False) + "\n")
        return Resultado(texto, desenlace != "ok")

    async def cerrar(self) -> None:
        await self._pila.aclose()
