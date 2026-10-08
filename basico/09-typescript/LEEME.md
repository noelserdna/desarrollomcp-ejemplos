# Lección 9: servidor MCP en TypeScript (`nortia-pedidos`)

Código de la lección [Servidor en TypeScript](https://desarrollomcp.com/aprende/09-typescript) del curso de MCP de desarrollomcp.com.

Es el servidor `nortia-pedidos` de Nortia Logística escrito con el SDK oficial de TypeScript (v2), que habla la versión 2026-07-28 del protocolo. Con él ves:

- Un servidor escrito como fábrica (`crearServidor`) con una tool (`buscar_pedido`), un resource fijo (`pedidos://catalogo/estados`), una plantilla de resource (`pedidos://pedido/{pedidoId}`) y un prompt (`respuesta_retraso`).
- El mismo servidor servido por stdio (`src/stdio.ts`, con `serveStdio`) y por Streamable HTTP sin estado (`src/http.ts`, con `createMcpHandler`).
- Multi-tenant: el inquilino (`es` o `mx`) lo fija quien despliega el proceso con `NORTIA_INQUILINO`, y un pedido de otro inquilino responde igual que uno inexistente.
- La diferencia entre un error de ejecución (`isError: true`, lo lee el modelo) y un error de protocolo (`ProtocolError` en el cliente).
- Auditoría de cada acceso en stderr, porque en stdio stdout es el canal del protocolo.

Los datos están en memoria (`src/pedidos.ts`); en el nivel Avanzado el repositorio pasa a PostgreSQL.

## Requisitos

- Node.js 20 o superior (probado con Node 24). El Inspector del último apartado pide Node 22.19 o superior.
- npm.
- `curl`, para la prueba por HTTP.

No hace falta ninguna clave de API.

## Instalar

```bash
cd nortia-pedidos
npm ci
```

`npm ci` instala exactamente las versiones de `package-lock.json` (SDK `@modelcontextprotocol/server` y `@modelcontextprotocol/client` 2.3.0, Zod 4.6.5, TypeScript 7.0.2).

## Comprobar los tipos

```bash
npx tsc -p .
```

No escribe nada (`noEmit`) y termina sin errores. Comprueba también los tests. Los archivos `.ts` se ejecutan directamente con `tsx`.

## Tests

```bash
npm test
```

Ejecuta `test/servidor.test.ts` con el runner de Node (`node --import tsx --test`), sin dependencias nuevas. El servidor y el cliente oficiales se conectan en el mismo proceso, sin red ni procesos hijos, y las mismas siete comprobaciones se repiten en las dos eras del protocolo: 2026-07-28 (pasando `handler.fetch` de `createMcpHandler` como `fetch` del `StreamableHTTPClientTransport`) y 2025-11-25 (`InMemoryTransport.createLinkedPair()`, que solo conecta esa era). Comprueban:

- que `buscar_pedido` se lista con sus cuatro anotaciones (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`);
- la llamada correcta, con el pedido en `structuredContent` y sin el inquilino;
- los errores de negocio con `isError: true` (pedido inexistente, pedido de otro inquilino y formato inválido, que no llega al handler);
- que una tool desconocida es un error de protocolo (`ProtocolError` -32602);
- y lo que queda en la auditoría (nada en el caso del formato inválido).

Salida esperada (final):

```text
ℹ tests 14
ℹ suites 2
ℹ pass 14
ℹ fail 0
```

## Probar por stdio con el cliente mínimo

El cliente lanza el servidor como proceso hijo (con `NORTIA_INQUILINO=es`) y recorre diez casos: cuatro que funcionan y seis que fallan de una forma concreta.

```bash
npx tsx src/cliente.ts 2>auditoria.log
```

Salida esperada (resumida):

```text
versión: 2026-07-28 {"name":"nortia-pedidos","version":"1.4.0"}
tools: [["buscar_pedido",{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}]]
...
1) pedido: PED-2026-004812 en_reparto 2026-10-02
2) no existe: {"isError":true,"content":[{"type":"text","text":"No existe el pedido PED-2026-999999 en este entorno. ..."}]}
3) otro inquilino: {"isError":true,"content":[{"type":"text","text":"No existe el pedido PED-2026-003120 en este entorno. ..."}]}
4) formato: {"isError":true,"content":[{"type":"text","text":"Input validation error: ... pedido_id: Formato esperado: PED-AAAA-NNNNNN"}]}
...
8) tool desconocida: {"code":-32602,"message":"Tool borrar_pedido not found"}
9) resource inexistente: {"code":-32602,"message":"Resource not found: pedidos://pedido/PED-2026-999999","data":{"uri":"pedidos://pedido/PED-2026-999999"}}
10) prompt inválido: {"code":-32602,"message":"Invalid arguments for prompt respuesta_retraso: pedido_id: Formato esperado: PED-AAAA-NNNNNN"}
```

En `auditoria.log` queda la línea de arranque y una línea JSON por cada acceso que llegó al handler (el caso 4 no aparece: la validación lo para antes).

## Probar por Streamable HTTP

Arranca el servidor en una terminal:

```bash
NORTIA_INQUILINO=es npx tsx src/http.ts
# nortia-pedidos (es) en http://127.0.0.1:3000/mcp
```

Y en otra, envía la petición de `peticion.json` (una `tools/call` completa, con su `_meta`):

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: buscar_pedido' \
  -d @peticion.json
```

La respuesta trae el pedido en `content` y en `structuredContent`, `"resultType":"complete"` y el `serverInfo` en `_meta`. El puerto se cambia con `PORT` (por defecto 3000). Para el servidor con Ctrl+C.

El servidor solo escucha en `127.0.0.1` y no tiene autorización: no lo expongas tal cual (la lección explica por qué en "En producción").

## Probar con el MCP Inspector

`.inspector/config.json` describe cómo lanzar el servidor por stdio. Con él, cada comprobación es una línea (necesita Node 22.19 o superior; `npx` descarga el Inspector la primera vez):

```bash
export MCP_CLIENT_CONFIG_PATH="$PWD/.inspector/mcp.json"

npx -y @modelcontextprotocol/inspector@2.9.0 --cli --config .inspector/config.json \
  --server nortia-pedidos --protocol-era modern \
  --method tools/call --tool-name buscar_pedido --tool-args-json '{"pedido_id":"PED-2026-999999"}'
echo "exit=$?"
```

Imprime el resultado con `"isError": true` y termina con `exit=5`. Con un pedido que existe (`PED-2026-004812`) termina con 0.

## Variables de entorno

Están descritas en `.env.example`. No se leen de ningún archivo: pásalas en la línea de comandos, como en los ejemplos.

| Variable | Para qué |
|---|---|
| `NORTIA_INQUILINO` | `es` o `mx`. Obligatoria para `src/stdio.ts` y `src/http.ts`: sin ella el servidor no arranca. |
| `PORT` | Puerto de `src/http.ts`. Por defecto, 3000. |

## Archivos

| Archivo | Qué hay |
|---|---|
| `src/pedidos.ts` | Tipos del dominio, estados de envío y repositorio en memoria |
| `src/servidor.ts` | La fábrica `crearServidor`: tool, resources y prompt |
| `src/entorno.ts` | Dependencias por proceso: repositorio, inquilino y auditoría |
| `src/stdio.ts` | Punto de entrada por stdio |
| `src/http.ts` | Punto de entrada por Streamable HTTP sin estado |
| `src/cliente.ts` | Cliente mínimo que recorre los diez casos |
| `test/servidor.test.ts` | Tests de la tool en memoria, en las dos eras del protocolo |
| `peticion.json` | Cuerpo de la petición HTTP de ejemplo |
| `.inspector/config.json` | Configuración del Inspector |
