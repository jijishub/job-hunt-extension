// Actual sibling tracker routes, isolated filesystem storage, loopback HTTP only.
// No Next server, environment credentials, user database or production migrations.
import { createRequire, Module } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

export async function localTracker() {
  const root = path.resolve('../job-hunt');
  if (!fs.existsSync(path.join(root, 'src/lib/capture-validation.ts'))) throw new Error('Interop test requires the sibling job-hunt repository and its installed dependencies.');
  const require = createRequire(path.join(root, 'package.json')), ts = require('typescript');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-tracker-interop-'));
  const wrappedPath = { ...path,
    join: (...parts) => [process.cwd(), '/tmp'].includes(parts[0]) && parts[1] === '.data' ? dir : path.join(...parts),
    resolve: (...parts) => parts.length === 1 && parts[0] === process.env.DB_LOCAL_DIR ? dir : path.resolve(...parts) };
  const overrides = { path: wrappedPath, [path.join(root, 'src/lib/database.ts')]: { getDatabaseClient: () => null },
    '@/lib/session-account': { getSessionAccount: async () => null } };
  const cache = new Map();
  function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full).exports;
    const m = new Module(full); m.filename = full; m.paths = Module._nodeModulePaths(path.dirname(full)); cache.set(full, m);
    const original = m.require.bind(m);
    m.require = id => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      const target = id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) + '.ts' : id.startsWith('.') ? path.resolve(path.dirname(full), id) + '.ts' : null;
      if (target && Object.hasOwn(overrides, target)) return overrides[target];
      return target && fs.existsSync(target) ? load(target) : original(id);
    };
    m._compile(ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, full);
    return m.exports;
  }
  const db = load('src/lib/db.ts'), store = load('src/lib/capture-store.ts');
  const captures = load('src/app/api/v1/captures/route.ts'), connection = load('src/app/api/v1/connection/route.ts');
  const requests = [];
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8'), url = `http://127.0.0.1:${server.address().port}${incoming.url}`;
      requests.push({ method: incoming.method, url, body });
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(body ? { body } : {}) });
      const route = incoming.url.startsWith('/api/v1/captures') ? captures : incoming.url === '/api/v1/connection' ? connection : {};
      const response = route[incoming.method] ? await route[incoming.method](request) : new Response('Unexpected endpoint', { status: 404 });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) { outgoing.writeHead(500); outgoing.end(String(e)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { db, store, requests, origin: `http://127.0.0.1:${server.address().port}`, async close() {
    await new Promise(resolve => server.close(resolve));
    if (!path.resolve(dir).startsWith(path.join(os.tmpdir(), 'extension-tracker-interop-'))) throw new Error('Unexpected temporary database directory');
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}
