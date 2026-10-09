// Preloaded into the load-test API (node --import): the PayOS merchant host is answered by the in-memory simulator of packages/server
// (test support), and a tiny control server lets the load script "pay" an order the way the bank would and get the SIGNED webhook body:
//   GET http://127.0.0.1:<LOAD_PAYOS_CONTROL_PORT>/webhook/<orderCode>   marks the order paid and answers the signed notification
//   GET http://127.0.0.1:<LOAD_PAYOS_CONTROL_PORT>/orders
// Local load tests only (scripts/load-online.mjs starts it); never in production.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const { createPayosSimulator } = await import(
  pathToFileURL(
    new URL('packages/server/dist/payos-simulator.js', root).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  ).href
);
const sim = createPayosSimulator({
  clientId: process.env.PAYOS_CLIENT_ID ?? 'sim-client',
  apiKey: process.env.PAYOS_API_KEY ?? 'sim-key',
  checksumKey: process.env.PAYOS_CHECKSUM_KEY ?? 'sim-checksum',
});
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith('https://api-merchant.payos.vn')
    ? sim.fetch(input, init)
    : realFetch(input, init);
};

http
  .createServer((request, response) => {
    const [, action, code] = request.url.split('/');
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (action === 'orders') {
      return send(
        200,
        [...sim.orders.values()].map((o) => ({
          orderCode: o.orderCode,
          amount: o.amount,
          status: o.status,
        })),
      );
    }
    if (action === 'webhook') {
      const orderCode = Number(code);
      if (!sim.orders.has(orderCode)) return send(404, { error: 'unknown order' });
      return send(200, sim.pay(orderCode, { reference: `LOAD-${orderCode}` }));
    }
    return send(404, { error: 'unknown' });
  })
  .listen(Number(process.env.LOAD_PAYOS_CONTROL_PORT ?? 3299), '127.0.0.1');
