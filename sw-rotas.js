/* Simula a mecânica de cache do service worker.
   O bug do "?id=" não aparecia em nenhum teste anterior porque nenhum
   deles exercitava a CHAVE do cache — só a lógica ao redor. */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } };

/* Cache Storage de mentira, com a MESMA regra de chave do navegador:
   a URL inteira, incluindo query string. É essa regra que causou o bug. */
function fakeCaches() {
  const store = new Map();
  function chave(req) { return typeof req === 'string' ? req : req.url; }
  const api = {
    open: (nome) => Promise.resolve({
      put(req, res) { store.set(chave(req), res); return Promise.resolve(); },
      addAll(list) { list.forEach(u => store.set(new URL(u, BASE).href, respostaFake(u))); return Promise.resolve(); },
      add(u) { store.set(new URL(u, BASE).href, respostaFake(u)); return Promise.resolve(); },
    }),
    match(req, opts) {
      const alvo = new URL(chave(req), BASE);
      for (const [k, v] of store) {
        const u = new URL(k, BASE);
        if (u.pathname !== alvo.pathname) continue;
        if (opts && opts.ignoreSearch) return Promise.resolve(v);
        if (u.search === alvo.search) return Promise.resolve(v);
      }
      return Promise.resolve(undefined);
    },
    keys: () => Promise.resolve([...new Set([...store.keys()].map(() => 'fieldo-v5.7.5-shell'))]),
    delete: () => Promise.resolve(true),
    _store: store,
  };
  return api;
}

const BASE = 'https://fieldo.app/';

/* Resposta com a forma mínima que o SW e o teste consomem */
function respostaFake(url) {
  return { ok: true, status: 200, url: String(url), clone() { return this; },
           headers: { get: () => 'text/html' } };
}

/* Carrega o sw.js num contexto com Service Worker de mentira */
function carregarSW(offline) {
  const listeners = {};
  const caches = fakeCaches();
  const ctx = {
    console, URL, Request: class { constructor(u, o) { this.url = String(u); this.method = (o||{}).method || 'GET'; this.mode='navigate'; this.headers={get:()=>'text/html'}; } },
    Response: class { constructor(b, o) { this.body = b; this.status = (o||{}).status || 200; this.ok = this.status < 400; this.headers = { get: () => 'text/html' }; } clone() { return this; } },
    Uint8Array, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    caches, fetch: null, setTimeout, Promise,
    self: null, location: { origin: 'https://fieldo.app' },
  };
  ctx.self = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    location: { origin: 'https://fieldo.app' },
    registration: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.fetch = offline
    ? () => Promise.reject(new TypeError('offline'))
    : (req) => Promise.resolve(new ctx.Response('<html>ok</html>', { status: 200 }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), ctx);
  return { ctx, listeners, caches };
}

async function navegar(env, url) {
  const req = new env.ctx.Request(url);
  let resposta = null;
  const ev = {
    request: req,
    respondWith: (p) => { resposta = p; },
    waitUntil: (p) => p,
  };
  (env.listeners['fetch'] || []).forEach(fn => fn(ev));
  return resposta ? await resposta : null;
}

(async () => {
  console.log('── precache instalado ──');
  const on = carregarSW(false);
  const instEv = { waitUntil: (p) => p };
  await Promise.all((on.listeners['install'] || []).map(fn => fn(instEv)));
  await new Promise(r => setTimeout(r, 30));
  ok(on.caches._store.size > 0, 'precache gravou algo (' + on.caches._store.size + ' itens)');

  console.log('── OFFLINE: abrir relatório com ?id= ──');
  const off = carregarSW(true);
  await Promise.all((off.listeners['install'] || []).map(fn => fn({ waitUntil: p => p })));
  await new Promise(r => setTimeout(r, 30));

  const r1 = await navegar(off, BASE + 'relatorio.html?id=abc-123');
  ok(r1 && r1.status === 200,
     'relatorio.html?id=... abre do cache (status: ' + (r1 && r1.status) + ')');

  const r2 = await navegar(off, BASE + 'servico.html?orc=xyz');
  ok(r2 && r2.status === 200,
     'servico.html?orc=... abre do cache (status: ' + (r2 && r2.status) + ')');

  const r3 = await navegar(off, BASE + 'busca.html');
  ok(r3 && r3.status === 200,
     'busca.html abre do cache (status: ' + (r3 && r3.status) + ')');

  console.log('── página inexistente: 503, não substituição ──');
  const r4 = await navegar(off, BASE + 'inexistente.html');
  ok(r4 && r4.status === 503,
     'página não cacheada responde 503 (status: ' + (r4 && r4.status) + ')');

  console.log('\n' + (falhas ? '✗ ' + falhas + ' falha(s)' : '✓ rotas do SW corretas'));
  process.exit(falhas ? 1 : 0);
})();
