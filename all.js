/* Roda a suíte inteira. Use antes de qualquer deploy. */
const { execFileSync } = require('child_process');
const path = require('path');
/* v5.9: pwa.js e sw-rotas.js saíram — o service worker foi desativado.
   Os arquivos ficam no repositório caso a decisão seja revista. */
const suites = ['smoke.js', 'outputs.js', 'offline.js', 'criar-offline.js', 'timeout.js', 'recuperacao.js'];
let falhou = false;
suites.forEach(s => {
  console.log('\n═══ ' + s + ' ═══');
  try { console.log(execFileSync('node', [path.join(__dirname, s)], { encoding: 'utf8' })); }
  catch (e) { falhou = true; console.log(e.stdout || e.message); }
});
console.log(falhou ? '\n✗ SUÍTE FALHOU — não publique' : '\n✓ suíte completa passou');
process.exit(falhou ? 1 : 0);
