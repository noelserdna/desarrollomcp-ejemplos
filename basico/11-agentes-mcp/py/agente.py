"""El bucle del agente. No sabe nada de MCP ni de qué modelo hay detrás de pedir_turno."""
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

from anthropic.types import MessageParam, ToolParam, ToolResultBlockParam
from mcp.types import Tool

from puente import Puente


class Turno(TypedDict):
    content: list[dict[str, Any]]  # bloques {"type": "text", ...} o {"type": "tool_use", "id", "name", "input"}
    usage: dict[str, int]  # input_tokens y output_tokens


PedirTurno = Callable[[list[MessageParam], list[ToolParam]], Awaitable[Turno]]
Motivo = Literal["respuesta", "max_iteraciones", "max_tokens", "errores_seguidos"]


@dataclass(frozen=True)
class Limites:
    max_iteraciones: int
    max_tokens: int
    max_errores_seguidos: int


@dataclass(frozen=True)
class Final:
    motivo: Motivo
    texto: str
    iteraciones: int
    tokens: int


def para_claude(tools: list[Tool]) -> list[ToolParam]:
    return [{"name": t.name, "description": t.description or "", "input_schema": t.input_schema} for t in tools]


async def ejecutar_agente(
    pedir_turno: PedirTurno, puente: Puente, tools: list[ToolParam], pregunta: str, limites: Limites
) -> Final:
    mensajes: list[MessageParam] = [{"role": "user", "content": pregunta}]
    tokens = 0
    errores_seguidos = 0

    for iteracion in range(1, limites.max_iteraciones + 1):
        turno = await pedir_turno(mensajes, tools)
        tokens += turno["usage"]["input_tokens"] + turno["usage"]["output_tokens"]

        usos = [b for b in turno["content"] if b["type"] == "tool_use"]
        if not usos:
            texto = "".join(b["text"] for b in turno["content"] if b["type"] == "text")
            return Final("respuesta", texto, iteracion, tokens)
        # El presupuesto se comprueba antes de ejecutar nada: pasarse de coste no debe dejar acciones a medias.
        if tokens >= limites.max_tokens:
            return Final("max_tokens", "Presupuesto de tokens agotado; el caso pasa a una persona.", iteracion, tokens)

        mensajes.append({"role": "assistant", "content": turno["content"]})  # type: ignore[typeddict-item]
        resultados: list[ToolResultBlockParam] = []
        for uso in usos:
            r = await puente.llamar(uso["name"], uso["input"])
            errores_seguidos = errores_seguidos + 1 if r.es_error else 0
            resultados.append({"type": "tool_result", "tool_use_id": uso["id"], "content": r.texto, "is_error": r.es_error})
        if errores_seguidos >= limites.max_errores_seguidos:
            return Final("errores_seguidos", "Demasiados errores de tool seguidos; el caso pasa a una persona.", iteracion, tokens)
        mensajes.append({"role": "user", "content": resultados})

    return Final("max_iteraciones", "Límite de iteraciones alcanzado; el caso pasa a una persona.", limites.max_iteraciones, tokens)
