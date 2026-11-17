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

// Decoded once the whole body is read, never as a stream: a redirect whose body is never read
// (or an empty compressed body) cannot leave a failing decoder behind. Lenient on truncated
// bodies, like undici; deflate with or without its zlib wrapper, like browsers.
const LENIENT = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
const DECODERS = {
  gzip: (raw) => zlib.gunzipSync(raw, LENIENT),
  'x-gzip': (raw) => zlib.gunzipSync(raw, LENIENT),
  deflate: (raw) =>
    (raw[0] & 0x0f) === 8 ? zlib.inflateSync(raw, LENIENT) : zlib.inflateRawSync(raw, LENIENT),
  br: (raw) => zlib.brotliDecompressSync(raw),
};

function decode(raw, encoding) {
  return raw.length && DECODERS[encoding] ? DECODERS[encoding](raw) : raw;
}

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
      try {
        const received = new Headers();
        const raw = response.rawHeaders;
        for (let i = 0; i < raw.length; i += 2) {
          received.append(raw[i], raw[i + 1]);
        }
        const encoding = (response.headers['content-encoding'] ?? '').trim().toLowerCase();
        // Read from the start, so an error of the connection always has a listener.
        const chunks = [];
        const body = new Promise((done, fail) => {
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => done(Buffer.concat(chunks)));
          response.on('error', fail);
          response.on('aborted', () => fail(new Error('the answer was cut off')));
        });
        body.catch(() => {}); // a cancelled or unread body is not an error of its own
        resolve({
          status: response.statusCode,
          headers: received,
          async text() {
            return decode(await body, encoding).toString('utf8');
          },
          body: {
            async cancel() {
              response.destroy();
            },
          },
        });
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    request.on('error', reject);
    request.end(body);
  });
}
