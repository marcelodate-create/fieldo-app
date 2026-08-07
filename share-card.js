/* ════════════════════════════════════════════════════════════════
   FIELDO.ShareCard — gerador de card de compartilhamento (Stories)
   ════════════════════════════════════════════════════════════════
   Não toca em db.js, fieldo.css nem no fluxo de relatório/orçamento.
   Se anexa ao namespace global FIELDO (criado por db.js) como uma
   propriedade nova — arquivo independente, pode ser removido sem
   quebrar nada.

   Por quê Canvas puro, sem lib de imagem:
   - offline-first: nenhuma dependência de rede além da própria foto
     do profissional (já em cache do app);
   - "JS vanilla, sem bibliotecas pesadas" é regra do projeto;
   - o texto vai via fillText, não via innerHTML — não há superfície
     de XSS aqui (canvas não interpreta HTML), mas ainda assim
     sanitizamos o texto de entrada por robustez visual.

   Depende apenas de:
   - qrcode_min.js (já existe no projeto, usado em orcamento.html)
   - as variáveis de cor do fieldo.css, lidas via getComputedStyle
     para nunca dessincronizar do Design System se a paleta mudar.
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var W = 1080, H = 1920;     /* formato Stories — ver nota no PATCH */

  var NICHE_EMOJI = {
    eletrica: '⚡', hidraulica: '🔧', pintura: '🎨',
    'ar-condicionado': '❄️', alvenaria: '🧱', informatica: '💻',
    serralheria: '🔩', outro: '⚙️'
  };

  /* ── cores: lidas do :root do fieldo.css, com fallback fixo caso
     a folha ainda não tenha carregado (ex.: página sem fieldo.css
     no <head> ao chamar o gerador cedo demais). Mantém o card preso
     ao Design System em vez de hardcode divergente. ── */
  function tokens() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var val = cs.getPropertyValue(name).trim();
      return val || fallback;
    }
    return {
      paper:  v('--paper',  '#f5f2ec'),
      paper2: v('--paper2', '#ede9df'),
      ink:    v('--ink',    '#0e0e14'),
      gold:   v('--gold',   '#9a7218'),
      goldL:  v('--gold-l', '#b8880d')
    };
  }

  /* ── sanitização leve de texto (não é proteção XSS — é canvas;
     é só corte de tamanho e remoção de caracteres de controle) ── */
  function clean(s, max) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function stars(ctx, x, y, score, size, colorFull, colorEmpty) {
    var full = Math.round(score || 0);
    ctx.font = size + 'px sans-serif';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < 5; i++) {
      ctx.fillStyle = i < full ? colorFull : colorEmpty;
      ctx.fillText('★', x + i * (size * 1.15), y);
    }
  }

  /* desenha uma imagem em modo "cover" dentro de um retângulo */
  function drawCover(ctx, img, x, y, w, h) {
    var ir = img.width / img.height, r = w / h, sx, sy, sw, sh;
    if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
    else        { sw = img.width;  sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      if (!url) return resolve(null);
      var img = new Image();
      img.crossOrigin = 'anonymous';   /* precisa de CORS liberado no bucket, senão cai no fallback */
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };  /* falhou/offline → segue sem foto, não trava o card */
      img.src = url;
    });
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    /* garante que Fraunces/DM Sans/DM Mono (já carregadas pelo
       @import do fieldo.css) estejam prontas antes do fillText —
       senão o canvas desenha com a fonte de fallback do sistema. */
    return Promise.all([
      document.fonts.load('600 64px Fraunces'),
      document.fonts.load('italic 500 64px Fraunces'),
      document.fonts.load('500 34px "DM Sans"'),
      document.fonts.load('400 26px "DM Mono"')
    ]).then(function () { return document.fonts.ready; }).catch(function () {});
  }

  function drawQR(ctx, text, x, y, size, dark, light) {
    /* API já usada em orcamento.html: qrcode(typeNumber, ecLevel) */
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var count = qr.getModuleCount();
    var cell = size / count;
    ctx.fillStyle = light;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = dark;
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  var VARIANT_TEXT = {
    avaliacao: function (d) { return 'AVALIAÇÃO ' + '★'.repeat(Math.round(d.score || 5)) + ' RECEBIDA'; },
    marco:     function (d) { return d.marco + ' SERVIÇOS CONCLUÍDOS'; },
    verificado:function ()  { return 'PERFIL VERIFICADO NO FIELDO'; },
    generico:  function ()  { return 'PERFIL NO FIELDO'; }
  };

  /**
   * Gera o card. Não precisa de rede além de baixar a foto (se houver).
   * @param {Object} d
   *   variant   'avaliacao'|'marco'|'verificado'|'generico'
   *   name, profissao, city, niche
   *   photoUrl  foto de capa ou foto de um relatório com consentimento
   *   score     nota média (0-5)
   *   avals     nº de avaliações
   *   servicos  nº de serviços concluídos
   *   marco     nº do marco (usado só na variante 'marco')
   *   slug      slug do profissional — vira o QR e o texto do link
   * @returns {Promise<Blob>} PNG pronto para compartilhar/baixar
   */
  function generate(d) {
    d = d || {};
    var t = tokens();
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var link = (global.FIELDO && global.FIELDO.publicUrl)
      ? global.FIELDO.publicUrl('perfil.html?slug=' + encodeURIComponent(d.slug || ''))
      : (location.origin + '/perfil.html?slug=' + encodeURIComponent(d.slug || ''));

    return Promise.all([loadImage(d.photoUrl), fontsReady()]).then(function (res) {
      var img = res[0];

      /* ── foto sangrando a tela inteira (não mais um bloco separado
         em cima de uma caixa preta — é isso que fazia parecer
         formulário, não card editorial). Sem foto, mesma lógica com
         um fundo neutro + um selo de ícone discreto, nunca um emoji
         gigante centralizado. ── */
      if (img) {
        drawCover(ctx, img, 0, 0, W, H);
      } else {
        ctx.fillStyle = t.paper2;
        ctx.fillRect(0, 0, W, H);
        drawFallbackBadge(ctx, W / 2, H * 0.38, t, d.niche);
      }

      /* gradiente único, longo e suave — a foto e o texto convivem no
         mesmo plano, a leitura escurece gradualmente até a base.
         É o que faz o card parecer uma peça desenhada, não uma foto
         colada acima de uma legenda. */
      var grad = ctx.createLinearGradient(0, H * 0.30, 0, H);
      grad.addColorStop(0,   'rgba(14,14,20,0)');
      grad.addColorStop(0.5, 'rgba(14,14,20,.58)');
      grad.addColorStop(0.8, 'rgba(14,14,20,.86)');
      grad.addColorStop(1,   'rgba(14,14,20,.95)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      /* marca d'água discreta no canto — mesmo selo do logo do topbar
         (quadrado dourado + check), não um bloco de marca grande */
      drawBrandMark(ctx, 84, 96, t);

      var pad = 84;

      /* eyebrow: traço dourado curto + texto — mesmo padrão de
         .page-eyebrow do resto do site, não uma barra de fundo */
      var cy = H - 560;
      ctx.fillStyle = t.gold;
      ctx.fillRect(pad, cy - 10, 30, 2);
      ctx.fillStyle = t.goldL;
      ctx.font = '500 26px "DM Mono", monospace';
      ctx.textBaseline = 'alphabetic';
      var eyebrow = (VARIANT_TEXT[d.variant] || VARIANT_TEXT.generico)(d);
      ctx.fillText(spaced(eyebrow), pad + 46, cy);

      /* nome — o elemento de maior peso visual do card */
      cy += 112;
      ctx.fillStyle = t.paper;
      ctx.font = 'italic 500 104px Fraunces, Georgia, serif';
      ctx.fillText(clean(d.name, 20), pad, cy);

      /* profissão · cidade */
      cy += 56;
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.font = '400 32px "DM Sans", sans-serif';
      var sub = [clean(d.profissao, 22), clean(d.city, 26)].filter(Boolean).join('   ·   ');
      ctx.fillText(sub, pad, cy);

      /* régua fina — mesmo motivo do ::before de .card-title, só que
         maior, separando identidade (nome) de prova social (nota) */
      cy += 54;
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fillRect(pad, cy, 140, 1.5);

      /* nota como número editorial grande, não como widget de rating
         genérico — as estrelas viram um detalhe pequeno ao lado */
      cy += 96;
      if (d.score > 0) {
        ctx.fillStyle = t.paper;
        ctx.font = 'italic 400 76px Fraunces, Georgia, serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(d.score.toFixed(1), pad, cy);
        var numW = ctx.measureText(d.score.toFixed(1)).width;
        stars(ctx, pad + numW + 26, cy - 24, d.score, 28, t.gold, 'rgba(255,255,255,.18)');
        if (d.avals) {
          ctx.fillStyle = 'rgba(255,255,255,.45)';
          ctx.font = '400 26px "DM Sans", sans-serif';
          ctx.fillText(d.avals + ' avaliaç' + (d.avals === 1 ? 'ão' : 'ões'), pad + numW + 26, cy + 14);
        }
      } else if (d.servicos) {
        ctx.fillStyle = t.paper;
        ctx.font = 'italic 400 76px Fraunces, Georgia, serif';
        ctx.fillText(String(d.servicos), pad, cy);
        var sw = ctx.measureText(String(d.servicos)).width;
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.font = '400 26px "DM Sans", sans-serif';
        ctx.fillText('serviços concluídos', pad + sw + 22, cy - 4);
      }

      /* rodapé: QR pequeno + wordmark, tratado como colofão discreto,
         não como bloco de CTA disputando atenção com o resto */
      var qrSize = 108;
      var qrY = H - qrSize - 78;
      drawQR(ctx, link, pad, qrY, qrSize, 'rgba(255,255,255,.92)', 'rgba(255,255,255,0)');
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '500 26px "DM Sans", sans-serif';
      ctx.fillText('fieldo', pad + qrSize + 26, qrY + 48);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.font = '400 21px "DM Mono", monospace';
      wrapLink(ctx, link.replace(/^https?:\/\//, ''), pad + qrSize + 26, qrY + 80, W - pad - qrSize - 26 - pad);

      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, 'image/png', 0.92);
      });
    });
  }

  /* selo do fallback sem foto: ícone de linha discreto dentro de um
     círculo, nunca um emoji gigante ocupando o quadro sozinho */
  function drawFallbackBadge(ctx, cx, cy, t, niche) {
    ctx.strokeStyle = 'rgba(14,14,20,.14)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 130, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '108px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = .55;
    ctx.fillText(NICHE_EMOJI[niche] || '🔧', cx, cy);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  /* mesmo quadrado dourado + check do .logo-icon do topbar em todo o
     site — repete a marca sem duplicar um wordmark grande no card */
  function drawBrandMark(ctx, x, y, t) {
    var s = 34;
    ctx.fillStyle = t.gold;
    roundRect(ctx, x, y, s, s, 7);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.27, y + s * 0.52);
    ctx.lineTo(x + s * 0.43, y + s * 0.68);
    ctx.lineTo(x + s * 0.75, y + s * 0.32);
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function spaced(s) { return String(s).split('').join('\u200a'); } /* leve tracking maiúsculo */

  function wrapLink(ctx, text, x, y, maxW) {
    if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, x, y); return; }
    while (text.length > 3 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    ctx.fillText(text + '…', x, y);
  }

  /**
   * Compartilha o blob via Web Share API (abre o menu nativo —
   * Instagram Stories, WhatsApp etc. aparecem ali no mobile).
   * Sem suporte a arquivo: baixa o PNG e orienta o profissional.
   */
  function share(blob, filename) {
    filename = filename || 'fieldo-card.png';
    var file = new File([blob], filename, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({
        files: [file],
        title: 'Fieldo',
        text: 'Confira meu perfil no Fieldo'
      }).catch(function (e) {
        /* usuário cancelou o menu de compartilhamento — não é erro real */
        if (e && e.name !== 'AbortError') throw e;
      });
    }

    /* fallback: download direto */
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return Promise.resolve();
  }

  global.FIELDO = global.FIELDO || {};
  global.FIELDO.ShareCard = { generate: generate, share: share };

})(window);
