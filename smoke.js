/* Smoke test de regressão.
   Carrega db.js + o script inline de CADA página num contexto isolado.
   Se qualquer página parar de carregar, isso aqui grita — em vez de o
   usuário descobrir em obra que um botão parou de responder. */
const { makeContext, inlineScripts, vm, fs } = require('./dom-stub.js');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB   = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

const PAGES = ['index','servico','orcamento','relatorio','perfil','contratos',
               'explorar','busca','avaliar','verificar','ativar','entrar','admin'];

/* Funções que cada página PRECISA expor. Se um refactor renomear ou
   engolir uma delas, o botão correspondente vira no-op silencioso. */
const CONTRATOS = {
  index:     ['carregarDashboard','renderMetricas','renderFinanceiro','renderServicos','bindPagoBtns','initRecoveryUI','bindReenvioBtns','bindPwaReset','bindTemaBtns'],
  servico:   ['avancarStep','voltarStep','validar1','atualizarHint','faltando1',
              'atualizarPagto','setPagto','pixDoServico','buildHTML','renderCatGrid',
              '_preencherDoOrcamento'],
  orcamento: [],
  relatorio: ['copiarPix','bindDecisao','avisarProfissional','waLink','waNumero'],
  /* v5.7.6: este contrato estava VAZIO. A tela de onboarding e
     recuperação de conta — a mais crítica do sistema — não tinha
     nenhuma verificação. Se o IIFE parasse de definir os handlers, os
     botões viravam no-op e nenhum teste acusava. */
  entrar:    ['comecar','irStep','recuperar','criarPerfil','selecionarNicho',
              'copiarCodigo','baixarCodigo','toggleSalvou','irParaServico','irParaDashboard'],
  perfil:    ['nomeCurto','montarGaleria','abrirLightbox','navLightbox','renderTudo'],
  avaliar:   [],
  ativar:    [],
};

let falhas = 0, ok = 0;
function check(cond, msg) {
  if (cond) { ok++; }
  else { falhas++; console.log('   ✗ ' + msg); }
}

/* ── db.js isolado ───────────────────────────────────────────── */
const base = makeContext('/');
try {
  vm.runInContext(DB, base, { filename: 'db.js' });
  console.log('db.js                 carregou');
} catch (e) {
  console.log('db.js                 FALHOU: ' + e.message);
  process.exit(1);
}

const API = ['PWA','Pagamento','Auth','Professionals','Reports','Budgets','Avaliacoes','Hashes',
             'License','Validator','Pix','LocalDB','Draft','SyncEngine','UI',
             'Niches','Pro','UsageGuard','config'];
API.forEach(k => check(base.FIELDO && base.FIELDO[k], 'FIELDO.' + k + ' ausente'));

/* ── cada página ─────────────────────────────────────────────── */
PAGES.forEach(name => {
  const file = path.join(ROOT, name + '.html');
  if (!fs.existsSync(file)) { console.log(name.padEnd(14) + 'ARQUIVO AUSENTE'); falhas++; return; }

  const ctx = makeContext('/' + name + '.html');
  let erro = null;
  try {
    vm.runInContext(DB, ctx, { filename: 'db.js' });
    inlineScripts(fs.readFileSync(file, 'utf8')).forEach((code, i) => {
      vm.runInContext(code, ctx, { filename: name + '.html#' + i });
    });
    ctx.document._fire('DOMContentLoaded');
  } catch (e) { erro = e; }

  if (erro) {
    console.log(name.padEnd(14) + 'FALHOU: ' + erro.message);
    falhas++;
    return;
  }

  const faltando = (CONTRATOS[name] || []).filter(f => typeof ctx[f] !== 'function');
  if (faltando.length) {
    console.log(name.padEnd(14) + 'carregou, mas falta: ' + faltando.join(', '));
    falhas += faltando.length;
  } else {
    console.log(name.padEnd(14) + 'carregou' + (CONTRATOS[name] ? ' · ' + CONTRATOS[name].length + ' funções ok' : ''));
    ok++;
  }
});

console.log('\n' + (falhas ? '✗ ' + falhas + ' FALHA(S)' : '✓ tudo passou') + ' · ' + ok + ' verificações ok');
process.exit(falhas ? 1 : 0);
