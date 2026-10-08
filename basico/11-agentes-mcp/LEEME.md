# Lección 11: un agente que usa servidores MCP

Código de la lección [Agentes + MCP](https://desarrollomcp.com/aprende/11-agentes-mcp) del curso de MCP de desarrollomcp.com.

Es el agente de soporte de Nortia Logística: recibe un caso ("el pedido llegó con un palé dañado, abona esa línea"), consulta `nortia-pedidos` y `nortia-facturacion` y emite un abono. Está en TypeScript (`ts/`) y en Python (`py/`), con la misma estructura:

- **El bucle** (`agente.ts`, `agente.py`): pide un turno al modelo, ejecuta las tools que pide y corta por límites de iteraciones, de tokens y de errores seguidos. No sabe nada de MCP.
- **El puente** (`puente.ts`, `puente.py`): el lado MCP. Abre un cliente por servidor, enruta cada tool a su servidor, pide aprobación humana para las tools con efecto, aplica un timeout, trunca resultados largos y escribe una línea de auditoría por llamada en `auditoria.jsonl`.
- **La demo** (`demo.ts`, `demo.py`): ejecuta el bucle y el puente reales contra servidores MCP reales, pero con un **modelo guionizado** en lugar de Claude. Por eso no necesita clave de API y su salida es siempre la misma.
- **Las tres vías con Claude**: bucle propio con la API de Mensajes (`claude.ts`, `claude.py`), el tool runner del SDK de Anthropic y el conector MCP de la API (`vias-claude.ts`, `vias_claude.py`).
- **Los servidores de prueba** (`ts/src/servidores-de-prueba.ts`): dobles en memoria de `nortia-pedidos` y `nortia-facturacion` en un solo proceso, en `http://127.0.0.1:3211/pedidos/mcp` y `/facturacion/mcp`. La demo de Python usa estos mismos servidores, así que también necesita Node.

## Requisitos

- Node.js 20.6 o superior (probado con Node 24) y npm.
- [uv](https://docs.astral.sh/uv/) (probado con 0.11) para la parte de Python. Si no tienes Python 3.13, `uv` lo descarga.
- `curl` y `bash`, solo para `correr.sh`.

## Qué necesita una clave de API

| Parte | ¿Llama a la API de Anthropic? |
|---|---|
| `demo.ts`, `demo.py` | No. Modelo guionizado. |
| `vias-claude.ts`, `vias_claude.py` | No. Construyen el tool runner y la petición del conector "en seco" y prueban el adaptador MCP contra el servidor de prueba, sin enviar nada a Anthropic. |
| `claude.ts`, `claude.py` | Sí. Es la función `pedirTurno` que sustituye al modelo guionizado. **No se ha ejecutado contra la API** en el curso: el código TypeScript compila y el de Python se importa, nada más. |

Para usar `claude.ts` o `claude.py` necesitas tu propia `ANTHROPIC_API_KEY` y elegir `ANTHROPIC_MODEL` en la documentación de modelos de Anthropic (ver `.env.example`). Para conectarlo, cambia en la demo `modeloGuionizado` por `pedirTurnoClaude` (o `modelo_guionizado` por `pedir_turno_claude`). Cada ejecución consume tokens de tu cuenta.

## Instalar

```bash
cd ts && npm ci && cd ..
cd py && uv sync && cd ..
```

Versiones fijadas: `@modelcontextprotocol/client` y `@modelcontextprotocol/server` 2.3.0, `@anthropic-ai/sdk` 0.131.0, `mcp` 2.2.0 y `anthropic` 1.11.0.

## Comprobar los tipos (TypeScript)

```bash
cd ts
npx tsc -p .
```

Termina sin errores.

## Tests de los servidores de prueba (TypeScript)

```bash
cd ts
npm test
```

Ejecuta `test/servidores-de-prueba.test.ts` con el runner de Node (`node --import tsx --test`), sin dependencias nuevas. El test arranca `src/servidores-de-prueba.ts` como proceso hijo en un puerto libre (no hace falta tenerlos abiertos ni deja el 3211 ocupado), se conecta a los dos endpoints con el cliente oficial por Streamable HTTP y comprueba:

- que se negocia 2026-07-28 y que las tres tools se listan con sus cuatro anotaciones: `buscar_pedido` y `buscar_factura` de solo lectura (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`) y `emitir_abono` destructiva y no idempotente (`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: false`);
- la llamada correcta de cada tool, incluido el abono, que se contabiliza y cambia lo abonado de la factura;
- los errores de negocio con `isError: true` (pedido o factura inexistentes, importe mayor que lo abonable, motivo demasiado corto);
- que una tool desconocida es un error de protocolo (`ProtocolError` -32602).

Salida esperada (final):

```text
ℹ tests 10
ℹ suites 2
ℹ pass 10
ℹ fail 0
```

`openWorldHint: false` en `emitir_abono` refleja que la tool solo toca el sistema de facturación propio, no entidades externas. Recuerda que las anotaciones son pistas: el puente no se fía de ellas y decide la aprobación con su propia lista (`sinAprobacion`).

## Ejecutar la demo

En una terminal, arranca los servidores de prueba y déjalos abiertos:

```bash
cd ts
npx tsx src/servidores-de-prueba.ts
# nortia-pedidos y nortia-facturacion en http://127.0.0.1:3211
```

En otra terminal:

```bash
cd ts
APROBAR=si npx tsx src/demo.ts
```

Salida esperada (resumida):

```text
tools: buscar_pedido, buscar_factura, emitir_abono | 972 caracteres de definiciones
1. tool_use buscar_pedido {"pedido_id":"PED-2026-004812"}
   tool_result is_error=false: {"id":"PED-2026-004812","estado":"incidencia","factura":"F-2026-0142","almacen":"MAD-01"}
2. tool_use buscar_factura {"factura_id":"F-2026-142"}
   tool_result is_error=true: No existe la factura F-2026-142. Formato esperado: F-2026-0142.
3. tool_use buscar_factura {"factura_id":"F-2026-0142"}
   tool_result is_error=false: {"id":"F-2026-0142","pedido":"PED-2026-004812","total":1210,"moneda":"EUR","abonado":0}
4. tool_use emitir_abono {"factura_id":"F-2026-0142","importe":184.5,"motivo":"Mercancía dañada en la entrega"}
   aprobación: nortia-facturacion/emitir_abono {...} -> aprobada
   tool_result is_error=false: {"abono":"R-2026-0017","factura":"F-2026-0142","importe":184.5,"moneda":"EUR","motivo":"Mercancía dañada en la entrega"}
final: {"motivo":"respuesta","texto":"(texto final del guion)","iteraciones":5,"tokens":13900}
```

La auditoría queda en `ts/auditoria.jsonl` (se reescribe en cada ejecución). Los servidores de prueba guardan el estado en memoria mientras siguen abiertos: si repites la demo, `abonado` ya no es 0.

La versión en Python se ejecuta igual, con los mismos servidores de prueba abiertos:

```bash
cd py
APROBAR=si uv run python demo.py
```

### Los límites del bucle

Con los servidores de prueba abiertos, desde `ts/` (en `py/`, cambia `npx tsx src/demo.ts` por `uv run python demo.py`):

```bash
npx tsx src/demo.ts                              # nadie aprueba: emitir_abono se deniega
APROBAR=si MAX_TOKENS=10000 npx tsx src/demo.ts  # presupuesto de tokens: termina con "max_tokens" antes del abono
npx tsx src/demo.ts --bucle                      # el guion repite la misma tool: "max_iteraciones" a la sexta
```

### Timeout con una tool con efecto

Para los servidores (Ctrl+C) y arráncalos con facturación lenta:

```bash
RETARDO_FACTURACION_MS=3000 npx tsx src/servidores-de-prueba.ts
```

Y en otra terminal:

```bash
APROBAR=si TIMEOUT_MS=1000 npx tsx src/demo.ts   # en Python: APROBAR=si TIMEOUT_S=1 uv run python demo.py
```

El agente termina con `"motivo":"errores_seguidos"`, y unos segundos después el servidor escribe `[nortia-facturacion] abono de 184.5 EUR contabilizado en F-2026-0142`: el abono se hizo aunque el agente no recibió respuesta. Es el caso que la lección analiza.

### Las vías 2 y 3, en seco

Con los servidores de prueba normales abiertos:

```bash
# desde ts/
npx tsx src/vias-claude.ts
# run() a mano -> [{"type":"text","text":"{\"id\":\"PED-2026-004812\",\"estado\":\"incidencia\",...}"}]
# sin ejecutar: function function | mcp_servers: 1

# desde py/
uv run python vias_claude.py
# definición para Claude: {'name': 'buscar_pedido', ...}
# call() a mano -> [{'type': 'text', 'text': '{"id":"PED-2026-004812",...}'}]
# runner sin iterar: BetaAsyncToolRunner
# petición del conector sin enviar: ['betas', 'max_tokens', 'mcp_servers', 'messages', 'model', 'tools']
```

No envían nada a la API de Anthropic. La URL del conector (`https://mcp.nortia.example/pedidos/mcp`) es ficticia.

## Todo de una vez

`correr.sh` arranca y para los servidores de prueba por su cuenta (puerto 3211, o el de `PUERTO`) y ejecuta todos los escenarios anteriores en TypeScript y en Python. Tarda alrededor de un minuto:

```bash
./correr.sh
```

Necesita haber hecho antes la instalación de las dos carpetas.

## Variables de entorno

Están descritas en `.env.example`. Ningún script lee archivos `.env`: pásalas en la línea de comandos o expórtalas en tu terminal.

| Variable | Para qué |
|---|---|
| `APROBAR` | `si` aprueba las tools con efecto; cualquier otro valor (o ninguno) las deniega |
| `MAX_TOKENS` | Presupuesto de tokens del bucle (por defecto 40000) |
| `TIMEOUT_MS`, `TIMEOUT_S` | Timeout por tool en TypeScript (ms, por defecto 5000) y en Python (s, por defecto 5) |
| `MCP_BASE` | Dónde están los servidores de prueba (por defecto `http://127.0.0.1:3211`) |
| `PORT`, `RETARDO_FACTURACION_MS` | Puerto y retardo artificial de los servidores de prueba |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Solo para `claude.ts` y `claude.py` |
| `NORTIA_MCP_TOKEN` | Solo para enviar de verdad la petición del conector (vía 3) |
