/**
 * A minimal `fetch` on node:http(s), for the portal client.
 *
 * Node's fetch (undici) rewrites the headers a browser sends on a page navigation: it
 * always adds `Sec-Fetch-Mode: cors` and drops any `Sec-*` header given to it (forbidden
 * request headers of the Fetch standard). The ista portal's sign-in callback answers its
 * error page to the integration while a browser goes through (2026-11-17): this client sends
 * the headers as given, so every request can look like a browser navigation.
 *
 * It does what IstaClient needs and nothing more: no redirect following (the client follows
 * them by hand), the body as a string, gzip/deflate/br decoded.
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const DECODERS = {
  gzip: () => zlib.createGunzip(),
  'x-gzip': () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
};

/**
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string, signal?: AbortSignal }} [init]
 * @returns {Promise<{ status: number, headers: Headers, text(): Promise<string>, body: { cancel(): Promise<void> } }>}
 */
export function browserFetch(url, { method = 'GET', headers = {}, body, signal } = {}) {
  const target = new URL(url);
  const transport = target.protocol === 'http:' ? http : https;
  const sent = { ...headers };
  if (body !== undefined) {
    sent['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const request = transport.request(target, { method, headers: sent, signal }, (response) => {
      const received = new Headers();
      const raw = response.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) {
        received.append(raw[i], raw[i + 1]);
      }
      const encoding = (response.headers['content-encoding'] ?? '').trim().toLowerCase();
      const stream = DECODERS[encoding] ? response.pipe(DECODERS[encoding]()) : response;
      let text;
      resolve({
        status: response.statusCode,
        headers: received,
        text() {
          text ??= new Promise((done, fail) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
            stream.on('error', fail);
            response.on('error', fail);
          });
          return text;
        },
        body: {
          async cancel() {
            response.destroy();
          },
        },
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}
