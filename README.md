# Ejemplos del curso de MCP de DesarrolloMCP

Código ejecutable del [curso de Model Context Protocol en español](https://desarrollomcp.com/aprende) de DesarrolloMCP, escrito para la especificación **MCP 2026-07-28** (el protocolo sin estado) y los SDK oficiales de TypeScript y Python.

Todos los ejemplos siguen el mismo caso, Nortia Logística: una empresa ficticia de logística con operaciones en España y México. Ninguno es una calculadora ni un "hola mundo".

## Qué hay aquí

| Carpeta | Lección | Qué construyes |
|---|---|---|
| [`basico/09-typescript`](basico/09-typescript) | [Servidor en TypeScript](https://desarrollomcp.com/aprende/09-typescript) | `nortia-pedidos` con el SDK v2 de TypeScript: tools, resources y prompt, por stdio y Streamable HTTP, probado con un cliente, con tests en memoria y con el Inspector |
| [`basico/10-fastmcp`](basico/10-fastmcp) | [Servidor en Python](https://desarrollomcp.com/aprende/10-fastmcp) | `nortia-almacen` con el SDK oficial de Python: salida estructurada, errores, stdio, HTTP, cliente y tests |
| [`basico/11-agentes-mcp`](basico/11-agentes-mcp) | [Agentes + MCP](https://desarrollomcp.com/aprende/11-agentes-mcp) | Un agente que orquesta dos servidores de Nortia, con límites de coste, aprobación humana y auditoría, en TypeScript y Python, y tests de las tres tools de los servidores de prueba |

Cada carpeta tiene un `LEEME.md` con los requisitos y los comandos exactos para instalar, arrancar y probar. Las dependencias están fijadas y vienen de npm y PyPI. Lo que necesita una clave de API externa está marcado en cada LEEME.

Las lecciones son gratis con registro: el nivel Básico del curso (14 lecciones) no cuesta nada.

## ¿Y los niveles Avanzado y Experto?

Cada lección de [Avanzado](https://desarrollomcp.com/aprende/avanzado) y [Experto](https://desarrollomcp.com/aprende/experto) incluye su proyecto completo en un ZIP, que se descarga desde la propia lección con el nivel comprado. Ahí están los servidores en Cloudflare Workers, OAuth, PostgreSQL y D1, pasarelas, seguridad y sistemas multi-agente.

## Licencia

El código de este repositorio se publica con licencia [MIT](LICENSE). El texto de las lecciones no forma parte del repositorio y sigue las [condiciones del sitio](https://desarrollomcp.com/terms).

¿Errores o dudas? Abre un issue o escribe a info@desarrollomcp.com.
