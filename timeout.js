/* Nenhuma operação pode girar para sempre.
   Foi o sintoma de "editar perfil fica rodando": sem timeout, um
   request pendurado deixa o botão em loading indefinidamente, e o
   usuário não sabe se espera ou desiste. */
const { makeContext, vm, fs } = require('./dom-stub.js');
const path = require('path');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } };

const DB = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');

/* Contrato estático: toda chamada de rede precisa de timeout */
console.log('── contrato ──');
ok(DB.includes('function _fetchComTimeout'), 'existe _fetchComTimeout');
ok(/_fetchComTimeout\(REST_URL/.test(DB), '_req usa timeout');
ok(/_fetchComTimeout\(STORAGE_URL/.test(DB), 'upload de avatar usa timeout');
ok(DB.includes('_reduzirImagem'), 'avatar é reduzido antes de subir');

/* Comportamento: request que nunca responde deve rejeitar */
console.log('── comportamento ──');
const ctx = makeContext('/');
ctx.AbortController = AbortController;
vm.runInContext(DB.replace(/_fetchComTimeout\(REST_URL \+ path, init, \d+\)/,
                           '_fetchComTimeout(REST_URL + path, init, 250)'), ctx);
ctx.localStorage.setItem('fieldo_auth', JSON.stringify({
  access_token: 't', refresh_token: 'r', user_id: 'u1', expires_at: Date.now() + 3600000 }));
ctx.localStorage.setItem('fieldo_session_data', JSON.stringify({ id: 'u1', name: 'x' }));
ctx.fetch = (u, o) => new Promise((res, rej) => {
  if (o && o.signal) o.signal.addEventListener('abort',
    () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

const t0 = Date.now();
ctx.FIELDO.Professionals.update({ name: 'x' })
  .then(() => { ok(false, 'deveria rejeitar, mas resolveu'); fim(); })
  .catch((e) => {
    const dt = Date.now() - t0;
    ok(dt < 2000, 'rejeita rápido (levou ' + dt + 'ms)');
    ok(/demorou/i.test(e.message), 'mensagem explica a espera: "' + e.message + '"');
    fim();
  });

function fim() {
  console.log('\n' + (falhas ? '✗ ' + falhas + ' falha(s)' : '✓ nada gira para sempre'));
  process.exit(falhas ? 1 : 0);
}
