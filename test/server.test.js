/**
 * Tests del servidor MCP.
 *
 * Levantan el servidor de verdad por stdio y hablan JSON-RPC contra el. No
 * necesitan credenciales ni red: ninguna de estas pruebas llega a llamar a
 * Interbanking.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');

const ENV_FALSO = {
  IB_CLIENT_ID: 'x',
  IB_CLIENT_SECRET: 'y',
  IB_REDIRECT_URL: 'https://localhost',
  IB_CUSTOMER_ID: 'C1',
};

// Manda una tanda de mensajes JSON-RPC y devuelve las respuestas y el stdout crudo.
function hablarConElServidor(mensajes, env = ENV_FALSO) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    hijo.stdout.on('data', d => { stdout += d; });
    hijo.stderr.on('data', d => { stderr += d; });
    hijo.on('error', reject);

    const handshake = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ];

    for (const m of [...handshake, ...mensajes]) {
      hijo.stdin.write(`${JSON.stringify(m)}\n`);
    }
    hijo.stdin.end();

    hijo.on('close', () => {
      const respuestas = stdout
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l));
      resolve({ respuestas, stdout, stderr });
    });
  });
}

test('el servidor responde el handshake', async () => {
  const { respuestas } = await hablarConElServidor([]);
  const init = respuestas.find(r => r.id === 1);

  assert.equal(init.result.serverInfo.name, 'interbanking');
});

test('expone exactamente las cuatro herramientas de consulta', async () => {
  const { respuestas } = await hablarConElServidor([
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);

  const nombres = respuestas.find(r => r.id === 2).result.tools.map(t => t.name).sort();

  assert.deepEqual(nombres, ['listar_cuentas', 'movimientos', 'saldos', 'saldos_historicos']);
});

test('no expone apiRequest ni ninguna herramienta de escritura', async () => {
  const { respuestas } = await hablarConElServidor([
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);

  const tools = respuestas.find(r => r.id === 2).result.tools;
  const sospechosas = /apiRequest|transferencia|pago|crear|enviar|ejecutar/i;

  for (const t of tools) {
    assert.ok(!sospechosas.test(t.name), `"${t.name}" parece permitir escritura`);
  }
});

test('las herramientas validan el formato de fecha', async () => {
  const { respuestas } = await hablarConElServidor([
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'movimientos', arguments: { desde: '01-09-2026', hasta: '2026-09-11' } } },
  ]);

  const r = respuestas.find(x => x.id === 2);
  const texto = JSON.stringify(r);

  assert.ok(/YYYY-MM-DD/.test(texto), 'debería rechazar la fecha mal formada');
});

test('sin credenciales devuelve un error legible, no se cae', async () => {
  const { respuestas } = await hablarConElServidor(
    [{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'listar_cuentas', arguments: {} } }],
    { IB_CLIENT_ID: '', IB_CLIENT_SECRET: '', IB_REDIRECT_URL: '', IB_CUSTOMER_ID: '' }
  );

  const r = respuestas.find(x => x.id === 2);

  assert.ok(r, 'el servidor tiene que seguir respondiendo');
  assert.ok(/IB_CLIENT_ID/.test(JSON.stringify(r)), 'el error debería nombrar qué falta');
});

test('nada fuera del protocolo se escribe en stdout', async () => {
  // Si algo loguea a stdout, el JSON-RPC se corrompe y esta linea no parsea.
  const { stdout } = await hablarConElServidor([
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);

  for (const linea of stdout.split('\n').filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(linea), `stdout contaminado: ${linea}`);
  }
});
