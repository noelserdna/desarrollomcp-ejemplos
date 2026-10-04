export type Inquilino = 'es' | 'mx';

export const ESTADOS = {
    preparacion: 'El almacén está preparando el pedido; todavía no ha salido.',
    en_transito: 'En ruta entre almacenes o hacia la delegación de reparto.',
    en_reparto: 'En el vehículo de reparto; entrega prevista hoy.',
    entregado: 'Entregado y firmado por el destinatario.',
    incidencia: 'Entrega fallida o mercancía dañada; hay una incidencia abierta.'
} as const;
export type EstadoEnvio = keyof typeof ESTADOS;

export interface Pedido {
    id: string;
    inquilino: Inquilino;
    clienteRef: string; // referencia interna; el nombre y la dirección no salen de este sistema
    estado: EstadoEnvio;
    almacen: string;
    transportista: string;
    entregaPrevista: string; // fecha ISO (AAAA-MM-DD)
}

// Todo método recibe el inquilino: ninguna consulta puede cruzar España y México por descuido.
export interface RepositorioPedidos {
    buscarPorId(inquilino: Inquilino, id: string): Promise<Pedido | undefined>;
    listarRecientes(inquilino: Inquilino, limite: number): Promise<Pedido[]>;
}

const base = { transportista: 'TransIberia', entregaPrevista: '2026-10-02' };
const DATOS: Pedido[] = [
    { ...base, id: 'PED-2026-004812', inquilino: 'es', clienteRef: 'CLI-0931', estado: 'en_reparto',
      almacen: 'MAD-01' },
    { ...base, id: 'PED-2026-004797', inquilino: 'es', clienteRef: 'CLI-0417', estado: 'incidencia',
      almacen: 'BCN-02', entregaPrevista: '2026-09-30' },
    { ...base, id: 'PED-2026-003120', inquilino: 'mx', clienteRef: 'CLI-2204', estado: 'en_transito',
      almacen: 'MEX-01', transportista: 'Fletes del Bajío', entregaPrevista: '2026-10-05' }
];

export class RepositorioEnMemoria implements RepositorioPedidos {
    async buscarPorId(inquilino: Inquilino, id: string): Promise<Pedido | undefined> {
        return DATOS.find(p => p.inquilino === inquilino && p.id === id);
    }

    async listarRecientes(inquilino: Inquilino, limite: number): Promise<Pedido[]> {
        return DATOS.filter(p => p.inquilino === inquilino).slice(0, limite);
    }
}
