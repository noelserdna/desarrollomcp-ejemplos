"""nortia-almacen: existencias y alertas de rotura de stock (SDK oficial mcp 2.x)."""
import logging
import os
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ResourceNotFoundError, ToolError
from mcp.types import ToolAnnotations

# logging escribe en stderr; en stdio, stdout queda reservado para los mensajes MCP
logging.basicConfig(level=logging.INFO, format="%(name)s %(message)s")
auditoria = logging.getLogger("nortia.auditoria")

# El inquilino lo fija quien despliega el proceso, nunca un argumento que rellene el modelo
INQUILINO = os.environ.get("NORTIA_INQUILINO", "es")
ALMACENES = {"MAD-01": "es", "BCN-02": "es", "MEX-01": "mx"}
# Sustituye a la proyección de eventos de inventario: (unidades, reservadas, punto de pedido)
INVENTARIO: dict[tuple[str, str], tuple[int, int, int]] = {
    ("MAD-01", "PAL-EUR-120"): (340, 60, 150),
    ("MAD-01", "CAJ-CART-40"): (95, 20, 200),
    ("BCN-02", "PAL-EUR-120"): (12, 12, 80),
    ("MEX-01", "PAL-EUR-120"): (510, 0, 150),
}

mcp = MCPServer(
    "nortia-almacen",
    version="1.0.0",
    instructions="Existencias y alertas de rotura de stock de los almacenes de Nortia. Solo lectura.",
)


class Existencia(BaseModel):
    sku: str
    unidades: int = Field(ge=0, description="Unidades físicas en el almacén")
    reservadas: int = Field(ge=0, description="Unidades asignadas a pedidos sin expedir")
    disponibles: int = Field(description="unidades menos reservadas")
    punto_pedido: int = Field(description="Umbral de disponibles por debajo del cual se repone")
    estado: Literal["ok", "bajo", "rotura"]


class Existencias(BaseModel):
    almacen: str
    inquilino: Literal["es", "mx"]
    lineas: list[Existencia]


def almacenes_visibles() -> list[str]:
    return sorted(a for a, inquilino in ALMACENES.items() if inquilino == INQUILINO)


def lineas_de(almacen: str) -> list[Existencia]:
    if ALMACENES.get(almacen) != INQUILINO:
        # Misma respuesta si el almacén no existe o si es de otro inquilino: no se revela cuál
        raise LookupError(f"El almacén {almacen} no existe. Almacenes válidos: {almacenes_visibles()}")
    lineas = []
    for (alm, sku), (unidades, reservadas, punto) in sorted(INVENTARIO.items()):
        if alm == almacen:
            disponibles = unidades - reservadas
            estado = "rotura" if disponibles <= 0 else "bajo" if disponibles < punto else "ok"
            lineas.append(Existencia(sku=sku, unidades=unidades, reservadas=reservadas,
                                     disponibles=disponibles, punto_pedido=punto, estado=estado))
    return lineas


CodigoAlmacen = Annotated[
    str, Field(pattern=r"^[A-Z]{3}-\d{2}$", description="Código de almacén, por ejemplo MAD-01")
]
SOLO_LECTURA = ToolAnnotations(read_only_hint=True, open_world_hint=False)


@mcp.tool(title="Consultar existencias", annotations=SOLO_LECTURA)
def consultar_existencias(
    almacen: CodigoAlmacen,
    sku: Annotated[str | None, Field(description="Referencia concreta; si se omite, todas")] = None,
) -> Existencias:
    """Existencias actuales de un almacén: unidades, reservadas, disponibles y estado por referencia."""
    auditoria.info("tool=consultar_existencias inquilino=%s almacen=%s sku=%s", INQUILINO, almacen, sku)
    try:
        lineas = lineas_de(almacen)
    except LookupError as e:
        raise ToolError(str(e)) from e
    if sku is not None:
        lineas = [linea for linea in lineas if linea.sku == sku]
        if not lineas:
            raise ToolError(f"{almacen} no tiene la referencia {sku}. Llama sin sku para ver todas.")
    return Existencias(almacen=almacen, inquilino=INQUILINO, lineas=lineas)


@mcp.tool(title="Alertas de rotura de stock", annotations=SOLO_LECTURA)
def alertas_rotura_stock(almacen: CodigoAlmacen) -> list[Existencia]:
    """Referencias de un almacén con disponibles por debajo del punto de pedido."""
    auditoria.info("tool=alertas_rotura_stock inquilino=%s almacen=%s", INQUILINO, almacen)
    try:
        return [linea for linea in lineas_de(almacen) if linea.estado != "ok"]
    except LookupError as e:
        raise ToolError(str(e)) from e


@mcp.resource("almacen://almacenes", mime_type="application/json")
def almacenes() -> list[str]:
    """Códigos de los almacenes del inquilino (resource fijo)."""
    return almacenes_visibles()


@mcp.resource("almacen://{almacen}/existencias", mime_type="application/json")
def existencias(almacen: str) -> Existencias:
    """Existencias completas de un almacén (resource con plantilla)."""
    try:
        return Existencias(almacen=almacen, inquilino=INQUILINO, lineas=lineas_de(almacen))
    except LookupError as e:
        raise ResourceNotFoundError(str(e)) from e


@mcp.prompt(title="Plan de reposición")
def plan_reposicion(almacen: str) -> str:
    """Pide un plan de reposición para un almacén a partir de sus alertas."""
    return (
        f"Eres responsable del almacén {almacen} de Nortia. Llama a alertas_rotura_stock para {almacen} "
        "y propone, por referencia, cuántas unidades pedir para volver al punto de pedido. "
        "Ordena por urgencia: primero las roturas. No inventes existencias que la tool no haya devuelto."
    )


if __name__ == "__main__":
    mcp.run()  # stdio por defecto
