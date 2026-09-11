# interbanking-mcp

Servidor MCP para consultar tus cuentas de **Interbanking** (Argentina) desde un agente:
saldos, saldos históricos y movimientos, en castellano y sin escribir código.

**Es de solo lectura.** No hay ninguna herramienta que mueva plata, y eso no es una
convención sino una decisión de diseño: la función genérica del cliente —la que acepta
cualquier método HTTP— queda deliberadamente afuera del servidor.

## Instalación

No hace falta instalar nada: se descarga solo al arrancar.

### Claude Code

```bash
claude mcp add interbanking \
  --env IB_CLIENT_ID=tu_client_id \
  --env IB_CLIENT_SECRET=tu_client_secret \
  --env IB_REDIRECT_URL=https://localhost \
  --env IB_CUSTOMER_ID=tu_customer_id \
  -- npx -y interbanking-mcp
```

### Claude Desktop u otro cliente con archivo de configuración

```json
{
  "mcpServers": {
    "interbanking": {
      "command": "npx",
      "args": ["-y", "interbanking-mcp"],
      "env": {
        "IB_CLIENT_ID": "tu_client_id",
        "IB_CLIENT_SECRET": "tu_client_secret",
        "IB_REDIRECT_URL": "https://localhost",
        "IB_CUSTOMER_ID": "tu_customer_id"
      }
    }
  }
}
```

Las credenciales salen del [portal de desarrolladores de
Interbanking](https://developers.interbanking.com.ar/api/prod/). Cómo obtenerlas, paso a
paso, está en [interbanking-api-ejemplo](https://github.com/rje1974/interbanking-api-ejemplo#registro-en-el-portal-de-desarrolladores).

> **Ojo con dónde quedan las credenciales.** Ese archivo de configuración es texto plano
> en tu disco. Antes de pegarlas ahí, leé [gestión de
> tokens](https://github.com/rje1974/interbanking-api-ejemplo#gestión-de-tokens-y-credenciales).

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `listar_cuentas` | Las cuentas disponibles con banco, tipo, moneda y número |
| `saldos` | Saldos actuales: contable y operativo. Rango opcional de hasta 64 días |
| `saldos_historicos` | Saldos día por día en rangos largos; parte el rango solo |
| `movimientos` | Movimientos de todas las cuentas, con totales de créditos y débitos |

Una vez configurado, se le habla en castellano:

- *"¿Cuánto tengo en cada cuenta?"*
- *"Mostrame los movimientos de septiembre"*
- *"¿Cómo evolucionó el saldo del Galicia desde enero?"*
- *"¿Qué transferencias entraron la semana pasada?"*

### Sobre el volumen de datos

`movimientos` y `saldos_historicos` devuelven un **resumen** por defecto: totales por
cuenta y los 25 movimientos más recientes. Un rango de un año son miles de registros, y
volcarlos enteros llena la ventana de contexto del agente sin que nadie gane nada. Para
ver todo, pedirle *"con detalle"*, y mejor sobre rangos cortos.

## Qué hay abajo

Usa [`interbanking-client`](https://www.npmjs.com/package/interbanking-client), que
resuelve los quirks del portal: los parámetros del token van en la query string y no en
el body, el header `service` tiene que incluir `https://`, `customer-id` va como query
parameter, y movimientos usa una URL base distinta a saldos. Todos están documentados en
[interbanking-api-ejemplo](https://github.com/rje1974/interbanking-api-ejemplo).

## Desarrollo

```bash
npm install
npm run check
npm test
```

Para probarlo a mano:

```bash
npx @modelcontextprotocol/inspector node server.js
```

## Licencia

MIT
