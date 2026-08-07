/* O caminho que mais importa: criar relatório e orçamento SEM rede,
   e vê-los na lista logo depois.

   Escrito a partir da TELA, não da função — foi a lacuna que deixou
   passar os três bugs anteriores. */
const { makeContext, vm, fs } = require('./dom-stub.js');
const path = require('path');

function fakeLocalDB() {
  const s = {}, q = [];
  let n = 0;
  return {
    isSupported: () => true,
    put(store, rec) {
      s[store] = s[store] || {};
      const r = Object.assign({}, rec);
      if (!r._localId) r._localId = 'loc-' + (++n);
      if (!r._syncStatus) r._syncStatus = 'pending';
      s[store][r._localId] = r;
      return Promise.resolve(r);
    },
    update(store, id, patch) {
      if (s[store] && s[store][id]) Object.assign(s[store][id], patch);
      return Promise.resolve();
    },
    list(store, opts) {
      opts = opts || {};
      const all = Object.values(s[store] || {});
      return Promise.resolve(opts.status ? all.filter(r => r._syncStatus === opts.status) : all);
    },
    queueOp(op) { q.push(op); return Promise.resolve(op); },
    _fila: () => q,
  };
}

const ctx = makeContext('/servico.html');
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), ctx);
const F = ctx.FIELDO;

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } };

ctx.localStorage.setItem('fieldo_auth', JSON.stringify({
  access_token: 't', refresh_token: 'r', user_id: 'u1', expires_at: Date.now() + 3600000,
}));
ctx.localStorage.setItem('fieldo_session_data', JSON.stringify({ id: 'u1', name: 'Eu' }));

const fake = fakeLocalDB();
Object.keys(fake).forEach(k => { F.LocalDB[k] = fake[k]; });

(async () => {
  /* ── SEM REDE desde o começo ── */
  ctx.navigator.onLine = false;
  ctx.fetch = () => Promise.reject(new TypeError('Failed to fetch'));

  console.log('── criar relatório offline ──');
  const rep = await F.Reports.create({
    client_name: 'Dona Maria', service_date: '2026-07-21',
    valor: 350, payment_status: 'pendente',
  }).catch(e => ({ __erro: e.message }));
  ok(!rep.__erro, 'create não rejeita offline (' + (rep.__erro || 'ok') + ')');
  ok(rep._pendingSync === true, 'marcado como pendente');
  ok(rep.client_name === 'Dona Maria', 'devolve o dado que foi digitado');
  ok(fake._fila().some(o => o.table === 'reports'), 'entrou na fila de sincronização');

  console.log('── criar orçamento offline ──');
  const orc = await F.Budgets.create({
    client_name: 'Seu João', total: 1200, status: 'pendente',
  }).catch(e => ({ __erro: e.message }));
  ok(!orc.__erro, 'create de orçamento não rejeita offline');
  ok(orc.client_name === 'Seu João', 'devolve o dado digitado');
  ok(fake._fila().some(o => o.table === 'budgets'), 'orçamento na fila');

  console.log('── a LISTA mostra o que foi criado offline ──');
  /* É aqui que o usuário confere o trabalho. Se aparecer em branco,
     ele acha que perdeu o serviço. */
  const lista = await F.Reports.list().catch(() => []);
  ok(lista.length >= 1, 'lista traz ao menos 1 (obtido: ' + lista.length + ')');
  const meu = lista[0] || {};
  ok(meu.client_name === 'Dona Maria',
     'nome do cliente visível na lista (obtido: ' + JSON.stringify(meu.client_name) + ')');
  ok(meu.valor === 350, 'valor visível (obtido: ' + JSON.stringify(meu.valor) + ')');

  const lorc = await F.Budgets.list().catch(() => []);
  ok((lorc[0] || {}).client_name === 'Seu João',
     'orçamento visível na lista (obtido: ' + JSON.stringify((lorc[0] || {}).client_name) + ')');

  console.log('\n' + (falhas ? '✗ ' + falhas + ' falha(s)' : '✓ criação offline funciona'));
  process.exit(falhas ? 1 : 0);
})();
