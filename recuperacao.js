/* O código de recuperação não pode ser reconstruível a partir de nada
   que o servidor armazene.

   Falha corrigida na v6.5: o e-mail sintético era
   `fd-<codigo>@device.fieldo.app` — o código em texto claro dentro de
   auth.users.email. Qualquer leitura do banco entregava a conta. */
const { makeContext, vm, fs } = require('./dom-stub.js');
const path = require('path');

let falhas = 0;
const ok = (c, m) => { if (!c) { falhas++; console.log('  ✗ ' + m); } };

function ctxNovo() {
  const c = makeContext('/');
  c.crypto = require('crypto').webcrypto;
  c.TextEncoder = TextEncoder;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), c);
  return c;
}

/* Captura o corpo enviado ao endpoint de auth */
function emailPara(codigo) {
  return new Promise((resolve) => {
    const c = ctxNovo();
    let corpo = null;
    c.fetch = (u, o) => {
      corpo = JSON.parse(o.body);
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) });
    };
    c.FIELDO.Auth.Session.recoverWithCode(codigo)
      .catch(() => {})
      .then(() => resolve(corpo || {}));
  });
}

(async () => {
  const CODIGO = '6W1H8VSS1P8KXTW8';
  const a = await emailPara(CODIGO);

  console.log('── o servidor não pode ver o código ──');
  ok(a.email, 'gera e-mail sintético');
  ok(!a.email.toUpperCase().includes(CODIGO),
     'e-mail NÃO contém o código (era a falha: ' + a.email + ')');
  ok(/^fd-[0-9a-f]{32}@device\.fieldo\.app$/.test(a.email || ''),
     'formato é hash hexadecimal, não o código');

  console.log('── a recuperação continua funcionando ──');
  const b = await emailPara(CODIGO);
  ok(a.email === b.email, 'mesmo código → mesmo e-mail (determinístico)');
  ok(a.password === CODIGO, 'senha é o código (o servidor guarda o bcrypt)');

  const c2 = await emailPara('ZZZZZZZZZZZZZZZZ');
  ok(c2.email !== a.email, 'códigos diferentes → e-mails diferentes');

  console.log('── normalização ──');
  const min = await emailPara(CODIGO.toLowerCase());
  ok(min.email === a.email, 'minúsculas produzem o mesmo e-mail');

  console.log('\n' + (falhas ? '✗ ' + falhas + ' falha(s)' : '✓ código de recuperação protegido'));
  process.exit(falhas ? 1 : 0);
})();
