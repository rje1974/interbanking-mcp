# AGENTS.md

Contexto para agentes de codigo que mantengan este repositorio.

## Objetivo

Servidor MCP de **solo lectura** sobre la API de Interbanking Argentina. La logica de
HTTP, token y quirks del portal NO vive aca: vive en el paquete `interbanking-client`
(repo `rje1974/interbanking-api-ejemplo`). Este repo es una capa fina de presentacion.

## Stack

- Node.js 18+
- ES modules (`"type": "module"`)
- `@modelcontextprotocol/sdk` con transporte stdio
- `zod` para los esquemas de entrada
- `interbanking-client` como dependencia

## Comandos

```bash
npm install
npm run check
npm test
npx @modelcontextprotocol/inspector node server.js
```

## Reglas de dominio

- **Nunca escribir en stdout.** Es el canal del protocolo JSON-RPC: un solo `console.log`
  rompe la sesion entera. Los mensajes de progreso van a stderr, y el cliente ya loguea
  ahi por defecto.
- **No exponer `apiRequest`.** Es generica (recibe metodo y path), asi que expuesta
  permitiria POST. Dejandola afuera, el servidor es de consulta por construccion. Si
  alguna vez se quiere operar, va como herramienta aparte y explicita, nunca ampliando
  una existente.
- **Cuidar el volumen de la respuesta.** Las herramientas devuelven resumen por defecto y
  detalle solo a pedido: `getAllMovements` sobre un rango largo son miles de registros y
  llenan la ventana de contexto del agente.
- El cliente se construye perezosamente en la primera consulta, no al arrancar: si faltan
  credenciales queremos un error legible para el agente, no un servidor que no levanta.
- No hardcodear credenciales, customer IDs, numeros de cuenta ni saldos reales.
- Los importes se formatean en es-AR.

## Estilo de cambios

- Mantener el servidor fino. Si algo es logica de la API de Interbanking, va en
  `interbanking-client`, no aca.
- Las descripciones de las herramientas las lee un modelo para decidir cual usar: que
  digan cuando conviene cada una y cuales son los limites (64 dias, volumen).
- Descripciones y salidas en castellano.

## Verificacion esperada

```bash
npm run check
npm test
```

Y una prueba de handshake real antes de publicar:

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node server.js
```

## Antes de publicar en npm

`package.json` debe declarar `interbanking-client` con una version del registro
(`^1.1.0`), no con `file:`. El `file:` se usa solo para desarrollo local contra el
cliente sin publicar.
