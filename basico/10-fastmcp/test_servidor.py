import pytest

import servidor
from mcp import Client, MCPError


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with Client(servidor.mcp, raise_exceptions=True) as c:  # en memoria: sin proceso ni red
        yield c


@pytest.mark.anyio
async def test_el_modelo_no_puede_elegir_inquilino(client: Client):
    for tool in (await client.list_tools()).tools:
        assert "inquilino" not in tool.input_schema["properties"]
        assert tool.annotations.model_dump(exclude_none=True) == {
            "read_only_hint": True, "destructive_hint": False, "idempotent_hint": True, "open_world_hint": False
        }


@pytest.mark.anyio
async def test_salida_estructurada_cumple_el_modelo(client: Client):
    r = await client.call_tool("consultar_existencias", {"almacen": "MAD-01", "sku": "CAJ-CART-40"})
    assert r.is_error is False
    existencias = servidor.Existencias.model_validate(r.structured_content)
    assert existencias.lineas[0].disponibles == 75
    assert existencias.lineas[0].estado == "bajo"


@pytest.mark.anyio
async def test_cambio_de_inquilino(client: Client, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(servidor, "INQUILINO", "mx")
    assert client.protocol_version == "2026-07-28"
    r = await client.call_tool("consultar_existencias", {"almacen": "MEX-01"})
    assert r.structured_content["inquilino"] == "mx"
    r = await client.call_tool("consultar_existencias", {"almacen": "MAD-01"})
    assert r.is_error is True
    assert "MEX-01" in r.content[0].text  # el modelo recibe los códigos que sí puede usar


@pytest.mark.anyio
async def test_fallo_interno_no_filtra_detalles(client: Client, monkeypatch: pytest.MonkeyPatch):
    def roto(almacen: str):
        raise RuntimeError("connection to postgres://inventario:s3creto@10.0.4.7 refused")

    monkeypatch.setattr(servidor, "lineas_de", roto)
    r = await client.call_tool("alertas_rotura_stock", {"almacen": "MAD-01"})
    assert r.is_error is True
    assert r.content[0].text == "Error executing tool alertas_rotura_stock"


@pytest.mark.anyio
async def test_resource_inexistente_es_error_de_protocolo(client: Client):
    with pytest.raises(MCPError) as exc:
        await client.read_resource("almacen://MEX-01/existencias")
    assert exc.value.error.code == -32602
