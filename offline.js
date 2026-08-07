/* Prova que as listas sobrevivem à queda de rede.
   Foi o bug do modo avião: _get() sem fallback deixava a tela vazia,
   e nada era gravado localmente para ler depois. */
const { makeContext, vm, fs } = require('./dom-stub.js');
const path = require('path');

/* IndexedDB de mentira, em memória — suficiente para provar o contrato
   de write-through + leitura no offline. */
function fakeLocalDB() {
  const stores = {};
  return {
    isSupported: () => true,
    put(store, rec) {
      stores[store] = stores[store] || {};
      stores[store][rec._localId || rec.id] = rec;
      return Promise.resolve(rec);
    },
    list(store, opts) {
      opts = opts || {};
      const all = Object.values(stores[store] || {});
      return Promise.resolve(opts.status
        ? all.filter(r => r._syncStatus === opts.status)
        : all);
    },
    _dump: () => stores,
  };
}

const ctx = makeContext('/index.html');
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), ctx);
const F = ctx.FIELDO;

let falhas = 0;
function ok(c, m) { if (!c) { falhas++; console.log('  ✗ ' + m); } }

/* Sessão fictícia */
ctx.localStorage.setItem('fieldo_auth', JSON.stringify({
  access_token: 'tok', refresh_token: 'r', user_id: 'u1',
  expires_at: Date.now() + 3600000,
}));
ctx.localStorage.setItem('fieldo_session_data', JSON.stringify({ id: 'u1', name: 'Teste' }));

/* Confere que a sessão foi reconhecida antes de testar o resto —
   senão o teste falha por motivo errado e o diagnóstico se perde. */
if (F.Auth.getId() !== 'u1') {
  console.log('  ✗ sessão de teste não reconhecida (getId=' + F.Auth.getId() + ')');
  process.exit(1);
}

/* Injeta o LocalDB falso */
const fake = fakeLocalDB();
Object.keys(fake).forEach(k => { F.LocalDB[k] = fake[k]; });

const DADOS = [
  { id: 'r1', client_name: 'Ana',  valor: 100, payment_status: 'pendente', created_at: '2026-07-01' },
  { id: 'r2', client_name: 'Beto', valor: 250, payment_status: 'pago',     created_at: '2026-07-02', paid_at: '2026-07-02' },
];

(async () => {
  console.log('── 1. online: carrega e deve gravar local ──');
  ctx.fetch = () => Promise.resolve({
    ok: true, status: 200,
    headers: { get: (h) => (/content-type/i.test(h) ? 'application/json' : null) },
    json: () => Promise.resolve(DADOS),
    text: () => Promise.resolve(JSON.stringify(DADOS)),
  });
  const online = await F.Reports.list();
  ok(online.length === 2, 'online devolve 2 registros');
  await new Promise(r => setTimeout(r, 20));   /* write-through é assíncrono */
  const guardados = Object.values(fake._dump().reports || {});
  ok(guardados.length === 2, 'gravou os 2 no cache local (obtido: ' + guardados.length + ')');
  ok(guardados.every(r => r._syncStatus === 'synced'), 'marcados como synced');

  console.log('── 2. offline: deve ler do cache ──');
  ctx.navigator.onLine = false;
  ctx.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  const off = await F.Reports.list();
  ok(off.length === 2, 'offline ainda devolve 2 (obtido: ' + off.length + ')');
  ok(off[0].client_name === 'Beto', 'ordenado por data desc');

  console.log('── 3. stats offline ──');
  const s = await F.Reports.stats();
  ok(s.aReceber === 100, 'a receber = 100 (obtido: ' + s.aReceber + ')');
  ok(s.total === 2, 'total = 2');

  console.log('── 4. não duplica ao recarregar ──');
  ctx.navigator.onLine = true;
  ctx.fetch = () => Promise.resolve({
    ok: true, status: 200,
    headers: { get: (h) => (/content-type/i.test(h) ? 'application/json' : null) },
    json: () => Promise.resolve(DADOS),
    text: () => Promise.resolve(JSON.stringify(DADOS)),
  });
  await F.Reports.list();
  await new Promise(r => setTimeout(r, 20));
  ok(Object.values(fake._dump().reports || {}).length === 2,
     'continua 2 após recarregar (obtido: ' + Object.values(fake._dump().reports || {}).length + ')');

  console.log('── 5. painel completo offline (Promise.all) ──');
  /* Este é o caso que faltava: o dashboard chama 4 fontes em paralelo.
     Promise.all é tudo-ou-nada — bastava UMA rejeitar para nenhum
     render rodar. Testar cada função isolada não pegava isso. */
  ctx.navigator.onLine = false;
  ctx.fetch = () => Promise.reject(new TypeError('Failed to fetch'));

  const partes = await Promise.all([
    F.Reports.stats().catch(e => ({ __erro: e })),
    F.Reports.recent(5).catch(e => ({ __erro: e })),
    F.Hashes.list(3).catch(e => ({ __erro: e })),
    F.Budgets.list(5).catch(e => ({ __erro: e })),
  ]);
  const nomes = ['stats', 'recent', 'hashes', 'budgets'];
  partes.forEach((p, i) => ok(!p || !p.__erro, nomes[i] + ' não rejeita offline'));

  /* E o Promise.all sem catch algum deve sobreviver — é como o
     dashboard chama de fato. */
  let caiu = false;
  await Promise.all([
    F.Reports.stats(), F.Reports.recent(5),
    F.Hashes.list(3), F.Budgets.list(5),
  ]).catch(() => { caiu = true; });
  ok(!caiu, 'Promise.all do painel sobrevive offline');

  console.log('\n' + (falhas ? '✗ ' + falhas + ' falha(s)' : '✓ offline funciona'));
  process.exit(falhas ? 1 : 0);
})();
