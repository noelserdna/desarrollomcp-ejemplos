import { RepositorioEnMemoria } from './pedidos.js';
import type { Dependencias } from './servidor.js';

// Una sola instancia por proceso: aquí irá el pool de PostgreSQL. La fábrica del servidor no lo crea.
const repo = new RepositorioEnMemoria();

export function dependencias(transporte: 'stdio' | 'http'): Dependencias {
    const inquilino = process.env.NORTIA_INQUILINO;
    if (inquilino !== 'es' && inquilino !== 'mx') {
        throw new Error('NORTIA_INQUILINO debe ser "es" o "mx"');
    }
    return {
        repo,
        inquilino,
        // stdout es el canal JSON-RPC en stdio: la auditoría va siempre a stderr.
        auditar: evento =>
            console.error(JSON.stringify({ ...evento, inquilino, transporte, ts: new Date().toISOString() }))
    };
}
