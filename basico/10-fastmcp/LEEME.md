# Lección 10: servidor MCP en Python (`nortia-almacen`)

Código de la lección [Servidor en Python](https://desarrollomcp.com/aprende/10-fastmcp) del curso de MCP de desarrollomcp.com.

Es el servidor `nortia-almacen` de Nortia Logística escrito con el SDK oficial de Python (`mcp` 2.2.0, clase `MCPServer`), que habla la versión 2026-07-28 del protocolo. Con él ves:

- Tools definidas con decoradores, tipos y modelos de Pydantic (`consultar_existencias`, `alertas_rotura_stock`), con salida estructurada y anotaciones completas de solo lectura (`read_only_hint=True`, `destructive_hint=False`, `idempotent_hint=True`, `open_world_hint=False`: los datos están en memoria, no tocan sistemas externos).
- Un resource fijo (`almacen://almacenes`), uno con plantilla (`almacen://{almacen}/existencias`) y un prompt (`plan_reposicion`).
- Errores para el modelo con `ToolError` y errores de protocolo con `ResourceNotFoundError`; un fallo imprevisto no filtra detalles internos.
- Multi-tenant: el inquilino lo fija `NORTIA_INQUILINO` al desplegar, nunca un argumento de la tool.
- El mismo servidor por stdio (`servidor.py`) y por Streamable HTTP sin estado (`servidor_http.py`), y tests con pytest y el cliente en memoria, sin procesos ni red.

Los datos de inventario están en memoria, dentro de `servidor.py`.

## Requisitos

- [uv](https://docs.astral.sh/uv/) (probado con 0.11). Si no tienes Python 3.13, `uv` lo descarga.
- `curl`, para la prueba por HTTP.

No hace falta ninguna clave de API.

Si prefieres pip: crea un entorno con Python 3.13 o superior, ejecuta `pip install "mcp[cli]==2.2.0" "pytest==9.1.1"` y cambia `uv run` por nada en los comandos de abajo. Los comandos verificados son los de `uv`.

## Instalar

```bash
uv sync
uv run mcp version
# MCP version 2.2.0
```

`uv sync` crea `.venv` e instala las versiones exactas de `uv.lock`, incluido pytest (grupo `dev`).

## Tests

```bash
uv run pytest -q test_servidor.py
```

Salida esperada:

```text
.....                                                                    [100%]
5 passed in 0.30s
```

Los cinco tests usan el cliente en memoria (`Client(servidor.mcp)`) y cubren las dos tools: que ninguna acepta el inquilino como argumento y que las dos declaran las cuatro anotaciones, la salida estructurada de `consultar_existencias`, el error de negocio (`is_error`) con un almacén de otro inquilino, que un fallo interno de `alertas_rotura_stock` no filtra detalles, y que un resource inexistente es un error de protocolo (-32602). Para ver el nombre de cada test: `uv run pytest -v test_servidor.py`.

## Probar por stdio con el cliente

Sin argumentos, `cliente.py` lanza `servidor.py` como proceso hijo:

```bash
uv run python cliente.py
```

Salida esperada (las líneas `nortia.auditoria ...` van a stderr y aparecen mezcladas):

```text
protocolo: 2026-07-28 | servidor: nortia-almacen
tool: consultar_existencias | argumentos: ['almacen', 'sku']
tool: alertas_rotura_stock | argumentos: ['almacen']
alertas MAD-01 -> {'result': [{'sku': 'CAJ-CART-40', 'unidades': 95, 'reservadas': 20, 'disponibles': 75, 'punto_pedido': 200, 'estado': 'bajo'}]}
otro inquilino -> is_error: True | Error executing tool consultar_existencias: El almacén MEX-01 no existe. Almacenes válidos: ['BCN-02', 'MAD-01']
almacen://almacenes -> [  "BCN-02",  "MAD-01"]
prompt -> user | Eres responsable del almacén BCN-02 de Nortia. Llama a alert...
```

También puedes escribir los mensajes a mano en la entrada del servidor. `peticiones.jsonl` trae dos `tools/call` completas, con su `_meta` (la segunda pide un almacén de otro inquilino):

```bash
(cat peticiones.jsonl; sleep 1) | uv run python servidor.py
```

Por stdout salen las dos respuestas JSON-RPC (la segunda con `"isError":true`) y por stderr la auditoría.

## Probar por Streamable HTTP

Arranca el servidor en una terminal (escucha en `127.0.0.1:8765`, sin estado y con respuestas JSON):

```bash
uv run python servidor_http.py
```

En otra terminal, el mismo cliente con la URL:

```bash
uv run python cliente.py http://127.0.0.1:8765/mcp
```

La salida es la misma que por stdio. Y una petición a mano con `curl`:

```bash
curl -si http://127.0.0.1:8765/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'MCP-Protocol-Version: 2026-07-28' \
    -H 'Mcp-Method: resources/read' \
    -H 'Mcp-Name: almacen://almacenes' \
    -d '{"jsonrpc":"2.0","id":7,"method":"resources/read","params":{"uri":"almacen://almacenes","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Responde `HTTP/1.1 200 OK` con `content-type: application/json` y un resultado con `"contents"`, `"resultType":"complete"` y el `serverInfo` en `_meta`. Para el servidor con Ctrl+C.

## Variables de entorno

Están descritas en `.env.example`. No se leen de ningún archivo: pásalas en la línea de comandos.

| Variable | Para qué |
|---|---|
| `NORTIA_INQUILINO` | `es` (por defecto) o `mx`. Con `NORTIA_INQUILINO=mx uv run python servidor_http.py`, `almacen://almacenes` devuelve solo `MEX-01` (y el cliente, pensado para España, recibe errores en las tools). Por stdio, `cliente.py` lanza el servidor sin pasarle esa variable, así que siempre usa `es`. |

## Archivos

| Archivo | Qué hay |
|---|---|
| `servidor.py` | El servidor: datos, modelos, tools, resources, prompt y arranque por stdio |
| `servidor_http.py` | Arranque por Streamable HTTP sin estado |
| `cliente.py` | Cliente mínimo por stdio o por HTTP |
| `test_servidor.py` | Cinco tests con el cliente en memoria |
| `peticiones.jsonl` | Dos peticiones para enviar a mano por stdio |
| `pyproject.toml`, `uv.lock` | Dependencias con versiones fijadas |
