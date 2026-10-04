#!/usr/bin/env bash
# Ejecuta todos los escenarios de la lección, en TypeScript y en Python, y los muestra en la terminal.
# Requisitos: haber ejecutado antes `npm ci` en ts/ y `uv sync` en py/. No llama a la API de Anthropic.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
PUERTO="${PUERTO:-3211}"
export MCP_BASE="http://127.0.0.1:$PUERTO"
PID=""

parar() {
    if [ -n "$PID" ]; then
        kill "$PID" 2>/dev/null || true
        wait "$PID" 2>/dev/null || true
        PID=""
    fi
}
trap parar EXIT

# Arranca los servidores de prueba con las variables que se le pasen (por ejemplo RETARDO_FACTURACION_MS=3000).
arrancar() {
    parar
    (cd "$RAIZ/ts" && exec env "$@" PORT="$PUERTO" node --import tsx src/servidores-de-prueba.ts) &
    PID=$!
    for _ in $(seq 1 60); do
        curl -s -o /dev/null "$MCP_BASE/pedidos/mcp" && return 0
        sleep 0.5
    done
    echo "Los servidores de prueba no han arrancado en $MCP_BASE" >&2
    exit 1
}

titulo() { printf '\n=== %s\n' "$1"; }

titulo "Tipos (tsc)"
(cd "$RAIZ/ts" && npx tsc -p . && echo "sin errores")

arrancar RETARDO_FACTURACION_MS=0

cd "$RAIZ/ts"
titulo "TS A: APROBAR=si"
APROBAR=si npx tsx src/demo.ts
titulo "TS B: nadie aprueba"
npx tsx src/demo.ts
titulo "TS C: presupuesto de tokens (MAX_TOKENS=10000)"
APROBAR=si MAX_TOKENS=10000 npx tsx src/demo.ts
titulo "TS D: el guion repite la misma tool (--bucle)"
npx tsx src/demo.ts --bucle
titulo "TS vías 2 y 3 en seco"
npx tsx src/vias-claude.ts

cd "$RAIZ/py"
titulo "PY A: APROBAR=si"
APROBAR=si uv run python demo.py
titulo "PY B: nadie aprueba"
uv run python demo.py
titulo "PY C: presupuesto de tokens (MAX_TOKENS=10000)"
APROBAR=si MAX_TOKENS=10000 uv run python demo.py
titulo "PY D: el guion repite la misma tool (--bucle)"
uv run python demo.py --bucle
titulo "PY vías 2 y 3 en seco"
uv run python vias_claude.py

titulo "TS E: facturación lenta (RETARDO_FACTURACION_MS=3000, TIMEOUT_MS=1000)"
arrancar RETARDO_FACTURACION_MS=3000
cd "$RAIZ/ts"
APROBAR=si TIMEOUT_MS=1000 npx tsx src/demo.ts
sleep 3 # deja que el servidor termine el abono que el agente dio por perdido

titulo "PY E: facturación lenta (RETARDO_FACTURACION_MS=3000, TIMEOUT_S=1)"
arrancar RETARDO_FACTURACION_MS=3000
cd "$RAIZ/py"
APROBAR=si TIMEOUT_S=1 uv run python demo.py
sleep 3
