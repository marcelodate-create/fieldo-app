/* Verificações estáticas do PWA. Não substitui teste em aparelho, mas
   pega os erros que transformam o service worker numa armadilha. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let falhas = 0;
function ok(cond, msg) { if (!cond) { falhas++; console.log('  ✗ ' + msg); } }

const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

console.log('── sw.js ──');
ok(/const VERSION\s*=\s*'fieldo-v[\d.]+'/.test(sw), 'VERSION versionada');
ok(sw.includes("url.hostname.includes(ORIGEM_API)"), 'ignora chamadas do Supabase');
ok(sw.includes("req.method !== 'GET'"), 'não intercepta escrita');
ok(sw.includes("url.origin !== self.location.origin"), 'não intercepta origem externa');
ok(sw.includes('skipWaiting'), 'permite ativar versão nova');
ok(sw.includes('caches.delete'), 'limpa caches antigos no activate');
/* network-first para HTML é o que impede bug de cache virar permanente */
const idx = sw.indexOf('if (ehHTML(req))');
ok(idx > 0 && sw.slice(idx, idx + 260).includes('fetch(req)'), 'HTML é network-first');

console.log('── manifest.json ──');
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
ok(man.start_url && man.scope, 'start_url e scope definidos');
ok(man.display === 'standalone', 'display standalone');
ok(man.icons.some(i => i.sizes === '512x512'), 'ícone 512');
ok(man.icons.some(i => i.purpose === 'maskable'), 'ícone maskable (Android não corta)');
man.icons.forEach(i => ok(fs.existsSync(path.join(ROOT, i.src)), 'existe ' + i.src));

console.log('── páginas ──');
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && f !== 'admin.html');
pages.forEach(p => {
  const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
  ok(s.includes('rel="manifest"'), p + ' tem manifest');
  ok(s.includes('FIELDO.PWA.registrar'), p + ' registra o SW');
  /* o boot precisa vir DEPOIS de qualquer </body> dentro de string JS */
  const interno = s.indexOf("</body></html>';");
  const boot = s.indexOf('FIELDO.PWA.registrar');
  ok(interno === -1 || boot > interno, p + ': boot fora da string do relatório');
});


console.log('── precache cobre as páginas ──');
/* v5.7.4: página fora do precache caía num fallback que servia
   index.html no lugar dela — tocar em "Pesquisar" voltava ao início.
   Este teste falha se alguém criar página nova e esquecer o sw.js. */
const paginas = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && f !== 'admin.html');
paginas.forEach(p => {
  ok(sw.includes("'./" + p + "'"), p + ' está no PRECACHE do sw.js');
});

console.log('── nunca substituir página ──');
ok(!sw.includes("caches.match('./index.html')"),
   'sem fallback para index.html (navegação silenciosamente errada)');
ok(sw.includes('function paginaOffline'), 'tem página de offline honesta');
ok(sw.indexOf('status: 503') > 0, 'offline responde 503, não 200');

ok(sw.includes('ignoreSearch'),
   'fallback usa ignoreSearch (senão ?id= nunca casa com o precache)');
ok(!/caches\.match\(req\)\s*\.then\(\(hit\) => hit \|\| paginaOffline/.test(sw),
   'nenhum match sem ignoreSearch no caminho de navegação');

console.log('── netlify.toml ──');
const nt = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
ok(/for = "\/sw\.js"[\s\S]{0,200}no-store/.test(nt), 'sw.js sem cache (senão a correção nunca chega)');

console.log('\n' + (falhas ? '✗ ' + falhas + ' falha(s)' : '✓ PWA consistente'));
process.exit(falhas ? 1 : 0);
