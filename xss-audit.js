/* Auditoria de XSS: encontra interpolação em innerHTML sem escape.
   Roda no CI junto com os outros testes — se alguém adicionar um
   template novo sem esc(), isto acusa antes de virar produção. */
const fs = require('fs'), path = require('path'), glob = require('fs');
const ROOT = path.join(__dirname, '..');

/* Funções que já produzem saída segura */
const SAFE = ['esc(', 'FIELDO.UI.esc(', 'brl(', 'fmtDate(', 'stars(',
              'encodeURIComponent(', 'JSON.stringify(', 'Number(', 'parseInt(',
              'parseFloat(', 'String(', '.length', 'waLink(', 'waPicker('];

/* Variáveis que nunca carregam entrada de usuário */
const CONST_OK = /^(_?[A-Z_]{2,}|i|n|idx|pct|total|subtotal|desconto|valor)$/;

let suspeitos = [];

fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).forEach(file => {
  const linhas = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  let dentro = false, buf = '', ini = 0;

  linhas.forEach((l, i) => {
    if (!dentro && /innerHTML\s*\+?=/.test(l)) { dentro = true; buf = ''; ini = i + 1; }
    if (!dentro) return;
    buf += l + '\n';
    /* fim heurístico do template */
    if (/;\s*$/.test(l.trim()) || i - ini > 40) {
      dentro = false;
      /* pega interpolações: + expr + */
      const re = /\+\s*([A-Za-z_$][\w$.\[\]()'"]*)\s*\+/g;
      let m;
      while ((m = re.exec(buf))) {
        const expr = m[1];
        if (CONST_OK.test(expr)) continue;
        if (SAFE.some(s => expr.includes(s.replace('(', '')) && buf.slice(Math.max(0, m.index - 30), m.index + expr.length + 4).includes('esc('))) continue;
        const ctx = buf.slice(Math.max(0, m.index - 40), m.index + expr.length + 6);
        if (SAFE.some(s => ctx.includes(s))) continue;
        suspeitos.push({ file, linha: ini, expr, ctx: ctx.replace(/\s+/g, ' ').slice(0, 90) });
      }
    }
  });
});

if (!suspeitos.length) {
  console.log('✓ nenhuma interpolação sem escape encontrada');
  process.exit(0);
}
console.log(suspeitos.length + ' ponto(s) para revisar:\n');
suspeitos.forEach(s => {
  console.log('  ' + s.file + ':~' + s.linha + '  → ' + s.expr);
  console.log('      ' + s.ctx);
});
process.exit(0); /* informativo, não bloqueia */
