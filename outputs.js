/* Asserções de SAÍDA — a lição do bug do WhatsApp.
   O smoke test prova que o código carrega. Este prova que ele produz
   valor correto. URL, dinheiro e identificador são as três famílias em
   que "produz lixo silenciosamente" custa caro. */
const { makeContext, vm, fs } = require('./dom-stub.js');
const path = require('path');
const c = makeContext('/');
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), c);
const UI = c.FIELDO.UI, Pix = c.FIELDO.Pix;

let falhas = 0;
function eq(real, esperado, label) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log('  ✗ ' + label + '\n      esperado: ' + JSON.stringify(esperado) + '\n      obtido:   ' + JSON.stringify(real)); }
  return ok;
}

console.log('── WhatsApp ──');
eq(UI.waNumero('(12) 99999-8888'), '5512999998888', 'formatado');
eq(UI.waNumero('+55 12 99999-8888'), '5512999998888', 'com DDI');
eq(UI.waNumero('5512999998888'), '5512999998888', 'DDI colado');
eq(UI.waNumero('012999998888'), '5512999998888', 'zero de operadora');
eq(UI.waNumero('999'), '', 'curto demais');
eq(UI.waNumero(''), '', 'vazio');
eq(UI.waNumero(null), '', 'null');
eq(UI.waLink('999', 'x'), '', 'link inválido devolve vazio');
eq(UI.waLink('12999998888', 'oi'), 'https://wa.me/5512999998888?text=oi', 'link válido');

console.log('── PIX BR Code ──');
const p = Pix.brcode({ key: '12345678901', name: 'Fulano', city: 'Sao Paulo', amount: 350.5 });
eq(p.ok, true, 'gera');
eq(p.code.indexOf('5406350.50') > 0, true, 'valor embutido');
eq(p.code.indexOf('5303986') > 0, true, 'moeda BRL');
eq(/^[0-9A-F]{4}$/.test(p.code.slice(-4)), true, 'CRC hex');
eq(Pix.brcode({ key: 'abc', name: 'X', city: 'Y' }).ok, false, 'chave inválida recusada');
eq(Pix.normalizeKey('123.456.789-01', 'CPF'), '12345678901', 'CPF limpo');

console.log('── Moeda ──');
eq(typeof UI.brl(1234.5), 'string', 'brl devolve string');
eq(UI.brl(0).indexOf('0') > -1, true, 'zero formatado');



console.log('── Storage: nomes de bucket ──');
/* v5.8.1: o módulo Photos apontava para o bucket 'reports', que não
   existe — todo upload dava 404 e o .catch silencioso escondia. Os
   buckets reais são criados na migração 103_storage.sql. */
const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
const BUCKETS_REAIS = ['avatars', 'photos'];
const usados = [...dbSrc.matchAll(/BUCKET\s*=\s*'([^']+)'/g)].map(m => m[1]);
usados.forEach(b => eq(BUCKETS_REAIS.includes(b), true,
  "bucket '" + b + "' existe (reais: " + BUCKETS_REAIS.join(', ') + ')'));
eq(usados.length > 0, true, 'ao menos um bucket declarado');
/* URLs de storage no db.js devem usar bucket real */
const emUrl = [...dbSrc.matchAll(/storage\/v1\/object\/public\/([a-z]+)/g)].map(m => m[1]);
emUrl.forEach(b => eq(BUCKETS_REAIS.includes(b), true, "URL pública usa bucket real: " + b));


console.log('── esc() idêntico em todas as páginas (v6.4) ──');
/* Havia TRÊS implementações de esc(). Duas não escapavam aspas, e eram
   usadas dentro de atributos (src="…", href="…"). Uma aspa no valor
   escapava do atributo.
   O risco de ter várias implementações é a correta ser contornada por
   acidente — este teste garante que existe uma só. */
{
  const { makeContext, inlineScripts } = require('./dom-stub.js');
  const alvo = 'aspa" simples' + String.fromCharCode(39) + ' <tag> &e';
  const base = makeContext('/');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), base);
  const esperado = base.FIELDO.UI.esc(alvo);

  fs.readdirSync(path.join(__dirname, '..'))
    .filter(f => f.endsWith('.html') && f !== 'admin.html')
    .forEach(f => {
      const c = makeContext('/' + f);
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), c);
      try { inlineScripts(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
              .forEach(s => vm.runInContext(s, c)); } catch (e) {}
      if (typeof c.esc !== 'function') return;
      eq(c.esc(alvo), esperado, f + ': esc() escapa igual ao FIELDO.UI.esc');
    });
}


console.log('── select= automático nas leituras públicas (v6.7) ──');
/* Regressão da v6.5: revogar colunas do `anon` fez o PostgREST montar
   SELECT * sobre colunas sem permissão — a consulta INTEIRA passava a
   falhar com "permission denied". Perfil, relatório e busca ficavam
   carregando para sempre.

   O select= agora é injetado num lugar só. Este teste garante que
   nenhuma tabela sensível seja consultada sem lista de colunas. */
{
  const base2 = makeContextLocal();
  const f = base2.FIELDO.colunasPublicas;
  ['/professionals?slug=eq.x', '/reports?id=eq.1', '/budgets?id=eq.1',
   '/avaliacoes?report_id=eq.1', '/document_hashes?hash=eq.x'].forEach(p => {
    eq(f(p).includes('select='), true, 'injeta select em ' + p.split('?')[0]);
    eq(f(p).includes('rating_token'), false, 'não pede rating_token em ' + p.split('?')[0]);
    eq(f(p).includes('approval_token'), false, 'não pede approval_token em ' + p.split('?')[0]);
  });
  /* views não têm colunas revogadas — não precisam de select */
  eq(f('/professional_stats?limit=5').includes('select='), false,
     'view não recebe select desnecessário');
  /* chamada que já traz select não é alterada */
  eq(f('/reports?select=id&id=eq.1'), '/reports?select=id&id=eq.1',
     'respeita select já informado');
}

function makeContextLocal() {
  const { makeContext } = require('./dom-stub.js');
  const c = makeContext('/');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), c);
  return c;
}


console.log('── endereço público dos links (v6.9) ──');
/* v6.8 fixava 'fieldo.netlify.app' como fallback — um domínio que NÃO
   pertence ao projeto (o site foi excluído da Netlify). Subdomínio
   abandonado pode ser registrado por qualquer um, e os links carregam
   TOKENS na URL.

   Regra atual: sem PUBLIC_BASE_URL configurado, NUNCA inventar domínio.
   Usa a origem real e avisa. Publicado, usa a origem automaticamente. */
{
  const { makeContext } = require('./dom-stub.js');
  const DBSRC = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');

  eq(/var PUBLIC_BASE_URL = ''/.test(DBSRC), true,
     'PUBLIC_BASE_URL não aponta para domínio de terceiro');
  eq(DBSRC.includes('fieldo.netlify.app') &&
     !/var PUBLIC_BASE_URL = 'https:\/\/fieldo\.netlify\.app'/.test(DBSRC), true,
     'menção a fieldo.netlify.app só em comentário histórico');

  /* publicado → usa a origem real, sem configuração nenhuma */
  const cPub = makeContext('/');
  cPub.window.location.origin = 'https://meu-site.netlify.app';
  vm.runInContext(DBSRC, cPub);
  eq(cPub.FIELDO.publicUrl('/avaliar.html?token=x'),
     'https://meu-site.netlify.app/avaliar.html?token=x',
     'publicado usa a própria origem');
  eq(cPub.FIELDO.publicUrlConfigurado(), true, 'publicado é compartilhável');

  /* local sem config → mantém local e avisa (nunca inventa domínio) */
  const cLoc = makeContext('/');
  cLoc.window.location.origin = 'http://127.0.0.1:12886';
  let avisou = false;
  cLoc.console = { warn: () => { avisou = true; }, log: () => {}, error: () => {} };
  vm.runInContext(DBSRC, cLoc);
  const u = cLoc.FIELDO.publicUrl('/avaliar.html?token=x');
  eq(u.startsWith('http://127.0.0.1:12886'), true, 'local não inventa domínio');
  eq(avisou, true, 'avisa que o link não é compartilhável');
  eq(cLoc.FIELDO.publicUrlConfigurado(), false, 'local não é compartilhável');
}

console.log('── Escape em contexto de atributo (v5.6) ──');
/* O bug: esc() protege HTML, mas o parser decodifica &#39; ANTES do
   JS ler o onclick. Um nome com aspas escapava da string e executava.
   A prova de que está corrigido é estrutural: nenhum handler pode
   carregar dado interpolado dentro do atributo. */
const globAll = require('fs').readdirSync(path.join(__dirname, '..'))
  .filter(f => f.endsWith('.html'));
let inseguros = [];
globAll.forEach(f => {
  const txt = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  txt.split('\n').forEach((l, i) => {
    /* onclick="fn('" + variavel + "')"  → padrão proibido */
    if (/onclick=\\?"[^"]*\(\\'\s*'\s*\+/.test(l) && /esc\(|\+\s*\w+\./.test(l)) {
      inseguros.push(f + ':' + (i + 1));
    }
  });
});
eq(inseguros, [], 'nenhum dado interpolado dentro de onclick');

console.log('\n' + (falhas ? '✗ ' + falhas + ' falha(s)' : '✓ todas as saídas corretas'));
process.exit(falhas ? 1 : 0);
