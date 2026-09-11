#!/usr/bin/env node
/**
 * Servidor MCP para la API de Interbanking (Argentina).
 *
 * Expone SOLO consultas: saldos, saldos historicos y movimientos. No hay
 * ninguna herramienta que mueva plata. La funcion generica del cliente
 * (apiRequest, que acepta cualquier metodo HTTP) queda deliberadamente afuera,
 * asi el servidor es de solo lectura por construccion y no por convencion.
 *
 * Credenciales por variables de entorno (las mismas del cliente):
 *   IB_CLIENT_ID, IB_CLIENT_SECRET, IB_REDIRECT_URL, IB_CUSTOMER_ID
 *
 * Todo lo que se imprima por stdout corrompe el protocolo JSON-RPC: los
 * mensajes del cliente van a stderr (el cliente ya loguea ahi por defecto).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient } from 'interbanking-client';

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD');

// Cuantos movimientos se muestran en detalle cuando no se pide el crudo.
const MOVIMIENTOS_EN_RESUMEN = 25;

// El cliente se construye en la primera consulta, no al arrancar: si faltan
// credenciales queremos que el agente vea un error legible, no que el servidor
// no levante.
let cliente = null;
function getCliente() {
  if (!cliente) cliente = createClient();
  return cliente;
}

function texto(contenido) {
  return { content: [{ type: 'text', text: contenido }] };
}

function error(e) {
  const detalle = e?.response?.data?.message || e?.message || String(e);
  return { content: [{ type: 'text', text: `Error consultando Interbanking: ${detalle}` }], isError: true };
}

const money = (n) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(n) || 0);

const server = new McpServer({
  name: 'interbanking',
  version: '1.0.0',
});

server.registerTool(
  'listar_cuentas',
  {
    title: 'Listar cuentas',
    description:
      'Lista las cuentas bancarias disponibles con su banco, tipo, moneda y numero. ' +
      'Util como primer paso para saber que cuentas existen antes de pedir movimientos.',
    inputSchema: {},
  },
  async () => {
    try {
      const data = await getCliente().getBalances();
      const cuentas = data.accounts || [];
      if (cuentas.length === 0) return texto('No se encontraron cuentas.');

      const lineas = cuentas.map(
        (a) =>
          `- ${a.account_name} | banco ${a.bank_number} | ${a.account_type} | ${a.currency} | cuenta ${a.account_number}`
      );
      return texto(`${cuentas.length} cuenta(s):\n${lineas.join('\n')}`);
    } catch (e) {
      return error(e);
    }
  }
);

server.registerTool(
  'saldos',
  {
    title: 'Consultar saldos',
    description:
      'Saldos actuales de todas las cuentas: contable, operativo y proyectado. ' +
      'Acepta un rango de fechas opcional de hasta 64 dias; para rangos mas largos usar saldos_historicos.',
    inputSchema: {
      desde: FECHA.optional().describe('Fecha desde (YYYY-MM-DD), opcional'),
      hasta: FECHA.optional().describe('Fecha hasta (YYYY-MM-DD), opcional'),
      moneda: z.enum(['ARS', 'USD']).optional().describe('Filtrar por moneda'),
    },
  },
  async ({ desde, hasta, moneda }) => {
    try {
      const params = {};
      if (desde) params['date-since'] = desde;
      if (hasta) params['date-until'] = hasta;
      if (moneda) params.currency = moneda;

      const data = await getCliente().getBalances(params);
      const cuentas = data.accounts || [];
      if (cuentas.length === 0) return texto('No se encontraron cuentas.');

      const lineas = cuentas.map((a) => {
        const b = a.balances || {};
        return (
          `- ${a.account_name} (banco ${a.bank_number}, ${a.currency})\n` +
          `    contable: ${money(b.countable_balance)} | operativo: ${money(b.operative_balance)}`
        );
      });

      const periodo = data.general_data
        ? `Periodo: ${data.general_data.date_since} a ${data.general_data.date_until}\n\n`
        : '';
      return texto(`${periodo}${lineas.join('\n')}`);
    } catch (e) {
      return error(e);
    }
  }
);

server.registerTool(
  'saldos_historicos',
  {
    title: 'Saldos historicos',
    description:
      'Saldos diarios en un rango de fechas largo. Parte el rango automaticamente en tramos ' +
      'de 60 dias porque la API no acepta mas de 64 por consulta, y devuelve la serie unificada. ' +
      'Devuelve un resumen por cuenta; usar detalle para la serie dia por dia.',
    inputSchema: {
      desde: FECHA.describe('Fecha desde (YYYY-MM-DD)'),
      hasta: FECHA.describe('Fecha hasta (YYYY-MM-DD)'),
      detalle: z
        .boolean()
        .optional()
        .describe('Si es true, devuelve el saldo de cada dia. Puede ser mucho texto.'),
    },
  },
  async ({ desde, hasta, detalle = false }) => {
    try {
      const data = await getCliente().getBalancesRange(desde, hasta);
      const cuentas = data.accounts || [];
      if (cuentas.length === 0) return texto('No se encontraron cuentas.');

      const bloques = cuentas.map((a) => {
        const serie = a.historical_balances || [];
        const cab = `${a.account_name} (banco ${a.bank_number}, ${a.currency}) - ${serie.length} dias`;
        if (!detalle || serie.length === 0) {
          const primero = serie[0];
          const ultimo = serie[serie.length - 1];
          if (!primero) return `${cab}\n    sin datos en el rango`;
          return (
            `${cab}\n` +
            `    ${primero.operation_date}: ${money(primero.countable_balance)}\n` +
            `    ${ultimo.operation_date}: ${money(ultimo.countable_balance)}`
          );
        }
        const dias = serie.map((d) => `    ${d.operation_date}: ${money(d.countable_balance)}`);
        return `${cab}\n${dias.join('\n')}`;
      });

      return texto(`Saldos de ${desde} a ${hasta}\n\n${bloques.join('\n\n')}`);
    } catch (e) {
      return error(e);
    }
  }
);

server.registerTool(
  'movimientos',
  {
    title: 'Consultar movimientos',
    description:
      'Movimientos de todas las cuentas en un rango de fechas. Descubre las cuentas solo. ' +
      `Por defecto devuelve un resumen (totales por cuenta y los ${MOVIMIENTOS_EN_RESUMEN} mas recientes); ` +
      'pedir detalle solo para rangos cortos, porque un rango largo son miles de registros.',
    inputSchema: {
      desde: FECHA.describe('Fecha desde (YYYY-MM-DD)'),
      hasta: FECHA.describe('Fecha hasta (YYYY-MM-DD)'),
      tipo: z
        .enum(['dia', 'anteriores', 'diferidos'])
        .optional()
        .describe('Tipo de movimiento. Default: anteriores'),
      detalle: z
        .boolean()
        .optional()
        .describe('Si es true, lista todos los movimientos en vez del resumen.'),
    },
  },
  async ({ desde, hasta, tipo = 'anteriores', detalle = false }) => {
    try {
      const movs = await getCliente().getAllMovements(desde, hasta, { movementType: tipo });
      if (movs.length === 0) return texto(`Sin movimientos entre ${desde} y ${hasta}.`);

      const fmt = (m) => {
        const signo = m.debit_credit_type === 'C' || Number(m.amount) > 0 ? '+' : '-';
        const concepto = [m.code_description_ib, m.depositor_description]
          .filter(Boolean)
          .join(' · ');
        return `    ${m.movement_date} | ${signo}${money(Math.abs(Number(m.amount) || 0))} | ${concepto}`;
      };

      // Agrupar por cuenta para que el resumen sea legible
      const porCuenta = new Map();
      for (const m of movs) {
        const key = m._bank_name || `${m._bank_number}-${m._account_number}`;
        if (!porCuenta.has(key)) porCuenta.set(key, []);
        porCuenta.get(key).push(m);
      }

      const bloques = [...porCuenta.entries()].map(([cuenta, lista]) => {
        const creditos = lista.filter((m) => m.debit_credit_type === 'C' || Number(m.amount) > 0);
        const debitos = lista.filter((m) => !(m.debit_credit_type === 'C' || Number(m.amount) > 0));
        const suma = (arr) => arr.reduce((t, m) => t + Math.abs(Number(m.amount) || 0), 0);

        const cab =
          `${cuenta}\n` +
          `    ${lista.length} movimientos | creditos: ${creditos.length} (${money(suma(creditos))}) | ` +
          `debitos: ${debitos.length} (${money(suma(debitos))})`;

        const mostrar = detalle
          ? lista
          : [...lista]
              .sort((a, b) => String(b.movement_date).localeCompare(String(a.movement_date)))
              .slice(0, MOVIMIENTOS_EN_RESUMEN);

        const omitidos =
          !detalle && lista.length > mostrar.length
            ? `\n    ... y ${lista.length - mostrar.length} mas (pedir detalle para verlos)`
            : '';

        return `${cab}\n${mostrar.map(fmt).join('\n')}${omitidos}`;
      });

      return texto(
        `${movs.length} movimientos entre ${desde} y ${hasta}\n\n${bloques.join('\n\n')}`
      );
    } catch (e) {
      return error(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
