/* ============================================================
   Fieldo · db.js  v4.3
   ─────────────────────────────────────────────────────────────
   Camada de acesso ao Supabase + entitlement Pro local.
   URL:  https://jrsctnncoljdcvdofxsg.supabase.co
   Região: us-east-2

   ÍNDICE DE MÓDULOS (FIELDO.*)
   ┌──────────────────────────────────────────────────────────┐
   │  config         → URLs, anon key, plan limits             │
   │  UI             → toast, format, escape, errors           │
   │  Auth           → sessão por professional_id (telefone)   │
   │  AuthEmail      → DEPRECATED (stub) — substituído v4.0    │
   │                                                            │
   │  Professionals  → CRUD perfil + upload avatar             │
   │  Reports        → relatórios de serviço (local-first)     │
   │  Avaliacoes     → reviews atômicas                        │
   │  Hashes         → document hashes determinísticos          │
   │  Budgets        → orçamentos (local-first)                │
   │  Contratos      → empreitadas + work_entries (Pro)         │
   │  Marketplace    → busca pública                           │
   │                                                            │
   │  License        → HMAC verify offline (modelo FadReview)   │
   │  Validator      → estados tipados de licença              │
   │  RateLimit      → tentativas por janela                   │
   │  Pro            → wrapper de compat sobre License         │
   │                                                            │
   │  LocalDB        → IndexedDB wrapper (drafts/sync/photos)  │
   │  Draft          → auto-save de formulários                │
   │  SyncEngine     → fila + retry em background              │
   │                                                            │
   │  Niches         → categorias default + custom (NOVO 4.3)  │
   │  Themes         → paletas alternativas Pro (NOVO 4.3)     │
   │  Photos         → resize/upload pipeline (NOVO 4.3)       │
   │  UpgradeUI      → modal de upgrade (NOVO 4.3)             │
   │  UsageGuard     → entitlement+quota multi-camada (4.3)    │
   │                                                            │
   │  HBG / Nav      → menu UI compartilhado                   │
   └──────────────────────────────────────────────────────────┘

   v4.3 changes (Phase 3 + Phase 4 do roadmap pós-FadReview):
   - FIELDO.UpgradeUI: modal reutilizável com hero+features+CTAs
     (Ativar Pro / WhatsApp). Sem dep externa, estilos injetados.
   - FIELDO.UsageGuard: guard(action) + enforce(action) que abre
     UpgradeUI quando bloqueado. Single source pra "pode fazer X?".
   - FIELDO.Niches: 8 defaults + até 12 customizáveis (Pro).
     Persiste em LS, expõe emoji()/label() universais.
   - FIELDO.Themes: paper/midnight/sage/ember. Pro liberou os 3
     últimos. Boot aplica antes do paint pra evitar flash.
   - FIELDO.Photos: resize 1600px/JPEG .82 client-side, upload
     pra Supabase Storage com fallback no IDB pra retry offline.

   v4.2 changes (offline-first):
   - LocalDB + Draft + SyncEngine + Reports/Budgets local-first.

   v4.1 changes (Validator + RateLimit):
   - Validator: estados tipados VALID/EXPIRED/INVALID/RATE_LIMITED.
   - RateLimit: 5 tentativas/10min em ativações, sessionStorage.

   v4.0 changes (HMAC client-side):
   - FIELDO.License substitui RPCs activate_pro_code/has_pro_access
   - FIELDO.AuthEmail virou stub (Supabase Auth removido)
   - Emissao de licenca: Edge Function license-issue (v5.0)
============================================================ */

var FIELDO = (function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════
     CONFIG — endpoints, chaves, limites
  ════════════════════════════════════════════════════════════ */
  var SUPABASE_URL  = 'https://jrsctnncoljdcvdofxsg.supabase.co';
  var REST_URL      = SUPABASE_URL + '/rest/v1';
  var STORAGE_URL   = SUPABASE_URL + '/storage/v1/object';
  var EDGE_URL      = SUPABASE_URL + '/functions/v1';

  /* ── v6.8: endereço público dos links compartilhados ──────────

     Problema real: testando em http://127.0.0.1:12886, os links
     enviados ao cliente saíam com esse endereço. O WhatsApp NÃO
     reconhece IP local como link — marca só os números soltos — e o
     cliente precisava recortar e colar. Pior: mesmo colando, o
     endereço não existe fora do aparelho do profissional.

     Link para terceiro precisa SEMPRE apontar para o domínio público,
     independentemente de onde o app está rodando. */
  /* ⚠️ CONFIGURE ANTES DE ENVIAR QUALQUER LINK A CLIENTE ⚠️

     Endereço público onde o app está publicado. É para cá que vão os
     links de relatório, orçamento e avaliação.

     Estava fixado em 'https://fieldo.netlify.app' desde a v4 — um
     domínio que NÃO pertence mais ao projeto (o site foi excluído da
     Netlify). Subdomínio abandonado pode ser registrado por qualquer
     um, e os links carregam TOKENS na URL: quem registrasse receberia
     token de avaliação e de aprovação de orçamento dos seus clientes.

     Deixar vazio é mais seguro que apontar para domínio alheio: sem
     configuração, o app usa a própria origem e avisa no console. */
  var PUBLIC_BASE_URL = '';   /* ex.: 'https://fieldo-app.netlify.app' */

  function _origemLocal(o) {
    return !o || o === 'null' || o === 'file://' ||
           /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|0\.0\.0\.0)/.test(o);
  }

  /* Monta URL destinada ao CLIENTE. Em ambiente local usa o domínio
     público; em produção usa a origem real (permite domínio próprio
     sem mexer no código). */
  var _avisouUrl = false;

  function publicUrl(caminho) {
    var o = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
    var base;

    if (!_origemLocal(o)) {
      base = o.replace(/\/+$/, '');            /* publicado: usa a origem real */
    } else if (PUBLIC_BASE_URL) {
      base = PUBLIC_BASE_URL.replace(/\/+$/, '');
    } else {
      /* Local e sem configuração: usa a origem local mesmo. O link não
         vai funcionar para o cliente — mas apontar para um domínio de
         terceiro seria pior. Avisa uma vez, alto. */
      base = o.replace(/\/+$/, '');
      if (!_avisouUrl) {
        _avisouUrl = true;
        console.warn('[Fieldo] PUBLIC_BASE_URL não configurado em db.js. ' +
          'Links gerados apontam para ' + base + ' e NÃO abrirão no aparelho do cliente.');
      }
    }
    return base + (String(caminho).charAt(0) === '/' ? '' : '/') + caminho;
  }

  /* Permite checar do app se os links são compartilháveis */
  function publicUrlConfigurado() {
    var o = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
    return !_origemLocal(o) || !!PUBLIC_BASE_URL;
  }
  var ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI';

  var HEADERS = {
    'apikey':        ANON_KEY,
    'Authorization': 'Bearer ' + ANON_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };

  var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; /* 30 dias */

  var PLAN_LIMITS = {
    free: { reportsPerMonth: 5 },
    pro:  { reportsPerMonth: Infinity },
  };

  /* ════════════════════════════════════════════════════════════
     ESTADO LOCAL (privado ao IIFE)
  ════════════════════════════════════════════════════════════ */
  var _profId   = null;
  var _profData = null;

  /* ════════════════════════════════════════════════════════════
     INTERNAL HTTP — fetch wrapper para REST do Supabase
     Sempre usa anon key (RLS do banco é a fonte de verdade).
     v5.0: todo request autenticado leva o JWT do Supabase Auth.
     A RLS do Postgres é a única fonte de verdade de autorização.
  ════════════════════════════════════════════════════════════ */
  function _headers(token) {
    return {
      'apikey':        ANON_KEY,
      'Authorization': 'Bearer ' + (token || ANON_KEY),
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    };
  }

  /* opts.anon = true  → força a anon key (leitura pública: QR, perfil,
     marketplace). Sem isso, o JWT do dono vazaria em página pública. */
  function _req(method, path, body, opts) {
    opts = opts || {};
    function envia(token) {
      var init = { method: method, headers: _headers(token) };
      if (body !== undefined) init.body = JSON.stringify(body);
      /* v5.8.2: com timeout. Sem ele, uma requisição que nunca responde
         (sinal oscilando, proxy travado) deixa o botão girando
         indefinidamente — o usuário não sabe se espera ou desiste. */
      return _fetchComTimeout(REST_URL + path, init, 25000);
    }

    var tokenP = opts.anon ? Promise.resolve(null) : Session.getAccessToken();

    return tokenP.then(envia).then(function (r) {
      /* ── v7.1: UMA retentativa quando o servidor responde 401 ──

         `getAccessToken` devolve o token ANTIGO quando o refresh falha.
         Isso é deliberado — é o que mantém o app utilizável offline.
         Mas ONLINE produz uma requisição condenada: o JWT está vencido,
         o Supabase responde 401, e a tela mostra "erro ao carregar".

         Recarregar a página resolvia porque o refresh que havia falhado
         terminava em segundo plano e gravava o token novo. Era o bug do
         "o erro some quando eu atualizo".

         401 é o servidor dizendo que a credencial venceu. A resposta
         certa é renovar e tentar de novo, uma vez só — laço de refresh
         em token realmente inválido seria pior que o erro. */
      if (r.status !== 401 || opts.anon) return r;
      return Session.refresh()
        .then(function (ns) { return envia(ns && ns.access_token); })
        .catch(function () { return r; });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) {
        var err = new Error(t || ('HTTP ' + r.status));
        err.status = r.status;
        throw err;
      });
      var ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : r.text();
    });
  }

  function _get(path, opts)   { return _req('GET',    path, undefined, opts); }
  function _post(path, body)  { return _req('POST',   path, body); }
  /* v7.6: par de _get/_getPublic, mas pra POST — precisa pra captura
     de lead, que acontece ANTES de qualquer sessão existir (a pessoa
     ainda não clicou em "Criar meu perfil"). Sem isto, _post tentaria
     usar um JWT que não existe. */
  function _postPublic(path, body) { return _req('POST', path, body, { anon: true }); }
  function _patch(path, body) { return _req('PATCH',  path, body); }
  function _del(path)         { return _req('DELETE', path); }

  /* ── v6.7: colunas seguras por tabela ────────────────────────

     A v6.5 revogou colunas sensíveis do `anon` (tokens, telefone,
     e-mail). Efeito colateral: o PostgREST monta `SELECT *`, e no
     Postgres isso exige privilégio em TODAS as colunas — a consulta
     inteira passou a falhar com "permission denied", derrubando perfil,
     relatório e busca.

     Em vez de espalhar `select=` por dezenas de chamadas (e esquecer
     numa delas), a lista fica aqui, num lugar só. Coluna nova precisa
     ser adicionada aqui para virar pública — o padrão passa a ser
     "privado até que se decida o contrário". */
  var COLUNAS_PUBLICAS = {
    professionals: 'id,name,profissao,specialty,niche,city,slug,whatsapp,bio,' +
                   'logo_url,instagram,pix_key,pix_tipo,include_pix,plan,' +
                   'is_public,portfolio_publico,created_at',
    reports:       'id,professional_id,client_name,category_key,category_label,' +
                   'niche,service_date,service_location,service_description,' +
                   'photos,is_public,rating,rating_comment,rating_used,' +
                   'linked_budget_id,valor,payment_status,paid_at,' +
                   'client_paid_claim_at,portfolio_ok,created_at,updated_at',
    budgets:       'id,professional_id,number,titulo,client_name,local,descricao,' +
                   'items,subtotal,desconto,total,prazo,validade,pagamento,' +
                   'garantia,observacoes,emissao,status,linked_report_id,' +
                   'is_public,approved_at,approval_note,client_signature,' +
                   'created_at,updated_at',
    avaliacoes:    'id,professional_id,report_id,nota,comentario,nome_avaliador,' +
                   'resposta,respondido_em,created_at',
    document_hashes: 'id,professional_id,hash,tipo,ref_id,conteudo_resumo,created_at',

    /* v7.0 · Locação.

       `equipamentos` tem colunas revogadas do anon, então SEM esta
       entrada o PostgREST monta SELECT * e a leitura pública do
       catálogo falha inteira com "permission denied" — exatamente a
       regressão da v6.5 que a v6.7 corrigiu. Coluna nova só vira
       pública ao ser escrita aqui.

       `locacoes` NÃO entra, de propósito: o anon não recebe uma coluna
       sequer dessa tabela (tem CPF da caução). O cliente enxerga a
       locação dele pela RPC do token, nunca por leitura direta. */
    /* ⚠️ v7.1: era `professional_id`. A coluna virou `locadora_id`
       quando locadora passou a ser entidade própria, e este mapa ficou
       para trás. PostgREST devolve 400 "column does not exist" e a
       leitura pública do catálogo falha inteira — não degrada, quebra. */
    equipamentos:  'id,locadora_id,categoria_id,nome,marca,modelo,' +
                   'descricao,specs,fotos,preco_dia,preco_semana,preco_mes,' +
                   'caucao,quantidade,slug,ativo,is_public,created_at,updated_at',
  };

  /* Injeta `select=` quando a chamada não trouxe um. Views não precisam
     (não têm colunas revogadas), então ficam de fora do mapa. */
  function _comSelect(path) {
    if (path.indexOf('select=') !== -1) return path;
    var tabela = (path.match(/^\/([a-z_]+)/) || [])[1];
    var cols = COLUNAS_PUBLICAS[tabela];
    if (!cols) return path;
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 'select=' + cols;
  }

  /* Leitura pública explícita — usada por relatorio/perfil/explorar */
  var _pub = { anon: true };
  function _getPublic(path)   { return _get(_comSelect(path), _pub); }

  /* RPC (funções SECURITY DEFINER do Postgres) */
  function _rpc(fn, args, opts) {
    return _req('POST', '/rpc/' + fn, args || {}, opts);
  }

  /* ════════════════════════════════════════════════════════════
     LS — wrapper com prefixo "fieldo_" para evitar colisão
  ════════════════════════════════════════════════════════════ */
  var LS = {
    get:    function (k)    { try { return JSON.parse(localStorage.getItem('fieldo_' + k)); } catch(e) { return null; } },
    set:    function (k, v) { try { localStorage.setItem('fieldo_' + k, JSON.stringify(v)); } catch(e) {} },
    remove: function (k)    { try { localStorage.removeItem('fieldo_' + k); } catch(e) {} },
  };

  /* ════════════════════════════════════════════════════════════
     SESSION — identidade via Supabase Anonymous Auth  (v5.0)

     Substitui a "sessão" v4 (um professional_id solto no
     localStorage, que o banco nunca verificava).

     Agora existe um usuário real em auth.users e um JWT assinado
     pelo Supabase. É esse JWT que faz auth.uid() funcionar — e é
     auth.uid() que torna a RLS possível. Sem isso, toda policy
     precisaria voltar a ser USING(true).

     Offline: o JWT é um arquivo de texto no dispositivo. Depois do
     primeiro boot, o app abre e opera sem rede. O refresh_token
     do Supabase não expira por inatividade, então voltar online
     depois de semanas ainda renova a sessão.

     Custo honesto: o PRIMEIRO boot exige internet uma única vez.
     Não há como emitir identidade verificável offline.
  ════════════════════════════════════════════════════════════ */
  var Session = (function () {

    var AUTH_URL   = SUPABASE_URL + '/auth/v1';
    var KEY        = 'auth';          /* LS.get('auth') */
    var SKEW_MS    = 120 * 1000;      /* renova 2min antes de expirar */
    var _mem       = null;
    var _refreshing = null;           /* dedupe de refresh concorrente */

    function _load() {
      if (_mem) return _mem;
      var s = LS.get(KEY);
      if (s && s.access_token && s.user_id) _mem = s;
      return _mem;
    }

    function _save(raw) {
      if (!raw || !raw.access_token) return null;
      var s = {
        access_token:  raw.access_token,
        refresh_token: raw.refresh_token || null,
        user_id:       (raw.user && raw.user.id) || (_mem && _mem.user_id),
        expires_at:    Date.now() + ((raw.expires_in || 3600) * 1000),
      };
      _mem = s;
      LS.set(KEY, s);
      return s;
    }

    function clear() { _mem = null; LS.remove(KEY); }

    function userId() { var s = _load(); return s ? s.user_id : null; }

    function _authFetch(path, body) {
      return fetch(AUTH_URL + path, {
        method:  'POST',
        headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body || {}),
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var e = new Error(j.msg || j.error_description || j.error || ('HTTP ' + r.status));
            e.status = r.status;
            e.code   = j.error_code || j.error;
            throw e;
          }
          return j;
        });
      });
    }

    /* Cria um usuário anônimo real. Sem email, sem senha, sem tela
       de login — mas com uuid e JWT válidos. */
    function signInAnonymously() {
      return _authFetch('/signup', {}).then(function (j) { return _save(j); });
    }

    function refresh() {
      var s = _load();
      if (!s || !s.refresh_token) return Promise.reject(new Error('sem refresh_token'));
      if (_refreshing) return _refreshing;
      _refreshing = _authFetch('/token?grant_type=refresh_token', {
        refresh_token: s.refresh_token,
      }).then(function (j) {
        _refreshing = null;
        return _save(j);
      }).catch(function (err) {
        _refreshing = null;
        /* refresh_token revogado/inválido → sessão morta de verdade */
        if (err.status === 400 || err.status === 401) clear();
        throw err;
      });
      return _refreshing;
    }

    /* Token para o REST. Renova se estiver perto de expirar E houver
       rede. Offline, devolve o token atual mesmo vencido: as leituras
       vêm do IndexedDB e as escritas caem na fila do SyncEngine, que
       reenvia com token novo quando a conexão voltar. */
    function getAccessToken() {
      var s = _load();
      if (!s) return Promise.resolve(null);

      var expiring = Date.now() > (s.expires_at - SKEW_MS);
      var online   = (typeof navigator === 'undefined') || navigator.onLine !== false;

      if (!expiring || !online) return Promise.resolve(s.access_token);

      return refresh()
        .then(function (ns) { return ns.access_token; })
        .catch(function () { return s.access_token; });
    }

    /* Vincula um código de recuperação à identidade anônima.

       Converte o usuário anônimo em permanente usando um email
       sintético DERIVADO DO PRÓPRIO CÓDIGO. Assim a recuperação
       precisa só do código — o profissional não decora uuid nenhum.

       Entropia: 16 chars em base32 Crockford ≈ 80 bits. Inviável
       de adivinhar, e o Supabase ainda aplica rate limit por IP. */
    var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; /* sem I,L,O,U */

    function generateRecoveryCode() {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      var out = '';
      for (var i = 0; i < 16; i++) out += ALPHABET[bytes[i] % 32];
      return out;
    }

    /* ── v6.5: o e-mail sintético deixou de conter o código ─────

       ANTES:  fd-6w1h8vss1p8kxtw8@device.fieldo.app
       O código estava LEGÍVEL em auth.users.email. Eu documentei três
       vezes que "o servidor nunca vê o código em texto claro" — era
       falso. Qualquer pessoa com leitura do banco (painel, backup
       vazado, futuro funcionário) assumia qualquer conta.

       AGORA: o e-mail carrega o SHA-256 do código, não o código.
       O servidor guarda:
         · email = hash (irreversível)
         · senha = bcrypt do código (irreversível)

       Nenhum dos dois permite reconstruir o código. E a recuperação
       continua exigindo apenas o código: o próprio aparelho calcula o
       hash para descobrir o e-mail. */
    function _sha256Hex(txt) {
      if (!(crypto && crypto.subtle)) {
        return Promise.reject(new Error('crypto_indisponivel'));
      }
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt))
        .then(function (buf) {
          var b = new Uint8Array(buf), s = '';
          for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
          return s;
        });
    }

    /* Prefixo fixo para o hash não colidir com outro uso do mesmo código */
    function _emailFor(code) {
      return _sha256Hex('fieldo-recovery-v1:' + String(code).toUpperCase())
        .then(function (hex) {
          /* 32 hex = 128 bits: colisão é inviável, e cabe num e-mail */
          return 'fd-' + hex.slice(0, 32) + '@device.fieldo.app';
        });
    }

    function attachRecoveryCode(code) {
      return Promise.all([getAccessToken(), _emailFor(code)]).then(function (r) {
        var tok = r[0], email = r[1];
        return fetch(AUTH_URL + '/user', {
          method: 'PUT',
          headers: {
            'apikey':        ANON_KEY,
            'Authorization': 'Bearer ' + tok,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ email: email, password: code }),
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (j) {
            throw new Error(j.msg || j.error_description || ('HTTP ' + r.status));
          });
          return true;
        });
      });
    }

    /* Restaura a identidade em outro aparelho a partir do código. */
    function recoverWithCode(code) {
      var clean = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (clean.length !== 16) return Promise.reject(new Error('codigo_invalido'));
      return _emailFor(clean).then(function (email) {
        return _authFetch('/token?grant_type=password', {
          email:    email,
          password: clean,
        });
      }).then(function (j) {
        /* Persiste no aparelho novo: sem isto, quem acabou de recuperar
           veria "código indisponível" no Perfil e ficaria sem saída no
           próximo aparelho. */
        try { localStorage.setItem('fieldo_recovery_code', clean); } catch (e) {}
        return _save(j);
      });
    }

    /* Garante identidade: reusa a existente ou cria anônima. */
    function ensure() {
      var s = _load();
      if (s) return Promise.resolve(s);
      return signInAnonymously();
    }

    return {
      ensure:              ensure,
      signInAnonymously:   signInAnonymously,
      refresh:             refresh,
      getAccessToken:      getAccessToken,
      userId:              userId,
      clear:               clear,
      generateRecoveryCode: generateRecoveryCode,
      attachRecoveryCode:  attachRecoveryCode,
      recoverWithCode:     recoverWithCode,
      isSignedIn:          function () { return !!userId(); },
    };
  })();


  /* ════════════════════════════════════════════════════════════
     AUTH — sessão por professional_id com TTL de 30 dias
  ════════════════════════════════════════════════════════════ */
  var Auth = {

    /* Agora devolve o auth.uid() real do JWT — o mesmo uuid que a
       RLS compara em toda policy. Continua SÍNCRONO de propósito:
       todas as páginas fazem `if (!Auth.isLoggedIn()) redirect` no
       topo do script, e transformar isso em async quebraria as 8
       páginas de uma vez. O bootstrap assíncrono acontece só no
       onboarding (entrar.html). */
    getId: function () {
      return Session.userId();
    },

    /* "Logado" = tem identidade E já completou o perfil. Quem tem
       sessão mas abandonou o onboarding volta pro onboarding. */
    isLoggedIn: function () {
      if (!Session.userId()) return false;
      var cached = LS.get('session_data');
      return !!(cached && cached.id === Session.userId());
    },

    setSession: function (prof) {
      _profData = prof;
      _profId   = prof && prof.id;
      LS.set('session_data', prof);
    },

    /* Sessão não expira mais por TTL local: quem manda é o JWT do
       Supabase. Mantido como no-op para não quebrar chamadores. */
    touchSession: function () {},

    logout: function () {
      _profId = null;
      _profData = null;
      LS.remove('session_data');
      Session.clear();
      /* Sem isto, o próximo usuário do mesmo aparelho encontraria o
         código de recuperação do anterior — acesso permanente à conta
         alheia. É a peça mais sensível guardada localmente. */
      try { localStorage.removeItem('fieldo_recovery_code'); } catch (e) {}
      try { LocalDB.wipe(); } catch (e) {}
    },

    require: function (redirect) {
      if (!Auth.isLoggedIn()) {
        window.location.href = redirect || 'entrar.html';
        return false;
      }
      return true;
    },

    /* Exposto para o onboarding e a tela de recuperação */
    Session: Session,
  };


  /* ════════════════════════════════════════════════════════════
     PIX — BR Code / EMV  (v5.3)

     Gera a string "Copia e Cola" do padrão do Banco Central, COM O
     VALOR EMBUTIDO.

     Por que isso importa: antes o relatório mostrava só a chave. O
     cliente abria o banco, colava a chave, DIGITAVA o valor, conferia
     e pagava — 5 passos e uma chance de errar o número. Com o BR Code
     o valor já vem preenchido: colar e pagar.

     Não exige integração bancária, não tem custo, funciona offline.

     Limite honesto: PIX estático não notifica o recebimento. Saber que
     o cliente pagou depende do botão "Já paguei" (confiança) ou de um
     PSP (Mercado Pago, Gerencianet) — outro projeto.
  ════════════════════════════════════════════════════════════ */
  var Pix = (function () {

    /* Remove acentos e caracteres que o padrão EMV não aceita.
       Banco que recebe BR Code com acento costuma rejeitar. */
    function _ascii(s, max) {
      return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9 .,\-]/g, '')
        .trim().slice(0, max || 99).toUpperCase();
    }

    /* Campo EMV: ID + tamanho em 2 dígitos + valor */
    function _tlv(id, value) {
      var v = String(value);
      return id + String(v.length).padStart(2, '0') + v;
    }

    /* CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF) — exigido pelo padrão */
    function _crc16(str) {
      var crc = 0xFFFF;
      for (var i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (var j = 0; j < 8; j++) {
          crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
          crc &= 0xFFFF;
        }
      }
      return crc.toString(16).toUpperCase().padStart(4, '0');
    }

    /* Normaliza a chave conforme o tipo. CPF/CNPJ/telefone viajam só
       com dígitos; telefone leva +55. E-mail e aleatória vão como estão. */
    function normalizeKey(key, tipo) {
      var k = String(key || '').trim();
      var t = String(tipo || '').toLowerCase();
      var digits = k.replace(/\D/g, '');

      if (t.indexOf('cpf') === 0 || t.indexOf('cnpj') === 0) return digits;
      if (t.indexOf('tel') === 0 || t.indexOf('cel') === 0 || t.indexOf('fone') >= 0) {
        return digits.length >= 10 && digits.indexOf('55') !== 0 ? '+55' + digits : '+' + digits;
      }
      if (t.indexOf('mail') >= 0 || k.indexOf('@') > 0) return k.toLowerCase();

      /* Sem tipo declarado: infere pelo formato */
      if (k.indexOf('@') > 0) return k.toLowerCase();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k)) return k.toLowerCase(); /* aleatória */
      if (digits.length === 11 || digits.length === 14) return digits;  /* CPF/CNPJ */
      if (digits.length >= 10 && digits.length <= 13) return '+55' + digits.replace(/^55/, '');
      return k;
    }

    /* Valida o mínimo antes de gerar — BR Code inválido é pior que
       nenhum: o cliente cola, o banco recusa, e ele acha que o
       profissional é golpe. */
    function validate(key, tipo) {
      var k = normalizeKey(key, tipo);
      if (!k) return { ok: false, error: 'Chave PIX não informada' };
      if (k.indexOf('@') > 0) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)
          ? { ok: true, key: k } : { ok: false, error: 'E-mail inválido' };
      }
      if (k.charAt(0) === '+') {
        return k.replace(/\D/g, '').length >= 12
          ? { ok: true, key: k } : { ok: false, error: 'Telefone inválido' };
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
        return { ok: true, key: k };
      }
      if (/^\d{11}$/.test(k) || /^\d{14}$/.test(k)) return { ok: true, key: k };
      return { ok: false, error: 'Chave PIX em formato não reconhecido' };
    }

    /* Monta o BR Code. amount opcional: sem ele, o cliente digita o valor. */
    function brcode(opts) {
      opts = opts || {};
      var v = validate(opts.key, opts.tipo);
      if (!v.ok) return { ok: false, error: v.error };

      var nome   = _ascii(opts.name || 'RECEBEDOR', 25) || 'RECEBEDOR';
      var cidade = _ascii(opts.city || 'BRASIL', 15)     || 'BRASIL';

      /* txid: identifica a cobrança no extrato. '***' = sem identificador. */
      var txid = _ascii(opts.txid || '***', 25).replace(/[^A-Z0-9]/g, '') || '***';

      var mai = _tlv('00', 'br.gov.bcb.pix') + _tlv('01', v.key);

      var payload =
        _tlv('00', '01') +                    /* formato */
        _tlv('26', mai) +                     /* merchant account info */
        _tlv('52', '0000') +                  /* categoria */
        _tlv('53', '986');                    /* moeda BRL */

      if (opts.amount != null && Number(opts.amount) > 0) {
        payload += _tlv('54', Number(opts.amount).toFixed(2));
      }

      payload +=
        _tlv('58', 'BR') +
        _tlv('59', nome) +
        _tlv('60', cidade) +
        _tlv('62', _tlv('05', txid));

      payload += '6304';                      /* CRC placeholder */
      return { ok: true, code: payload + _crc16(payload), key: v.key };
    }

    return { brcode: brcode, validate: validate, normalizeKey: normalizeKey };
  })();


  /* ════════════════════════════════════════════════════════════
     PWA — registro do service worker  (v5.7)

     Um SW persiste no aparelho. Se servir cache quebrado, o usuário
     fica preso mesmo depois de você corrigir e publicar. Por isso:

       · só registra em HTTPS (ou localhost)
       · falha em silêncio — nenhuma feature do app depende dele
       · expõe FIELDO.PWA.reset() como botão de emergência, que
         remove o SW e limpa todos os caches
       · avisa quando há versão nova, em vez de trocar debaixo do
         usuário no meio de um formulário
  ════════════════════════════════════════════════════════════ */
  var PWA = (function () {

    var _reg = null;
    var _onUpdate = null;

    function suportado() {
      return typeof navigator !== 'undefined' &&
             'serviceWorker' in navigator &&
             (location.protocol === 'https:' ||
              location.hostname === 'localhost' ||
              location.hostname === '127.0.0.1');
    }

    /* v5.9: DESATIVADO.

       O service worker causou quatro falhas seguidas em produção: foto
       de perfil sumindo, dados sumindo ao atualizar, botões do menu
       voltando para a tela inicial e relatório não abrindo.

       Todas tinham a mesma raiz: eu tratei cache como configuração, não
       como código. O ganho (abrir offline) não pagou o custo.

       O app continua instalável na tela inicial pelo manifest.json, e o
       offline de DADOS segue funcionando pelo IndexedDB/SyncEngine, que
       é independente disto.

       registrar() virou no-op. reset() continua ativo para limpar
       instalações antigas. */
    function registrar() {
      return Promise.resolve(null);
    }


    /* Aplica a versão nova e recarrega. Chamado pelo usuário. */
    function atualizar() {
      if (!_reg || !_reg.waiting) { location.reload(); return; }
      _reg.waiting.postMessage('skip-waiting');
      var recarregou = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (recarregou) return;   /* Chrome dispara mais de uma vez */
        recarregou = true;
        location.reload();
      });
    }

    function onUpdate(fn) { _onUpdate = fn; }

    /* ── Botão de emergência ──────────────────────────────────
       Remove o SW e apaga todos os caches. Se algum dia o app
       "travar numa versão antiga", isto resolve sem depender de o
       usuário saber limpar dados do navegador. */
    function reset() {
      var tarefas = [];
      if (typeof caches !== 'undefined') {
        tarefas.push(caches.keys().then(function (ns) {
          return Promise.all(ns.map(function (n) { return caches.delete(n); }));
        }));
      }
      if (suportado()) {
        tarefas.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
      return Promise.all(tarefas).then(function () { location.reload(true); });
    }

    return {
      registrar: registrar,
      atualizar: atualizar,
      onUpdate:  onUpdate,
      reset:     reset,
      suportado: suportado,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     CACHE OFFLINE DE LISTAS  (v5.7.1)

     Bug corrigido: as listas faziam _get() sem fallback. Offline, a
     promise rejeitava e a tela ficava vazia — o app prometia "funciona
     sem internet" e mostrava zero serviços ao atualizar a página.

     Pior: os dados nunca eram gravados localmente, então não havia nem
     o que ler. O IndexedDB só guardava o que estava em fila de envio.

     Agora: toda leitura bem-sucedida grava (write-through); toda falha
     de rede lê do local. O offline passa a ser consequência do uso
     normal, sem o usuário precisar "preparar" nada.
  ════════════════════════════════════════════════════════════ */
  function _listaComCache(store, fetcher) {
    return fetcher()
      .then(function (rows) {
        /* Grava em segundo plano: se o IndexedDB falhar (aba privada,
           cota cheia), a leitura online não pode quebrar por isso. */
        _guardarLocal(store, rows).catch(function () {});
        return rows;
      })
      .catch(function (err) {
        var offline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
                      (err && (err.status === 0 || err.name === 'TypeError' ||
                               /fetch|network|Failed/i.test(String(err.message || ''))));
        if (!offline) throw err;

        return LocalDB.list(store, { limit: 500 })
          .then(function (locais) {
            return locais
              .filter(function (r) { return r._syncStatus !== 'deleted'; })
              .map(_normalizarLocal)
              .filter(Boolean)
              .sort(function (a, b) {
                return String(b.created_at || '').localeCompare(String(a.created_at || ''));
              });
          })
          .catch(function () { return []; });
      });
  }

  /* Registros locais têm DUAS formas históricas:
       · create() grava embrulhado:  { data: {...}, _localId, _syncStatus }
       · o cache de leitura grava plano: { ...linha, _localId }

     A lista concatenava os dois sem normalizar, então o item criado
     offline aparecia EM BRANCO — o profissional via a linha vazia e
     concluía que tinha perdido o serviço.

     Desembrulha e marca como pendente para a UI poder sinalizar. */
  function _normalizarLocal(r) {
    if (!r) return null;
    var base = r.data && typeof r.data === 'object' ? r.data : r;
    return Object.assign({}, base, {
      id:           base.id || r._serverId || r._localId,
      _localId:     r._localId,
      _pendingSync: r._syncStatus === 'pending',
      created_at:   base.created_at || r.created_at ||
                    new Date(r._updatedAt || Date.now()).toISOString(),
    });
  }

  function _guardarLocal(store, rows) {
    if (!Array.isArray(rows) || !rows.length) return Promise.resolve();
    if (!LocalDB.isSupported || !LocalDB.isSupported()) return Promise.resolve();
    return Promise.all(rows.slice(0, 500).map(function (r) {
      if (!r || !r.id) return null;
      /* _localId = id do servidor: reescrever o mesmo registro em vez
         de acumular duplicata a cada carregamento. */
      var copia = Object.assign({}, r, {
        _localId: r.id, _serverId: r.id, _syncStatus: 'synced',
      });
      return LocalDB.put(store, copia).catch(function () { return null; });
    })).then(function () {});
  }

  /* ── v5.8.2 · utilidades de rede e imagem ──────────────────────

     Timeout: sem ele, um request que nunca responde deixa o botão
     girando para sempre. O usuário não tem como saber se deve esperar
     ou desistir — e foi exatamente o sintoma relatado em "editar perfil
     fica rodando". */
  function _fetchComTimeout(url, opts, ms) {
    var limite = ms || 30000;
    if (typeof AbortController === 'undefined') return fetch(url, opts);

    var ctrl = new AbortController();
    opts = Object.assign({}, opts, { signal: ctrl.signal });
    var estourou = false;
    var t = setTimeout(function () { estourou = true; ctrl.abort(); }, limite);

    return fetch(url, opts)
      .then(function (r) { clearTimeout(t); return r; })
      .catch(function (err) {
        clearTimeout(t);
        if (estourou) {
          var e = new Error('A conexão demorou demais. Tente de novo.');
          e.code = 'timeout';
          throw e;
        }
        throw err;
      });
  }

  /* Reduz a imagem no dispositivo antes de subir. Economiza dados do
     profissional, que costuma estar em plano limitado. */
  function _reduzirImagem(file, maxDim, qualidade) {
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined' || !file || !file.type ||
          file.type.indexOf('image/') !== 0) return reject(new Error('nao_imagem'));

      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var esc = Math.min(1, (maxDim || 512) / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width  = Math.round(w * esc);
          cv.height = Math.round(h * esc);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (blob) {
            blob ? resolve(blob) : reject(new Error('canvas_falhou'));
          }, 'image/jpeg', qualidade || 0.85);
        } catch (e) { reject(e); }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('imagem_invalida'));
      };
      img.src = url;
    });
  }

  /* ════════════════════════════════════════════════════════════
     PROFESSIONALS
  ════════════════════════════════════════════════════════════ */
  var Professionals = {

    getById: function (id) {
      return _getPublic('/professionals?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    getByPhone: function (phone) {
      return _get('/professionals?phone=eq.' + encodeURIComponent(phone) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    getBySlug: function (slug) {
      return _getPublic('/professionals?slug=eq.' + encodeURIComponent(slug) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    me: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve(null);
      if (_profData) return Promise.resolve(_profData);
      var cached = LS.get('session_data');
      if (cached && cached.id === id) { _profData = cached; return Promise.resolve(cached); }
      return _get('/professionals?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; })
        .then(function (prof) {
        if (prof) { _profData = prof; LS.set('session_data', prof); }
        return prof;
      });
    },

    /* O id NÃO é gerado pelo banco: é o auth.uid(). A policy
       prof_insert_self recusa qualquer outro valor, então não dá
       para criar perfil no lugar de outra pessoa. */
    create: function (data) {
      return Session.ensure().then(function (s) {
        data.id = s.user_id;
        return _post('/professionals', data);
      }).then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    update: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      return _patch('/professionals?id=eq.' + id, data)
        .then(function (rows) {
          var prof = Array.isArray(rows) ? rows[0] : rows;
          if (prof) { _profData = prof; LS.set('session_data', prof); }
          return prof;
        });
    },

    /* Upload de avatar com VALIDAÇÃO de tipo e tamanho */
    uploadAvatar: function (file) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      if (!file) return Promise.reject(new Error('Arquivo vazio'));

      if (!file.type || !file.type.startsWith('image/')) {
        return Promise.reject(new Error('Arquivo não é uma imagem válida'));
      }
      if (file.size > 5 * 1024 * 1024) {
        return Promise.reject(new Error('Imagem maior que 5MB'));
      }

      /* Caminho prefixado pelo uid: a policy av_write exige que o
         primeiro segmento seja auth.uid(). */
      var path = id + '/avatar.jpg';

      /* v5.8.2: o arquivo era enviado CRU. Uma foto de celular de 12MP
         tem 3–5 MB; em 3G isso leva dezenas de segundos, e o usuário só
         vê o botão girando. Pior: se passar de 5 MB, o bucket recusa
         DEPOIS de subir tudo.

         As fotos de serviço já passavam por redução (Photos.add); o
         avatar não. Agora passa: ~2 MB viram ~80 KB.

         O bucket também só aceita jpeg/png/webp — enviar .gif dava erro
         no fim do upload. Reduzir sempre para JPEG elimina o caso. */
      return _reduzirImagem(file, 512, 0.85)
        .catch(function () { return file; })   /* canvas indisponível: envia como está */
        .then(function (blob) {
          return Session.getAccessToken().then(function (token) {
            return _fetchComTimeout(STORAGE_URL + '/avatars/' + path, {
              method: 'PUT',
              headers: {
                'apikey':        ANON_KEY,
                'Authorization': 'Bearer ' + (token || ANON_KEY),
                'Content-Type':  blob.type || 'image/jpeg',
                'x-upsert':      'true',
              },
              body: blob,
            }, 45000);
          });
        }).then(function (r) {
          if (!r.ok) {
            if (r.status === 413) throw new Error('Imagem grande demais');
            if (r.status === 403) throw new Error('Sem permissão para enviar');
            throw new Error('Upload falhou (' + r.status + ')');
          }
          return SUPABASE_URL + '/storage/v1/object/public/avatars/' + path + '?t=' + Date.now();
        });
    },

    buildSlug: function (name, profissao, city, id) {
      var parts = [name, profissao, city]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      var suffix = id ? id.replace(/-/g,'').slice(0, 6) : Math.random().toString(36).slice(2, 8);
      return parts + '-' + suffix;
    },
  };

  /* ════════════════════════════════════════════════════════════
     REPORTS
  ════════════════════════════════════════════════════════════ */
  var Reports = {

    list: function (opts) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      opts = opts || {};
      var qs = '/reports?professional_id=eq.' + id;
      qs += '&order=created_at.desc';
      if (opts.limit) qs += '&limit=' + opts.limit;

      return _listaComCache('reports', function () { return _get(qs); })
        .then(function (remote) {
          /* Mescla com pendentes locais (ainda não enviados) */
          return LocalDB.list('reports', { status: 'pending', limit: 100 })
            .then(function (pending) {
              var localOnly = pending
                .filter(function (r) { return !r._serverId; })
                .map(_normalizarLocal)
                .filter(Boolean);
              return localOnly.concat(remote);
            })
            .catch(function () { return remote; });
        });
    },

    getById: function (id) {
      return _getPublic('/reports?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* v6.1: via RPC. Antes filtrava direto na tabela, o que exigia que
       o `anon` pudesse LER a coluna rating_token — e quem lê a coluna
       lista TODOS os tokens e forja nota em qualquer relatório público.
       A RPC valida no servidor e devolve o relatório SEM o token. */
    getByToken: function (token) {
      return _rpc('report_por_token', { p_token: token }, { anon: true })
        .then(function (res) {
          var r = Array.isArray(res) ? res[0] : res;
          return (r && r.id) ? r : null;
        });
    },

    /* Local-first: salva em IndexedDB + tenta REST + enfileira fallback */
    create: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      data.professional_id = id;

      /* 1. Salva local imediatamente */
      return LocalDB.put('reports', { data: data })
        .catch(function () { return null; }) /* IDB pode falhar — segue */
        .then(function (localRecord) {
          var localId = localRecord && localRecord._localId;

          /* 2. Tenta enviar pro Supabase agora */
          return _post('/reports', data)
            .then(function (rows) {
              var serverRow = Array.isArray(rows) ? rows[0] : rows;
              /* 3a. Sucesso: marca synced no local e retorna o servidor */
              if (localId && serverRow && serverRow.id) {
                LocalDB.update('reports', localId, {
                  _serverId:   serverRow.id,
                  _syncStatus: 'synced',
                  data:        serverRow,
                }).catch(function () {});
              }
              return serverRow;
            })
            .catch(function (err) {
              /* 3b. Falha: enfileira para SyncEngine */
              if (localId) {
                LocalDB.queueOp({
                  type:     'create',
                  table:    'reports',
                  localId:  localId,
                  payload:  data,
                }).catch(function () {});
              }
              /* Retorna registro local com flag de pendente */
              if (localRecord) {
                return Object.assign({}, data, {
                  id:           localId, /* usa localId como id "provisional" */
                  _pendingSync: true,
                  _localId:     localId,
                });
              }
              throw err;
            });
        });
    },

    update: function (reportId, data) {
      return _patch('/reports?id=eq.' + reportId, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    delete: function (reportId) {
      return _del('/reports?id=eq.' + reportId);
    },

    recent: function (limit) {
      return Reports.list({ limit: limit || 5 });
    },

    stats: function () {
      /* Herda o cache offline de Reports.list. O .catch garante que uma
         falha aqui não derrube o dashboard inteiro. */
      return Reports.list().catch(function () { return []; }).then(function (rows) {
        var total = rows.length;
        var now   = new Date();
        var mes   = rows.filter(function (r) {
          var d = new Date(r.created_at);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length;
        var comAvaliacao = rows.filter(function (r) { return r.rating > 0; });
        var avgScore = comAvaliacao.length
          ? (comAvaliacao.reduce(function (s, r) { return s + r.rating; }, 0) / comAvaliacao.length).toFixed(1)
          : null;
        var nichos = {};
        rows.forEach(function (r) {
          var n = r.niche || r.category_key || '';
          if (n) nichos[n] = (nichos[n] || 0) + 1;
        });
        var nichoTop = Object.keys(nichos).sort(function (a, b) { return nichos[b] - nichos[a]; })[0] || null;

        /* ── v5.3: métricas financeiras ────────────────────────────
           Só possíveis agora que reports.valor existe. Antes o painel
           não conseguia responder "quanto tenho a receber?" porque o
           dado nunca era gravado. */
        var aReceber = 0, qtdReceber = 0, recebidoMes = 0, qtdPagoMes = 0;
        rows.forEach(function (r) {
          var v = parseFloat(r.valor);
          if (!isFinite(v) || v <= 0) return;
          if (r.payment_status === 'pendente') { aReceber += v; qtdReceber++; return; }
          if (r.payment_status === 'pago' && r.paid_at) {
            var p = new Date(r.paid_at);
            if (p.getMonth() === now.getMonth() && p.getFullYear() === now.getFullYear()) {
              recebidoMes += v; qtdPagoMes++;
            }
          }
        });
        /* Arredonda ao centavo: somar float acumula erro (0.1+0.2). */
        var r2 = function (n) { return Math.round(n * 100) / 100; };

        return {
          total: total, mes: mes, avgScore: avgScore, nichoTop: nichoTop,
          aReceber:    r2(aReceber),
          qtdReceber:  qtdReceber,
          recebidoMes: r2(recebidoMes),
          qtdPagoMes:  qtdPagoMes,
        };
      });
    },

    /* Verifica se o profissional pode criar um novo relatório (limite do plano) */
    canCreate: function () {
      return Promise.all([
        Professionals.me(),
        Reports.stats(),
      ]).then(function (results) {
        var prof  = results[0] || {};
        var stats = results[1];
        var planKey = prof.plan || 'free';
        var limit = (PLAN_LIMITS[planKey] || PLAN_LIMITS.free).reportsPerMonth;
        return {
          allowed:    stats.mes < limit,
          used:       stats.mes,
          limit:      limit,
          plan:       planKey,
          remaining:  Math.max(0, limit - stats.mes),
        };
      });
    },
  };

  /* ════════════════════════════════════════════════════════════
     AVALIAÇÕES — submit ATÔMICO com rollback
  ════════════════════════════════════════════════════════════ */
  var Avaliacoes = {

    /* v5.0: uma única RPC transacional no Postgres.

       A v4 fazia PATCH no report e depois INSERT na avaliação, com
       rollback manual se o segundo falhasse. Se o cliente fechasse
       o navegador entre os dois, o relatório ficava marcado como
       avaliado sem avaliação nenhuma — irreversível pelo usuário.

       Além disso a RLS não permite mais escrita anônima direta:
       o rating_token (96 bits) é validado dentro da função. */
    submit: function (token, nota, comentario, nomeAvaliador) {
      return _rpc('submit_rating', {
        p_token:      token,
        p_nota:       nota,
        p_comentario: comentario || null,
        p_nome:       nomeAvaliador || null,
      }, { anon: true }).then(function (res) {
        var r = Array.isArray(res) ? res[0] : res;
        if (r && r.ok) return r;
        var msgs = {
          nao_encontrado: 'Relatório não encontrado',
          ja_avaliado:    'Esta avaliação já foi enviada',
          nota_invalida:  'Nota inválida',
        };
        throw new Error(msgs[r && r.error] || 'Não foi possível enviar');
      });
    },

    list: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/avaliacoes?professional_id=eq.' + id + '&order=created_at.desc');
    },

    /* v6.3: direito de resposta.
       O profissional NÃO pode alterar nota nem comentário — só
       acrescentar a versão dele. Garantido por privilégio de coluna no
       banco, não por confiança no cliente. */
    responder: function (avaliacaoId, texto) {
      var t = String(texto || '').trim();
      if (t.length > 600) return Promise.reject(new Error('Resposta muito longa (máx. 600)'));
      return _patch('/avaliacoes?id=eq.' + encodeURIComponent(avaliacaoId),
                    { resposta: t || null })
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
  };

  /* ════════════════════════════════════════════════════════════
     PAGAMENTO — aviso do cliente  (v5.4)

     "Já paguei" NÃO marca o serviço como pago. Pix estático não
     notifica recebimento; aceitar a palavra do cliente como verdade
     contábil faria o painel financeiro mentir.

     Fica registrado como AVISO. O profissional confirma no app, e só
     então payment_status vira 'pago'.
  ════════════════════════════════════════════════════════════ */
  var Pagamento = {
    claim: function (ratingToken) {
      return _rpc('claim_payment', { p_token: ratingToken }, { anon: true })
        .then(function (res) {
          var r = Array.isArray(res) ? res[0] : res;
          if (r && r.ok) return r;
          var e = new Error('Não foi possível registrar o aviso');
          e.code = r && r.error;
          throw e;
        });
    },

    /* Confirmação do profissional — esta sim muda o status. */
    confirmar: function (reportId) {
      return Reports.update(reportId, {
        payment_status: 'pago',
        paid_at: new Date().toISOString(),
      });
    },
  };

  /* ════════════════════════════════════════════════════════════
     DOCUMENT HASHES
  ════════════════════════════════════════════════════════════ */
  var Hashes = {

    register: function (hash, tipo, refId, resumo) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      return _post('/document_hashes', {
        professional_id: id,
        hash:            hash,
        tipo:            tipo,
        ref_id:          refId,
        conteudo_resumo: resumo || null,
      }).then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    verify: function (hash) {
      return _getPublic('/document_hashes?hash=eq.' + encodeURIComponent(hash) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* Busca hash por ref_id */
    getByRef: function (refId) {
      return _getPublic('/document_hashes?ref_id=eq.' + encodeURIComponent(refId) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* v5.7.2: sem .catch, esta chamada derrubava o Promise.all do
       painel inteiro quando offline. Hash é informativo — nunca deve
       impedir o resto da tela de aparecer. */
    list: function (limit) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/document_hashes?professional_id=eq.' + id +
                  '&order=created_at.desc&limit=' + (limit || 10))
        .catch(function () { return []; });
    },

    /* SHA-256 DETERMINÍSTICO (sem timestamp) */
    sha256: function (obj) {
      var keys = Object.keys(obj).sort();
      var str  = JSON.stringify(obj, keys);
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
        .then(function (buf) {
          return Array.from(new Uint8Array(buf))
            .map(function (b) { return b.toString(16).padStart(2, '0'); })
            .join('');
        });
    },
  };

  /* ════════════════════════════════════════════════════════════
     BUDGETS
  ════════════════════════════════════════════════════════════ */
  var Budgets = {

    list: function (limit) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      var qs = '/budgets?professional_id=eq.' + id + '&order=created_at.desc&limit=' + (limit || 50);
      return _listaComCache('budgets', function () { return _get(qs); })
        .then(function (remote) {
          /* Mescla pendentes locais */
          return LocalDB.list('budgets', { status: 'pending', limit: 100 })
            .then(function (pending) {
              var localOnly = pending
                .filter(function (b) { return !b._serverId; })
                .map(_normalizarLocal)
                .filter(Boolean);
              return localOnly.concat(remote);
            })
            .catch(function () { return remote; });
        });
    },

    /* v5.4: leitura pelo token de aprovação. O cliente recebe o link e
       não conhece o id; o token é o segredo que autoriza a decisão. */
    /* v6.1: via RPC, mesmo motivo do relatório — approval_token legível
       permitia aprovar ou RECUSAR orçamento de qualquer profissional. */
    getByApprovalToken: function (token) {
      return _rpc('orcamento_por_token', { p_token: token }, { anon: true })
        .then(function (res) {
          var b = Array.isArray(res) ? res[0] : res;
          return (b && b.id) ? b : null;
        });
    },

    /* Decisão do cliente. Espelha Avaliacoes.submit: RPC transacional,
       sem escrita anônima direta na tabela. */
    decide: function (token, decisao, nota, assinatura) {
      return _rpc('decide_budget', {
        p_token:      token,
        p_decisao:    decisao,
        p_nota:       nota || null,
        p_assinatura: assinatura || null,
      }, { anon: true }).then(function (res) {
        var r = Array.isArray(res) ? res[0] : res;
        if (r && r.ok) return r;
        var msgs = {
          nao_encontrado:   'Orçamento não encontrado',
          ja_decidido:      'Este orçamento já foi respondido',
          decisao_invalida: 'Resposta inválida',
        };
        var e = new Error(msgs[r && r.error] || 'Não foi possível registrar');
        e.code = r && r.error;
        e.status = r && r.status;
        throw e;
      });
    },

    getById: function (id) {
      return _getPublic('/budgets?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* Local-first: salva em IndexedDB + tenta REST + enfileira fallback */
    create: function (data) {
      var profId = Auth.getId();
      if (!profId) return Promise.reject(new Error('Não autenticado'));
      data.professional_id = profId;

      return LocalDB.put('budgets', { data: data })
        .catch(function () { return null; })
        .then(function (localRecord) {
          var localId = localRecord && localRecord._localId;

          return _post('/budgets', data)
            .then(function (rows) {
              var serverRow = Array.isArray(rows) ? rows[0] : rows;
              if (localId && serverRow && serverRow.id) {
                LocalDB.update('budgets', localId, {
                  _serverId:   serverRow.id,
                  _syncStatus: 'synced',
                  data:        serverRow,
                }).catch(function () {});
              }
              return serverRow;
            })
            .catch(function (err) {
              if (localId) {
                LocalDB.queueOp({
                  type:    'create',
                  table:   'budgets',
                  localId: localId,
                  payload: data,
                }).catch(function () {});
              }
              if (localRecord) {
                return Object.assign({}, data, {
                  id:           localId,
                  _pendingSync: true,
                  _localId:     localId,
                });
              }
              throw err;
            });
        });
    },

    update: function (id, data) {
      return _patch('/budgets?id=eq.' + id, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    delete: function (id) {
      return _del('/budgets?id=eq.' + id);
    },

    buildNumber: function (existingCount) {
      var year = new Date().getFullYear();
      var num  = String((existingCount || 0) + 1).padStart(4, '0');
      return year + '-' + num;
    },
  };

  /* ════════════════════════════════════════════════════════════
     EMPREITEIROS / EMPREITADAS / WORK ENTRIES
  ════════════════════════════════════════════════════════════ */
  var Contratos = {
    listEmpreiteiros: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/empreiteiros?professional_id=eq.' + id + '&order=nome.asc');
    },
    createEmpreiteiro: function (data) {
      data.professional_id = Auth.getId();
      return _post('/empreiteiros', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
    deleteEmpreiteiro: function (id) {
      return _del('/empreiteiros?id=eq.' + id);
    },

    listEmpreitadas: function (empreteiroId) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      var qs = '/empreitadas?professional_id=eq.' + id;
      if (empreteiroId) qs += '&empreiteiro_id=eq.' + empreteiroId;
      return _get(qs + '&order=created_at.desc');
    },
    createEmpreitada: function (data) {
      data.professional_id = Auth.getId();
      return _post('/empreitadas', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
    updateEmpreitada: function (id, data) {
      return _patch('/empreitadas?id=eq.' + id, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    listEntries: function (empreitadaId) {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      var qs = '/work_entries?professional_id=eq.' + id;
      if (empreitadaId) qs += '&empreitada_id=eq.' + empreitadaId;
      return _get(qs + '&order=created_at.desc');
    },
    createEntry: function (data) {
      data.professional_id = Auth.getId();
      return _post('/work_entries', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
    updateEntry: function (id, data) {
      return _patch('/work_entries?id=eq.' + id, data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },
  };

  /* ════════════════════════════════════════════════════════════
     MARKETPLACE
  ════════════════════════════════════════════════════════════ */
  var Marketplace = {
    list: function (order, limit) {
      order = order || 'media_geral.desc.nullslast';
      limit = limit || 40;
      return _getPublic('/professional_stats?order=' + order + '&limit=' + limit);
    },

    search: function (query, order) {
      order = order || 'media_geral.desc.nullslast';
      var encoded = encodeURIComponent('%' + query + '%');
      return _getPublic(
        '/professional_stats?or=(name.ilike.' + encoded +
        ',profissao.ilike.' + encoded +
        ',city.ilike.' + encoded + ')&order=' + order
      );
    },
  };

  /* ════════════════════════════════════════════════════════════
     UI HELPERS — incluindo HTML escape automático
  ════════════════════════════════════════════════════════════ */
  var UI = {

    toast: function (msg, duration) {
      var el = document.getElementById('fieldo-toast') || document.getElementById('pack-toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(function () { el.classList.remove('show'); }, duration || 2800);
    },

    stars: function (n) {
      n = Math.round(parseFloat(n) || 0);
      return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
    },

    /* Escape HTML — uso obrigatório em todo innerHTML com dado dinâmico */
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /* Tagged template para construir HTML com escape automático.
       Uso: UI.html`<div>${nomeDoUsuario}</div>` */
    html: function (strings) {
      if (Array.isArray(strings) || (strings && strings.raw)) {
        var out = strings[0];
        for (var i = 1; i < arguments.length; i++) {
          var v = arguments[i];
          out += (v && v.__raw__) ? v.value : UI.esc(v);
          out += strings[i];
        }
        return out;
      }
      return UI.esc(strings);
    },

    /* Marca uma string como HTML seguro (não escapa). Use com cuidado. */
    raw: function (html) {
      return { __raw__: true, value: String(html || '') };
    },

    fmtDate: function (iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleDateString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
        });
      } catch(e) { return iso; }
    },

    fmtDateLong: function (iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleDateString('pt-BR', {
          day: '2-digit', month: 'long', year: 'numeric',
        });
      } catch(e) { return iso; }
    },

    /* ── WhatsApp (v5.5.2) ─────────────────────────────────────
       Havia QUATRO implementações diferentes espalhadas pelas páginas,
       e três estavam erradas de formas distintas: regex `/\\D/g` que
       não limpava nada, prefixo '55' cego que duplicava o DDI, e
       fallback para o número do próprio profissional (abria chat
       consigo mesmo).

       Sintoma comum de todas: o WhatsApp abre em branco. URL inválida
       não gera erro — o app simplesmente ignora. */
    waNumero: function (bruto) {
      var d = String(bruto == null ? '' : bruto).replace(/\D/g, '');
      if (!d) return '';
      d = d.replace(/^0+/, '');            /* 0 de operadora */
      if (d.length === 10 || d.length === 11) d = '55' + d;   /* DDD + número */
      if (d.length === 12 || d.length === 13) {
        if (d.slice(0, 2) !== '55') return '';                /* DDI estrangeiro */
        return d;
      }
      return '';                           /* curto/longo demais → inválido */
    },

    /* Devolve o link ou ''. Vazio significa: NÃO mostre o botão.
       Melhor botão ausente que botão que abre em branco. */
    waLink: function (numero, texto) {
      var n = UI.waNumero(numero);
      var t = '?text=' + encodeURIComponent(texto || '');
      return n ? 'https://wa.me/' + n + t : '';
    },

    /* Seletor de contatos: usado quando não se sabe o número do
       destinatário. Sempre funciona. */
    waPicker: function (texto) {
      return 'https://wa.me/?text=' + encodeURIComponent(texto || '');
    },

    brl: function (val) {
      return 'R$ ' + Number(val || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    },

    skel: function (lines) {
      return Array(lines || 3).fill(
        '<div class="skel" style="height:14px;margin-bottom:8px;border-radius:4px"></div>'
      ).join('');
    },

    /* Handler centralizado de erros */
    handleError: function (err) {
      console.error('[Fieldo]', err);
      var msg = 'Algo deu errado. Tente novamente.';
      if (err && err.message) {
        var m = String(err.message);
        if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1) {
          msg = 'Sem conexão. Verifique sua internet.';
        } else if (m.indexOf('42501') !== -1 || m.indexOf('permission denied') !== -1) {
          msg = 'Você não tem permissão para essa ação.';
        } else if (m.indexOf('23505') !== -1 || m.indexOf('duplicate') !== -1) {
          msg = 'Esse registro já existe.';
        } else if (m.indexOf('Não autenticado') !== -1) {
          msg = 'Sessão expirada. Faça login novamente.';
          setTimeout(function () { window.location.href = 'entrar.html'; }, 1500);
        } else if (m.indexOf('rating_used') !== -1 || m.indexOf('já foi enviada') !== -1) {
          msg = 'Esta avaliação já foi registrada.';
        } else if (m.length < 120 && err.status !== 500) {
          msg = m;
        }
      }
      UI.toast(msg, 3500);
    },
  };

  /* ════════════════════════════════════════════════════════════
     LOCAL DB (NOVO em v4.2) — IndexedDB wrapper
     ─────────────────────────────────────────────────────────────
     Stores:
       drafts       → rascunhos auto-salvos (key = formId, autoinc=false)
       reports      → relatórios pendentes/sincronizados
       budgets      → orçamentos pendentes/sincronizados
       syncQueue    → fila de operações pendentes para REST/Function
       photos       → fotos em base64 antes do upload (resize-on-add)

     Cada record carrega:
       _localId    UUID gerado client-side (estável após sync)
       _syncStatus 'pending' | 'syncing' | 'synced' | 'error'
       _updatedAt  timestamp ms
       _serverId?  id retornado pelo servidor após sync (preenchido)

     API resumida:
       DB.put('reports', { client_name, ... })  → Promise<localId>
       DB.get('reports', localId)               → Promise<record|null>
       DB.list('reports', { status, limit })    → Promise<record[]>
       DB.update('reports', localId, patch)     → Promise<record>
       DB.delete('reports', localId)            → Promise<void>
       DB.queueOp({ type, table, payload })     → Promise<opId>
       DB.dequeueOps(limit)                     → Promise<op[]>
       DB.markOp(opId, status, serverId?)       → Promise<void>
  ════════════════════════════════════════════════════════════ */
  var LocalDB = (function () {

    var DB_NAME = 'fieldo';
    var DB_VERSION = 1;
    var STORES = ['drafts', 'reports', 'budgets', 'syncQueue', 'photos'];

    var _dbPromise = null;
    var _supported = (typeof indexedDB !== 'undefined');

    function _uuid() {
      /* RFC4122 v4 simplificado, suficiente para localId */
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
      var s = '';
      for (var i = 0; i < 32; i++) {
        s += Math.floor(Math.random() * 16).toString(16);
        if (i === 7 || i === 11 || i === 15 || i === 19) s += '-';
      }
      return s;
    }

    function _open() {
      if (!_supported) {
        return Promise.reject(new Error('IndexedDB indisponível'));
      }
      if (_dbPromise) return _dbPromise;

      _dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = function () { reject(req.error || new Error('IDB open error')); };
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          STORES.forEach(function (name) {
            if (!db.objectStoreNames.contains(name)) {
              if (name === 'syncQueue') {
                db.createObjectStore(name, { keyPath: '_opId' });
              } else if (name === 'drafts') {
                /* drafts: keyPath = formId (string fixa por form) */
                db.createObjectStore(name, { keyPath: 'formId' });
              } else {
                var store = db.createObjectStore(name, { keyPath: '_localId' });
                store.createIndex('syncStatus', '_syncStatus', { unique: false });
                store.createIndex('updatedAt',  '_updatedAt',  { unique: false });
              }
            }
          });
        };
        req.onsuccess = function () { resolve(req.result); };
      });

      return _dbPromise;
    }

    function _tx(storeName, mode) {
      return _open().then(function (db) {
        var tx = db.transaction([storeName], mode);
        return tx.objectStore(storeName);
      });
    }

    function _wrap(req) {
      return new Promise(function (resolve, reject) {
        req.onsuccess = function () { resolve(req.result); };
        req.onerror   = function () { reject(req.error); };
      });
    }

    /* ── PUT (insert ou update) ──────────────────────────── */
    function put(storeName, data) {
      var record = Object.assign({}, data);
      if (storeName === 'drafts') {
        if (!record.formId) return Promise.reject(new Error('drafts requer formId'));
        record._updatedAt = Date.now();
      } else if (storeName !== 'syncQueue') {
        if (!record._localId)    record._localId    = _uuid();
        if (!record._syncStatus) record._syncStatus = 'pending';
        record._updatedAt = Date.now();
      }
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.put(record));
      }).then(function () {
        return record;
      });
    }

    function get(storeName, key) {
      return _tx(storeName, 'readonly').then(function (store) {
        return _wrap(store.get(key));
      });
    }

    function list(storeName, opts) {
      opts = opts || {};
      return _tx(storeName, 'readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var results = [];
          var limit = opts.limit || 1000;
          var req = store.openCursor(null, opts.reverse ? 'prev' : 'next');
          req.onsuccess = function (e) {
            var cursor = e.target.result;
            if (!cursor || results.length >= limit) return resolve(results);
            var v = cursor.value;
            if (!opts.status || v._syncStatus === opts.status) {
              results.push(v);
            }
            cursor.continue();
          };
          req.onerror = function () { reject(req.error); };
        });
      });
    }

    function update(storeName, key, patch) {
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.get(key)).then(function (existing) {
          if (!existing) throw new Error('Record não encontrado: ' + key);
          var updated = Object.assign({}, existing, patch, { _updatedAt: Date.now() });
          return _wrap(store.put(updated)).then(function () { return updated; });
        });
      });
    }

    function del(storeName, key) {
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.delete(key));
      });
    }

    function clear(storeName) {
      return _tx(storeName, 'readwrite').then(function (store) {
        return _wrap(store.clear());
      });
    }

    /* ── Sync Queue helpers ──────────────────────────────── */
    function queueOp(op) {
      var record = {
        _opId:       _uuid(),
        type:        op.type,         /* 'create' | 'update' | 'delete' */
        table:       op.table,        /* 'reports' | 'budgets' */
        localId:     op.localId,      /* referência ao record */
        payload:     op.payload,      /* dados a enviar */
        attempts:    0,
        status:      'pending',       /* 'pending' | 'syncing' | 'done' | 'error' */
        lastError:   null,
        createdAt:   Date.now(),
      };
      return _tx('syncQueue', 'readwrite').then(function (store) {
        return _wrap(store.put(record)).then(function () { return record._opId; });
      });
    }

    function dequeueOps(limit) {
      return list('syncQueue', { limit: limit || 20 })
        .then(function (ops) {
          return ops.filter(function (o) { return o.status === 'pending'; });
        });
    }

    function markOp(opId, status, extra) {
      return _tx('syncQueue', 'readwrite').then(function (store) {
        return _wrap(store.get(opId)).then(function (op) {
          if (!op) return;
          op.status = status;
          if (extra) Object.assign(op, extra);
          if (status === 'syncing') op.attempts = (op.attempts || 0) + 1;
          return _wrap(store.put(op));
        });
      });
    }

    function deleteOp(opId) {
      return del('syncQueue', opId);
    }

    /* ── Counters / stats ─────────────────────────────────── */
    function pendingCount(storeName) {
      return list(storeName, { status: 'pending' }).then(function (rows) {
        return rows.length;
      });
    }

    function isSupported() { return _supported; }

    /* Limpa TODOS os stores locais. Usado no logout: sem isso, os
       dados do profissional anterior ficariam visíveis para quem
       usasse o mesmo aparelho depois. */
    function wipe() {
      var stores = ['reports', 'budgets', 'professionals', 'drafts', 'ops'];
      return Promise.all(stores.map(function (s) {
        return clear(s).catch(function () { return null; });
      }));
    }

    return {
      put:           put,
      wipe:          wipe,
      get:           get,
      list:          list,
      update:        update,
      delete:        del,
      clear:         clear,
      queueOp:       queueOp,
      dequeueOps:    dequeueOps,
      markOp:        markOp,
      deleteOp:      deleteOp,
      pendingCount:  pendingCount,
      isSupported:   isSupported,
      _uuid:         _uuid,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     DRAFT (NOVO em v4.2) — auto-save de formulários
     ─────────────────────────────────────────────────────────────
     Salva o estado de um form a cada 600ms. Recupera ao reabrir.

     Uso:
       FIELDO.Draft.attach('servico', form, {
         debounce: 600,
         exclude: ['photo']  // campos que não fazem sentido salvar
       });
       FIELDO.Draft.restore('servico', form); // ao abrir página
       FIELDO.Draft.clear('servico');         // ao submeter com sucesso
  ════════════════════════════════════════════════════════════ */
  var Draft = (function () {

    var _timers = {};

    /* Coleta inputs/textareas/selects dentro do container.
       Aceita tanto <form> quanto qualquer elemento com inputs dentro. */
    function _inputsOf(container) {
      if (!container) return [];
      if (container.elements) {
        /* HTMLFormElement */
        return Array.prototype.filter.call(container.elements, function (el) {
          return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
        });
      }
      return Array.prototype.slice.call(
        container.querySelectorAll('input, textarea, select')
      );
    }

    function _serialize(container, exclude) {
      exclude = exclude || [];
      var data = {};
      _inputsOf(container).forEach(function (el) {
        var key = el.name || el.id;
        if (!key || exclude.indexOf(key) > -1) return;
        if (el.type === 'file' || el.type === 'submit' || el.type === 'button') return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) data[key] = el.value;
        } else {
          data[key] = el.value;
        }
      });
      return data;
    }

    function _apply(container, data) {
      if (!data) return 0;
      var count = 0;
      _inputsOf(container).forEach(function (el) {
        var key = el.name || el.id;
        if (!key || !(key in data)) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = (el.value === data[key]);
        } else {
          el.value = data[key];
        }
        count++;
      });
      return count;
    }

    function attach(formId, container, opts) {
      opts = opts || {};
      var debounce = opts.debounce || 600;
      var exclude  = opts.exclude  || [];

      function save() {
        clearTimeout(_timers[formId]);
        _timers[formId] = setTimeout(function () {
          var data = _serialize(container, exclude);
          LocalDB.put('drafts', { formId: formId, data: data }).catch(function () {});
        }, debounce);
      }

      container.addEventListener('input',  save);
      container.addEventListener('change', save);
      return save;
    }

    function restore(formId, container) {
      return LocalDB.get('drafts', formId).then(function (rec) {
        if (!rec || !rec.data) return 0;
        return _apply(container, rec.data);
      }).catch(function () { return 0; });
    }

    function clear(formId) {
      clearTimeout(_timers[formId]);
      delete _timers[formId];
      return LocalDB.delete('drafts', formId).catch(function () {});
    }

    function exists(formId) {
      return LocalDB.get('drafts', formId).then(function (rec) {
        return !!(rec && rec.data && Object.keys(rec.data).length);
      }).catch(function () { return false; });
    }

    return {
      attach:  attach,
      restore: restore,
      clear:   clear,
      exists:  exists,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     SYNC ENGINE (NOVO em v4.2) — fila persistente + retry
     ─────────────────────────────────────────────────────────────
     Processa LocalDB.syncQueue enviando ops pra REST/Function.

     Comportamento:
       - Roda automático em intervalos (30s) e em eventos online/focus
       - Retry exponencial com backoff (até 5 tentativas)
       - Op 'create' → POST /rest/v1/{table}, salva _serverId no record
       - Op 'update' → PATCH /rest/v1/{table}?id=eq.{serverId}
       - Op 'delete' → DELETE /rest/v1/{table}?id=eq.{serverId}

     Em produção (com Netlify Function /api/sync) pode trocar
     o endpoint pra um único POST /api/sync com batch + deviceHash.
  ════════════════════════════════════════════════════════════ */
  var SyncEngine = (function () {

    var POLL_INTERVAL_MS = 30 * 1000; /* 30s */
    var MAX_ATTEMPTS = 5;
    var BACKOFF_BASE_MS = 5000;

    var _started  = false;
    var _running  = false;
    var _timer    = null;
    var _listeners = [];

    function _fire(event, data) {
      _listeners.forEach(function (fn) {
        try { fn(event, data); } catch (e) {}
      });
    }

    function on(callback) {
      _listeners.push(callback);
      return function () {
        var i = _listeners.indexOf(callback);
        if (i > -1) _listeners.splice(i, 1);
      };
    }

    function _isOnline() {
      return typeof navigator === 'undefined' || navigator.onLine !== false;
    }

    /* Executa uma op individual */
    function _runOp(op) {
      var url, method, body;
      if (op.type === 'create') {
        url = '/' + op.table;
        method = 'POST';
        body = op.payload;
      } else if (op.type === 'update') {
        if (!op.serverId) throw new Error('update requer serverId');
        url = '/' + op.table + '?id=eq.' + encodeURIComponent(op.serverId);
        method = 'PATCH';
        body = op.payload;
      } else if (op.type === 'delete') {
        if (!op.serverId) throw new Error('delete requer serverId');
        url = '/' + op.table + '?id=eq.' + encodeURIComponent(op.serverId);
        method = 'DELETE';
        body = undefined;
      } else {
        throw new Error('Tipo de op desconhecido: ' + op.type);
      }

      return _req(method, url, body).then(function (resp) {
        return Array.isArray(resp) ? resp[0] : resp;
      });
    }

    /* Atualiza o record local com serverId após CREATE bem-sucedido */
    function _writeBackServerId(table, localId, serverRow) {
      if (!serverRow || !serverRow.id) return Promise.resolve();
      return LocalDB.update(table, localId, {
        _serverId:   serverRow.id,
        _syncStatus: 'synced',
      }).catch(function () {});
    }

    /* Processa fila uma vez */
    function flush() {
      if (_running) return Promise.resolve({ skipped: true });
      if (!LocalDB.isSupported()) return Promise.resolve({ unsupported: true });
      if (!_isOnline()) {
        _fire('offline');
        return Promise.resolve({ offline: true });
      }
      _running = true;
      _fire('start');

      return LocalDB.dequeueOps(20).then(function (ops) {
        if (!ops.length) {
          _fire('idle');
          return { processed: 0 };
        }

        var processed = 0, failed = 0;

        function next(i) {
          if (i >= ops.length) return { processed: processed, failed: failed };
          var op = ops[i];

          if (op.attempts >= MAX_ATTEMPTS) {
            return LocalDB.markOp(op._opId, 'error', { lastError: 'max attempts' })
              .then(function () { failed++; return next(i + 1); });
          }

          /* Backoff exponencial: se já tentou N vezes, só roda se passou
             N * BASE * 2^(N-1) ms desde createdAt */
          var minWait = BACKOFF_BASE_MS * Math.pow(2, op.attempts - 1);
          if (op.attempts > 0 && (Date.now() - op.createdAt < minWait)) {
            return next(i + 1); /* espera próximo flush */
          }

          return LocalDB.markOp(op._opId, 'syncing').then(function () {
            return _runOp(op).then(function (serverRow) {
              processed++;
              _fire('opSuccess', { op: op, serverRow: serverRow });
              return _writeBackServerId(op.table, op.localId, serverRow);
            }).then(function () {
              return LocalDB.deleteOp(op._opId);
            }).catch(function (err) {
              failed++;
              _fire('opError', { op: op, error: err });
              return LocalDB.markOp(op._opId, 'pending', {
                lastError: String(err && err.message || err).slice(0, 200),
              });
            });
          }).then(function () { return next(i + 1); });
        }

        return next(0);
      }).then(function (result) {
        _running = false;
        _fire('end', result);
        return result;
      }).catch(function (err) {
        _running = false;
        _fire('error', err);
        throw err;
      });
    }

    /* Inicia loop automático */
    function start() {
      if (_started) return;
      _started = true;

      /* Primeiro flush imediato */
      setTimeout(function () { flush().catch(function () {}); }, 1000);

      /* Loop */
      _timer = setInterval(function () {
        flush().catch(function () {});
      }, POLL_INTERVAL_MS);

      /* Eventos */
      if (typeof window !== 'undefined') {
        window.addEventListener('online', function () { flush().catch(function () {}); });
        window.addEventListener('focus',  function () { flush().catch(function () {}); });
      }
    }

    function stop() {
      _started = false;
      if (_timer) { clearInterval(_timer); _timer = null; }
    }

    /* ── v6.6: diagnóstico e recuperação da fila ─────────────────
       Antes, uma operação que esgotava as tentativas virava erro
       permanente e ficava na fila para sempre. O usuário via
       "⚠ 1 falha no envio" indefinidamente, sem poder ver o que era,
       tentar de novo ou descartar.

       Alerta sem ação é ruído — e ensina o usuário a ignorar avisos,
       inclusive os importantes. */
    function errors() {
      if (!LocalDB.isSupported()) return Promise.resolve([]);
      return LocalDB.list('syncQueue', { limit: 1000 })
        .then(function (ops) {
          return ops.filter(function (o) { return o.status === 'error'; })
            .map(function (o) {
              return {
                id:         o._opId,
                tipo:       o.type || o.method || '?',
                tabela:     o.table || '?',
                motivo:     o.lastError || 'desconhecido',
                tentativas: o.attempts || 0,
                quando:     o.createdAt ? new Date(o.createdAt).toISOString() : null,
                /* resumo do que se perderia ao descartar */
                resumo:     (o.payload && (o.payload.client_name || o.payload.nome ||
                              o.payload.titulo)) || null,
              };
            });
        }).catch(function () { return []; });
    }

    /* Devolve as falhas para a fila. Serve quando a causa era
       temporária (rede caiu, servidor fora) ou já foi corrigida. */
    function retryErrors() {
      return errors().then(function (lista) {
        return Promise.all(lista.map(function (e) {
          return LocalDB.markOp(e.id, 'pending', { attempts: 0, lastError: null })
            .catch(function () { return null; });
        })).then(function () { return lista.length; });
      });
    }

    /* Descarta em definitivo. Só faz sentido quando a operação não é
       mais válida — por exemplo, um registro já recriado à mão. */
    function discardErrors() {
      return errors().then(function (lista) {
        return Promise.all(lista.map(function (e) {
          return LocalDB.deleteOp(e.id).catch(function () { return null; });
        })).then(function () { return lista.length; });
      });
    }


    function status() {
      if (!LocalDB.isSupported()) {
        return Promise.resolve({ online: _isOnline(), pending: 0, errors: 0, running: false, supported: false });
      }
      return Promise.all([
        LocalDB.list('syncQueue', { limit: 1000 }),
      ]).then(function (results) {
        var ops = results[0] || [];
        var pending = ops.filter(function (o) { return o.status === 'pending'; });
        var error   = ops.filter(function (o) { return o.status === 'error'; });
        return {
          online:    _isOnline(),
          pending:   pending.length,
          errors:    error.length,
          running:   _running,
          supported: true,
        };
      }).catch(function () {
        return { online: _isOnline(), pending: 0, errors: 0, running: false, supported: false };
      });
    }

    return {
      start:  start,
      stop:   stop,
      flush:  flush,
      status: status,
      on:     on,
      /* v6.6: diagnóstico e recuperação de falhas */
      errors:        errors,
      retryErrors:   retryErrors,
      discardErrors: discardErrors,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     RATE LIMIT (NOVO em v4.1)
     ─────────────────────────────────────────────────────────────
     Limita tentativas dentro de janela de tempo, persistido em
     sessionStorage para sobreviver a reload mas zerar com aba
     fechada. Inspirado em FR.Security.AntiTamper.

     Uso típico:
       var allowed = FIELDO.RateLimit.check('activation');
       if (!allowed.ok) return alert(allowed.message);
       // ...tenta operação...
       FIELDO.RateLimit.record('activation');

     Configuração por chave (default: 5 / 10 min):
       FIELDO.RateLimit.config('activation', { max: 3, windowMs: 60000 });
  ════════════════════════════════════════════════════════════ */
  var RateLimit = (function () {

    var DEFAULTS = { max: 5, windowMs: 10 * 60 * 1000 };
    var _configs = {}; /* key → {max, windowMs} */
    var _SS_PREFIX = '_fieldo_rl_';

    function _conf(key) {
      return _configs[key] || DEFAULTS;
    }

    function _load(key) {
      try {
        var raw = sessionStorage.getItem(_SS_PREFIX + key);
        return raw ? JSON.parse(raw) : { count: 0, windowStart: Date.now() };
      } catch (e) {
        return { count: 0, windowStart: Date.now() };
      }
    }

    function _save(key, state) {
      try { sessionStorage.setItem(_SS_PREFIX + key, JSON.stringify(state)); }
      catch (e) {}
    }

    function _formatWait(ms) {
      var min = Math.ceil(ms / 60000);
      return min <= 1 ? '1 minuto' : (min + ' minutos');
    }

    /* Configura limites para uma chave. Chamar uma vez no boot. */
    function config(key, opts) {
      _configs[key] = {
        max:       (opts && typeof opts.max === 'number')      ? opts.max      : DEFAULTS.max,
        windowMs:  (opts && typeof opts.windowMs === 'number') ? opts.windowMs : DEFAULTS.windowMs,
      };
    }

    /* Verifica se ainda há tentativas disponíveis.
       Retorna { ok, remaining, retryInMs?, message? } */
    function check(key) {
      var c = _conf(key);
      var state = _load(key);
      var now = Date.now();

      /* Janela expirou — reset */
      if (now - state.windowStart > c.windowMs) {
        state = { count: 0, windowStart: now };
        _save(key, state);
      }

      if (state.count >= c.max) {
        var retryInMs = (state.windowStart + c.windowMs) - now;
        return {
          ok:        false,
          remaining: 0,
          retryInMs: retryInMs,
          message:   'Muitas tentativas. Aguarde ' + _formatWait(retryInMs) + ' e tente novamente.',
        };
      }

      return {
        ok:        true,
        remaining: c.max - state.count,
      };
    }

    /* Registra uma tentativa. Chamar APÓS a operação (sucesso ou falha). */
    function record(key) {
      var state = _load(key);
      var c = _conf(key);
      var now = Date.now();

      if (now - state.windowStart > c.windowMs) {
        state = { count: 0, windowStart: now };
      }

      state.count++;
      _save(key, state);
      return state.count;
    }

    /* Reset manual (após sucesso, para zerar contador) */
    function reset(key) {
      try { sessionStorage.removeItem(_SS_PREFIX + key); } catch (e) {}
    }

    return {
      config: config,
      check:  check,
      record: record,
      reset:  reset,
    };
  })();

  /* Pré-configura limite de ativação Pro: 5 tentativas / 10 min */
  RateLimit.config('activation', { max: 5, windowMs: 10 * 60 * 1000 });

  /* ════════════════════════════════════════════════════════════
     LICENSE — validação Pro via token HMAC client-side
     v4.0 — modelo FadReview: token assinado pelo admin, validado offline.

     Fluxo:
       1. Admin gera token via Edge Function license-issue (x-admin-key)
       2. Token = base64(payload) + "." + HMAC-SHA256(payload).slice(0,20)
       3. Admin manda pro cliente via WhatsApp
       4. Cliente cola em ativar.html → verifySignature → saveActivation
       5. Pro liberado offline até a data exp do payload
  ════════════════════════════════════════════════════════════ */
  var License = (function () {

    /* ── v5.0: NÃO existe mais segredo aqui. ──────────────────
       A v4 remontava o HMAC em runtime a partir de chunks Base64.
       Ofuscação não é criptografia: o segredo estava publicado.

       Agora o token vai para a Edge Function /license, que valida
       com o segredo do servidor e grava plan='pro' no banco. O que
       fica no cliente é só um CACHE de UX — se alguém adulterar,
       o app pinta um badge dourado e mais nada: as policies de
       Contratos consultam is_pro() no Postgres. */

    var STORAGE_KEY = 'fieldo_license_cache';

    function _cache()      { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; } }
    function _saveCache(o) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); } catch (e) {} }
    function clearActivation() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }

    function daysLeft(exp) {
      if (!exp) return null;
      return Math.ceil((new Date(exp + 'T23:59:59') - new Date()) / 86400000);
    }

    /* Status offline-first: responde do perfil em cache (que veio do
       servidor), sem exigir rede. */
    function getStatus() {
      var prof = LS.get('session_data');
      var c    = _cache();
      var plan = (prof && prof.plan) || (c && c.plan) || 'free';
      var exp  = (prof && prof.plan_expires_at ? String(prof.plan_expires_at).slice(0, 10) : null)
                 || (c && c.expires) || null;

      if (plan !== 'pro') return Promise.resolve({ active: false, reason: 'no_token' });

      var dl = daysLeft(exp);
      if (exp && dl <= 0) return Promise.resolve({ active: false, reason: 'expired', daysLeft: dl });
      return Promise.resolve({ active: true, daysLeft: dl, payload: { p: 'pro', exp: exp } });
    }

    /* Ativação: sempre online. É uma operação rara e precisa do
       servidor — não faz sentido tentar resolver offline. */
    function activate(token) {
      if (!token || !String(token).trim()) {
        return Promise.resolve({ ok: false, error: 'empty_token' });
      }
      return Session.getAccessToken().then(function (jwt) {
        if (!jwt) return { ok: false, error: 'unauthenticated' };
        return fetch(EDGE_URL + '/license', {
          method: 'POST',
          headers: {
            'apikey':        ANON_KEY,
            'Authorization': 'Bearer ' + jwt,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ token: String(token).trim() }),
        }).then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (res) {
            if (!res.ok) return { ok: false, error: res.error || 'invalid' };
            /* v5.2: chave é de uso único por conta. 'ja_usada' significa que
               ela foi resgatada por OUTRA conta — normalmente repasse. */
            _saveCache({ plan: 'pro', expires: res.expires, at: Date.now() });
            /* Invalida o perfil em cache: o plano mudou no servidor */
            _profData = null;
            LS.remove('session_data');
            return { ok: true, payload: { p: 'pro', exp: res.expires, u: res.name },
                     daysLeft: daysLeft(res.expires) };
          });
      }).catch(function () {
        return { ok: false, error: 'network' };
      });
    }

    return {
      getStatus:         getStatus,
      activate:          activate,
      clearActivation:   clearActivation,
      /* compat v4 — sem segredo, decode é meramente informativo */
      decode: function (token) {
        try { return JSON.parse(atob(String(token).split('.')[0].replace(/-/g,'+').replace(/_/g,'/'))); }
        catch (e) { return null; }
      },
      daysLeft: daysLeft,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     VALIDATOR (NOVO em v4.1)
     ─────────────────────────────────────────────────────────────
     Estados tipados de licença com mensagens prontas para UI.
     Inspirado em FR.Security.Validator.

     Estados:
       VALID         — licença OK
       UNLICENSED    — sem token salvo
       EXPIRED       — token salvo mas exp passou
       INVALID       — token corrompido ou assinatura errada
       RATE_LIMITED  — muitas tentativas de ativação

     Uso:
       FIELDO.Validator.validate().then(function (r) {
         if (r.status === 'VALID') showPro(r.daysLeft);
         else if (r.status === 'EXPIRED') showRenew(r.message);
         else showActivate(r.message);
       });

       FIELDO.Validator.activate(token).then(function (r) {
         if (r.status === 'VALID') celebrate();
         else showError(r.message); // já vem traduzido
       });
  ════════════════════════════════════════════════════════════ */
  var Validator = (function () {

    var STATUS = {
      VALID:        'VALID',
      UNLICENSED:   'UNLICENSED',
      EXPIRED:      'EXPIRED',
      INVALID:      'INVALID',
      RATE_LIMITED: 'RATE_LIMITED',
    };

    var MESSAGES = {
      VALID:        null,
      UNLICENSED:   'Cole sua chave Pro para continuar.',
      EXPIRED:      'Sua licença expirou. Renove para continuar usando o Pro.',
      INVALID:      'Chave inválida. Verifique e tente novamente.',
      RATE_LIMITED: 'Muitas tentativas. Aguarde alguns minutos.',
    };

    function _result(status, payload, daysLeft, customMessage) {
      return {
        valid:    status === STATUS.VALID,
        status:   status,
        payload:  payload || null,
        daysLeft: (daysLeft === undefined ? null : daysLeft),
        message:  customMessage || MESSAGES[status],
      };
    }

    /* Valida o estado atual (sem tentar ativar nada) */
    function validate() {
      return License.getStatus().then(function (s) {
        if (s.active) return _result(STATUS.VALID, s.payload, s.daysLeft);
        if (s.reason === 'no_token')      return _result(STATUS.UNLICENSED);
        if (s.reason === 'expired')       return _result(STATUS.EXPIRED, s.payload, s.daysLeft);
        if (s.reason === 'unauthenticated') return _result(STATUS.INVALID);
        if (s.reason === 'network')         return _result(STATUS.INVALID, null, null,
          'Sem conexão. A ativação do Pro precisa de internet uma vez.');
        return _result(STATUS.INVALID);
      }).catch(function () {
        return _result(STATUS.INVALID);
      });
    }

    /* Ativa um token aplicando rate limit */
    function activate(token) {
      var rl = RateLimit.check('activation');
      if (!rl.ok) {
        return Promise.resolve(_result(STATUS.RATE_LIMITED, null, null, rl.message));
      }

      return License.activate(token).then(function (r) {
        RateLimit.record('activation');
        if (r.ok) {
          RateLimit.reset('activation'); /* sucesso zera contador */
          return _result(STATUS.VALID, r.payload, r.daysLeft);
        }
        if (r.error === 'ja_usada')    return _result(STATUS.INVALID, null, null,
          'Esta chave já foi ativada em outra conta. Cada chave vale para um profissional. Fale com quem vendeu.');
        if (r.error === 'expired')     return _result(STATUS.EXPIRED, r.payload, r.daysLeft);
        if (r.error === 'empty_token') return _result(STATUS.UNLICENSED);
        if (r.error === 'network')     return _result(STATUS.INVALID, null, null,
          'Sem conexão. A ativação do Pro precisa de internet uma vez.');
        return _result(STATUS.INVALID);
      }).catch(function () {
        RateLimit.record('activation');
        return _result(STATUS.INVALID);
      });
    }

    return {
      STATUS:   STATUS,
      MESSAGES: MESSAGES,
      validate: validate,
      activate: activate,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     PRO — wrapper de compat sobre License + Validator
     Mantém a mesma interface das versões anteriores para não quebrar
     páginas existentes (index.html, contratos.html, ativar.html).
  ════════════════════════════════════════════════════════════ */
  var Pro = (function () {
    var _cache = null;

    function check(force) {
      if (!force && _cache && (Date.now() - _cache.checked_at < 60000)) {
        return Promise.resolve(_cache.active);
      }
      return License.getStatus().then(function (status) {
        _cache = {
          active:     status.active,
          payload:    status.payload,
          daysLeft:   status.daysLeft,
          checked_at: Date.now(),
        };
        return status.active;
      });
    }

    function activate(code) {
      return License.activate(code).then(function (result) {
        if (result.ok) {
          _cache = {
            active:     true,
            payload:    result.payload,
            daysLeft:   result.daysLeft,
            checked_at: Date.now(),
          };
          return {
            ok:             true,
            already_active: false,
            expires_at:     result.payload && result.payload.exp,
          };
        }
        /* Mapeia erros de License para o formato esperado pela ativar.html */
        var errMap = {
          empty_token:    'empty_code',
          invalid_format: 'invalid_code',
          bad_signature:  'invalid_code',
          expired:        'expired_code',
        };
        return { ok: false, error: errMap[result.error] || 'invalid_code' };
      });
    }

    function details() {
      return License.getStatus().then(function (status) {
        if (!status.active) return null;
        return {
          activated_at: null, /* v5.0: data de ativação vive no servidor */
          expires_at:   status.payload && status.payload.exp,
          plan:         status.payload && status.payload.p,
          user_name:    status.payload && status.payload.u,
          days_left:    status.daysLeft,
        };
      });
    }

    function clearCache() { _cache = null; }

    /* Admin: stubs vazios. O painel admin agora é standalone (não usa RPCs).
       codes.html foi removido na v5.0: continha o segredo HMAC no cliente. */
    var Admin = {
      generateCode:   function () { return Promise.reject(new Error('Emissao movida para a Edge Function license-issue')); },
      listCodes:      function () { return Promise.resolve([]); },
      listProUsers:   function () { return Promise.resolve([]); },
      revokeAccess:   function () { return Promise.reject(new Error('Revogação não suportada no modelo HMAC v4')); },
      deactivateCode: function () { return Promise.reject(new Error('Desativação não suportada no modelo HMAC v4')); },
    };

    return {
      check:      check,
      activate:   activate,
      details:    details,
      clearCache: clearCache,
      Admin:      Admin,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     AUTH EMAIL — DEPRECATED em v4.0
     OTP por email exigia configuração no Supabase Dashboard que se mostrou
     frágil (templates, redirect URLs, rate limits). Mantido como stub para
     páginas que ainda referenciam — todos os métodos retornam falso/null.
     Login agora é apenas por OTP de WhatsApp (FIELDO.Auth).
  ════════════════════════════════════════════════════════════ */
  var AuthEmail = {
    isLoggedIn:         function () { return false; },
    sendOtp:            function () { return Promise.reject(new Error('Email auth desativado em v4.0')); },
    verifyOtp:          function () { return Promise.reject(new Error('Email auth desativado em v4.0')); },
    sendMagicLink:      function () { return Promise.reject(new Error('Email auth desativado em v4.0')); },
    handleAuthCallback: function () { return Promise.resolve(null); },
    getUser:            function () { return Promise.resolve(null); },
    refreshSession:     function () { return Promise.resolve(null); },
    logout:             function () { return Promise.resolve(); },
    _getAccessToken:    function () { return null; },
    _getSession:        function () { return null; },
  };

  /* ════════════════════════════════════════════════════════════
     HAMBURGER MENU
  ════════════════════════════════════════════════════════════ */
  var HBG = (function () {
    var _open = false;

    function _els() {
      return {
        btn:     document.getElementById('menuBtn'),
        drawer:  document.getElementById('menuDrawer'),
        overlay: document.getElementById('menuOverlay'),
      };
    }

    function open() {
      _open = true;
      var e = _els();
      if (e.btn)     { e.btn.classList.add('is-open'); e.btn.setAttribute('aria-expanded', 'true'); }
      if (e.drawer)  { e.drawer.classList.add('is-open'); e.drawer.setAttribute('aria-hidden', 'false'); }
      if (e.overlay) e.overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      _open = false;
      var e = _els();
      if (e.btn)     { e.btn.classList.remove('is-open'); e.btn.setAttribute('aria-expanded', 'false'); }
      if (e.drawer)  { e.drawer.classList.remove('is-open'); e.drawer.setAttribute('aria-hidden', 'true'); }
      if (e.overlay) e.overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    function toggle() { _open ? close() : open(); }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && _open) close();
    });

    return { open: open, close: close, toggle: toggle, isOpen: function(){ return _open; } };
  })();

  /* ════════════════════════════════════════════════════════════
     NAV — menu compartilhado em todas as páginas autenticadas
  ════════════════════════════════════════════════════════════ */
  var Nav = {
    mount: function (activeKey) {
      activeKey = activeKey || '';
      if (document.getElementById('menuDrawer')) return;

      var items = [
        { key: 'dashboard', href: 'index.html',     label: 'Dashboard',    icon: 'dashboard' },
        { key: 'servico',   href: 'servico.html',   label: 'Novo serviço', icon: 'bolt' },
        { key: 'orcamento', href: 'orcamento.html', label: 'Orçamentos',   icon: 'doc' },
        { key: 'contratos', href: 'contratos.html', label: 'Contratos',    icon: 'check', requiresPro: true },
        { key: 'busca',     href: 'busca.html',     label: 'Pesquisa',     icon: 'search' },
        { key: 'explorar',  href: 'explorar.html',  label: 'Explorar',     icon: 'compass' },
      ];

      var icons = {
        dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
        bolt:      '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        doc:       '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        check:     '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
        search:    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
        compass:   '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
        user:      '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        logout:    '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
      };

      function svgFor(name) {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' + (icons[name] || '') + '</svg>';
      }

      /* Filtra itens Pro de acordo com o entitlement do usuário.
         Como Pro.check é assíncrono e retorna cache, não bloqueamos o render:
         monta primeiro sem itens-Pro, depois injeta se aplicável. */
      function buildItemsHtml(includePro) {
        return items
          .filter(function (it) { return !it.requiresPro || includePro; })
          .map(function (it) {
            var active = it.key === activeKey ? ' active' : '';
            var aria   = it.key === activeKey ? ' aria-current="page"' : '';
            return '<a href="' + it.href + '" class="menu-nav-item' + active + '"' + aria + '>' +
                     '<span class="menu-nav-icon">' + svgFor(it.icon) + '</span>' +
                     '<span class="menu-nav-label">' + it.label + '</span>' +
                   '</a>';
          }).join('');
      }

      /* Render inicial: assume sem Pro (mais conservador). Atualiza depois. */
      var navItems = buildItemsHtml(false);

      var html =
        '<div class="menu-overlay" id="menuOverlay" onclick="FIELDO.HBG.close()" aria-hidden="true"></div>' +
        '<aside class="menu-drawer" id="menuDrawer" aria-hidden="true" aria-label="Menu de navegação">' +
          '<div class="menu-section-lbl">Navegação</div>' +
          '<nav class="menu-nav" aria-label="Navegação principal">' +
            navItems +
            '<button class="menu-nav-item" onclick="FIELDO.HBG.close();if(window.abrirPerfil)abrirPerfil();else window.location.href=\'index.html\'" aria-label="Abrir perfil">' +
              '<span class="menu-nav-icon">' + svgFor('user') + '</span>' +
              '<span class="menu-nav-label">Perfil</span>' +
            '</button>' +
            '<button class="menu-nav-item" onclick="FIELDO.Nav.confirmLogout()" aria-label="Sair da conta">' +
              '<span class="menu-nav-icon">' + svgFor('logout') + '</span>' +
              '<span class="menu-nav-label">Sair</span>' +
            '</button>' +
          '</nav>' +
        '</aside>';

      var container = document.createElement('div');
      container.innerHTML = html;
      while (container.firstChild) document.body.appendChild(container.firstChild);

      /* Após mount, checa Pro e re-renderiza se necessário */
      if (Pro && AuthEmail && AuthEmail.isLoggedIn()) {
        Pro.check().then(function (isPro) {
          if (!isPro) return;
          var nav = document.querySelector('#menuDrawer .menu-nav');
          if (!nav) return;
          var newNavItems = buildItemsHtml(true);
          /* Substitui os links de navegação preservando os botões finais (perfil/logout) */
          var firstButton = nav.querySelector('button');
          if (firstButton) {
            /* remove os <a> antigos */
            Array.from(nav.querySelectorAll('a.menu-nav-item')).forEach(function (a) { nav.removeChild(a); });
            /* insere os novos antes do primeiro botão */
            var tmp = document.createElement('div');
            tmp.innerHTML = newNavItems;
            while (tmp.firstChild) nav.insertBefore(tmp.firstChild, firstButton);
          }
        });
      }
    },

    confirmLogout: function () {
      if (window.confirm('Deseja sair da sua conta?')) {
        /* Faz logout em ambas as camadas (telefone + email) */
        if (AuthEmail && AuthEmail.isLoggedIn()) {
          AuthEmail.logout();
        }
        Auth.logout();
        if (Pro) Pro.clearCache();
        window.location.href = 'entrar.html';
      }
    },
  };

  /* ════════════════════════════════════════════════════════════
     NICHES (NOVO em v4.3) — categorias de serviço (default + custom)
     ─────────────────────────────────────────────────────────────
     8 nichos default sempre presentes.
     Pro pode adicionar até MAX_CUSTOM nichos customizados:
       { key: 'jardinagem', label: 'Jardinagem', emoji: '🌱' }
     Persistido em localStorage (não exige column no banco).

     Free  → list() retorna apenas defaults
     Pro   → list() retorna defaults + customizados
     emoji() / label() funcionam pra qualquer key (default ou custom)
  ════════════════════════════════════════════════════════════ */
  var Niches = (function () {
    var MAX_CUSTOM = 12;

    var DEFAULTS = [
      { key: 'eletrica',        label: 'Elétrica',    emoji: '⚡',  _default: true },
      { key: 'hidraulica',      label: 'Hidráulica',  emoji: '🔧', _default: true },
      { key: 'pintura',         label: 'Pintura',     emoji: '🎨', _default: true },
      { key: 'ar-condicionado', label: 'Ar-cond.',    emoji: '❄️', _default: true },
      { key: 'alvenaria',       label: 'Alvenaria',   emoji: '🧱', _default: true },
      { key: 'informatica',     label: 'Informática', emoji: '💻', _default: true },
      { key: 'serralheria',     label: 'Serralheria', emoji: '🔩', _default: true },
      { key: 'outro',           label: 'Outro',       emoji: '⚙️', _default: true },
    ];

    function _readCustom() {
      var raw = LS.get('niches_custom');
      return Array.isArray(raw) ? raw : [];
    }
    function _writeCustom(list) { LS.set('niches_custom', list); }

    function _slug(label) {
      return String(label || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    /* Lista nichos: defaults + customizados (todos sempre visíveis pra
       não quebrar relatórios antigos; gating de criação fica no UsageGuard). */
    function list(opts) {
      opts = opts || {};
      if (opts.defaultsOnly) return DEFAULTS.slice();
      return DEFAULTS.concat(_readCustom());
    }

    function find(key) {
      var all = list();
      for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
      return null;
    }

    function emoji(key) {
      var hit = find(key);
      return hit ? hit.emoji : '🔧';
    }

    function label(key) {
      var hit = find(key);
      return hit ? hit.label : (key || '');
    }

    /* Adiciona nicho custom. Retorna {ok, niche?, error?}.
       NOTA: gating Pro deve ser feito pelo chamador via UsageGuard. */
    function add(input) {
      var lbl = String(input && input.label || '').trim();
      if (!lbl)            return { ok: false, error: 'empty_label' };
      if (lbl.length > 22) return { ok: false, error: 'too_long' };

      var key = String(input && input.key || _slug(lbl));
      if (!key) return { ok: false, error: 'empty_label' };

      var emo = String(input && input.emoji || '🔧').slice(0, 4);

      var custom = _readCustom();
      var taken  = list().some(function (n) { return n.key === key; });
      if (taken)                       return { ok: false, error: 'duplicate' };
      if (custom.length >= MAX_CUSTOM) return { ok: false, error: 'limit' };

      var niche = { key: key, label: lbl, emoji: emo };
      custom.push(niche);
      _writeCustom(custom);
      return { ok: true, niche: niche };
    }

    function remove(key) {
      _writeCustom(_readCustom().filter(function (n) { return n.key !== key; }));
    }

    function isCustom(key) {
      return _readCustom().some(function (n) { return n.key === key; });
    }

    function reset() { LS.remove('niches_custom'); }

    return {
      DEFAULTS:   DEFAULTS,
      MAX_CUSTOM: MAX_CUSTOM,
      list:       list,
      find:       find,
      emoji:      emoji,
      label:      label,
      add:        add,
      remove:     remove,
      isCustom:   isCustom,
      reset:      reset,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     THEMES (NOVO em v4.3) — paletas alternativas (Pro)
     ─────────────────────────────────────────────────────────────
     Aplica via attribute `data-theme="X"` no <html>.
     CSS define overrides por seletor `[data-theme="midnight"]`.

     Free → 'paper' (default)
     Pro  → todas

     Boot aplica o tema persistido ANTES do paint (auto-IIFE no
     fim do arquivo) pra evitar flash. Se o usuário perder Pro,
     o tema volta pra 'paper' silenciosamente na próxima leitura.
  ════════════════════════════════════════════════════════════ */
  var Themes = (function () {
    var THEMES = [
      { key: 'paper',    label: 'Pergaminho', swatch: '#f0ece3', proOnly: false },
      { key: 'midnight', label: 'Midnight',   swatch: '#0e0e14', proOnly: true  },
      { key: 'sage',     label: 'Sage',       swatch: '#dfe6dc', proOnly: true  },
      { key: 'ember',    label: 'Ember',      swatch: '#f4e2d0', proOnly: true  },
    ];

    function list() { return THEMES.slice(); }

    function meta(key) {
      for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === key) return THEMES[i];
      return null;
    }

    function current() {
      var v = LS.get('theme');
      return v && meta(v) ? v : 'paper';
    }

    /* Aplica visualmente (sem persistir, sem checar Pro).
       Retorna o key efetivamente aplicado. */
    function apply(key) {
      key = key || 'paper';
      if (typeof document === 'undefined') return key;
      var el = document.documentElement;
      if (key === 'paper') el.removeAttribute('data-theme');
      else                 el.setAttribute('data-theme', key);
      return key;
    }

    /* Define + persiste. Bloqueia themes proOnly se !pro.
       Retorna Promise<{ok, key?, error?}>. */
    function set(key) {
      var m = meta(key);
      if (!m) return Promise.resolve({ ok: false, error: 'unknown' });
      if (!m.proOnly) {
        LS.set('theme', key);
        apply(key);
        return Promise.resolve({ ok: true, key: key });
      }
      return Pro.check().then(function (isPro) {
        if (!isPro) return { ok: false, error: 'pro_required' };
        LS.set('theme', key);
        apply(key);
        return { ok: true, key: key };
      });
    }

    /* Boot — aplica o salvo antes do paint. Em caso de Pro perdido
       e tema proOnly salvo, volta pra paper sem aviso. */
    function boot() {
      var saved = LS.get('theme');
      if (!saved || !meta(saved)) return apply('paper');
      var m = meta(saved);
      if (!m.proOnly) return apply(saved);
      /* Aplica otimisticamente (evita flash) e revalida assíncrono. */
      apply(saved);
      Pro.check().then(function (isPro) {
        if (!isPro) { LS.remove('theme'); apply('paper'); }
      }).catch(function () {});
      return saved;
    }

    return {
      THEMES:  THEMES,
      list:    list,
      meta:    meta,
      current: current,
      apply:   apply,
      set:     set,
      boot:    boot,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     PHOTOS (NOVO em v4.3) — pipeline captura/resize/upload
     ─────────────────────────────────────────────────────────────
     Resize client-side (max 1600px lado maior, JPEG q .82) ANTES
     de qualquer upload — economiza banda e storage do Supabase.

     Uso típico em servico.html:
       FIELDO.Photos.add(file).then(function (p) {
         _fotos.push(p);     // p = { dataURL, blob, w, h, bytes }
         renderFotos();
       });

       // ao gerar relatório (com reportId já em mãos):
       FIELDO.Photos.upload(_fotos, { reportId: rep.id })
         .then(function (urls) { ... });

     add()    → resize, retorna {dataURL, blob, w, h, bytes}
     stage()  → opcional: persiste no IDB pra sobreviver fechar aba
     upload() → POST de cada blob pro storage; falha → IDB pra retry
     quota()  → { limit, plan } baseado em Pro
  ════════════════════════════════════════════════════════════ */
  var Photos = (function () {
    var MAX_DIM    = 1600;
    var JPEG_Q     = 0.82;
    var MAX_BYTES  = 8 * 1024 * 1024;
    /* v5.8.1: era 'reports' — bucket que NÃO existe. Os buckets criados
       na migração são 'avatars' e 'photos'. Todo upload retornaria 404,
       silenciosamente, porque ninguém chamava esta função. */
    var BUCKET     = 'photos';
    var FREE_LIMIT = 5;
    var PRO_LIMIT  = 20;

    function _readFile(file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload  = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error || new Error('Falha ao ler arquivo')); };
        fr.readAsDataURL(file);
      });
    }

    function _loadImage(dataURL) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload  = function () { resolve(img); };
        img.onerror = function () { reject(new Error('Imagem inválida')); };
        img.src = dataURL;
      });
    }

    function _resize(img) {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, MAX_DIM / Math.max(w, h));
      var tw = Math.round(w * scale);
      var th = Math.round(h * scale);
      var canvas = document.createElement('canvas');
      canvas.width  = tw;
      canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, tw, th);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('Resize falhou'));
          var reader = new FileReader();
          reader.onload  = function () {
            resolve({
              _localId: LocalDB._uuid(),
              dataURL:  reader.result,
              blob:     blob,
              w:        tw,
              h:        th,
              bytes:    blob.size,
            });
          };
          reader.onerror = function () { reject(reader.error); };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', JPEG_Q);
      });
    }

    /* Pipeline completo: file → resized photo object */
    function add(file) {
      if (!file) return Promise.reject(new Error('Arquivo vazio'));
      if (!/^image\//.test(file.type || '')) return Promise.reject(new Error('Apenas imagens'));
      if (file.size > MAX_BYTES) return Promise.reject(new Error('Imagem maior que 8MB'));
      return _readFile(file).then(_loadImage).then(_resize);
    }

    /* Quanto pode subir? */
    function quota() {
      return Pro.check().then(function (isPro) {
        return {
          limit:    isPro ? PRO_LIMIT : FREE_LIMIT,
          plan:     isPro ? 'pro' : 'free',
          isPro:    isPro,
        };
      });
    }

    /* Path: {profId}/{reportId}/{idx}.jpg dentro do bucket */
    function _uploadOne(blob, profId, reportId, idx) {
      var path = profId + '/' + reportId + '/' + idx + '.jpg';
      return Session.getAccessToken().then(function (token) {
      return fetch(STORAGE_URL + '/' + BUCKET + '/' + path, {
        method:  'PUT',
        headers: {
          'apikey':        ANON_KEY,
          'Authorization': 'Bearer ' + (token || ANON_KEY),
          'Content-Type':  'image/jpeg',
          'x-upsert':      'true',
        },
        body: blob,
      }).then(function (r) {
        if (!r.ok) throw new Error('upload_failed_' + r.status);
        return SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + path;
      });
      });
    }

    /* Sobe array de fotos. Retorna [url|null, ...] (null = pendente).
       Falhas são persistidas no IDB pra retry posterior pelo SyncEngine
       (até a v4.3 a engine só retoma rows tabelares — fotos ficam staged
       até a próxima sessão online quando o usuário re-tentar). */
    function upload(photos, opts) {
      opts = opts || {};
      var profId   = Auth.getId();
      var reportId = opts.reportId || 'temp';
      if (!profId) return Promise.reject(new Error('Não autenticado'));
      if (!photos || !photos.length) return Promise.resolve([]);

      var jobs = photos.map(function (p, i) {
        if (!p || !p.blob) return Promise.resolve(null);
        return _uploadOne(p.blob, profId, reportId, i)
          .then(function (url) {
            /* Sucesso — limpa do staging se estiver lá */
            if (LocalDB.isSupported() && p._localId) {
              LocalDB['delete']('photos', p._localId).catch(function () {});
            }
            return url;
          })
          .catch(function () {
            /* Stage pra retry posterior */
            if (LocalDB.isSupported() && p._localId) {
              LocalDB.put('photos', {
                _localId:  p._localId,
                reportId:  reportId,
                index:     i,
                dataURL:   p.dataURL,
              }).catch(function () {});
            }
            return null;
          });
      });
      return Promise.all(jobs);
    }

    /* Persiste fotos no IDB SEM tentar upload. Usado pelo Draft pra
       sobreviver a fechar a aba antes de gerar o relatório. */
    function stage(photos, reportLocalId) {
      if (!LocalDB.isSupported() || !photos) return Promise.resolve([]);
      var jobs = photos.map(function (p, i) {
        return LocalDB.put('photos', {
          _localId:      p._localId || LocalDB._uuid(),
          reportLocalId: reportLocalId,
          index:         i,
          dataURL:       p.dataURL,
        }).catch(function () { return null; });
      });
      return Promise.all(jobs);
    }

    return {
      MAX_DIM:    MAX_DIM,
      FREE_LIMIT: FREE_LIMIT,
      PRO_LIMIT:  PRO_LIMIT,
      add:        add,
      upload:     upload,
      stage:      stage,
      quota:      quota,
    };
  })();

  /* ════════════════════════════════════════════════════════════
     UPGRADE UI (NOVO em v4.3) — modal de upgrade reutilizável
     ─────────────────────────────────────────────────────────────
     UpgradeUI.show({ reason, action, onClose })

       reason  → 'quota_exceeded' | 'pro_required' | 'expired'
       action  → 'create_report' | 'access_contratos' | 'use_themes'
                 | 'use_custom_niches' | 'photos_above_5' | 'generic'

     Renderiza overlay full-screen com hero, 3 features-chave do Pro,
     CTA primário (ativar.html) e CTA secundário (WhatsApp).

     Estilos são injetados sob demanda (uma vez) — não polui fieldo.css.
  ════════════════════════════════════════════════════════════ */
  var UpgradeUI = (function () {
    /* v7.0: número real do responsável pelo produto. Era um placeholder
       (5511999999999) — quem batesse no limite abriria uma conversa com
       um número inexistente e simplesmente desistiria. */
    var WPP = '5512988406425';

    var REASONS = {
      pro_required: {
        title: 'Recurso <em>Pro</em>',
        sub:   'Esse recurso faz parte do plano Pro do Fieldo.',
      },
      quota_exceeded: {
        title: 'Limite do plano <em>atingido</em>',
        sub:   'Você usou tudo do mês no plano grátis. Faça upgrade pra continuar.',
      },
      expired: {
        title: 'Sua licença <em>expirou</em>',
        sub:   'Renove para voltar a usar os recursos Pro.',
      },
      generic: {
        title: 'Desbloquear <em>Fieldo Pro</em>',
        sub:   'Mais relatórios, contratos, temas e nichos personalizados.',
      },
    };

    var ACTION_FEATURES = {
      create_report: [
        'Relatórios ilimitados (sem limite mensal)',
        'Até 20 fotos por relatório (vs 5)',
        'Contratos, diárias e empreitadas',
      ],
      access_contratos: [
        'Empreiteiros e empreitadas ilimitados',
        'Diárias, empreitadas e extras por obra',
        'Cálculo automático de saldo em tempo real',
      ],
      use_themes: [
        'Temas alternativos (Midnight, Sage, Ember)',
        'Nichos personalizados (até 12)',
        'Identidade visual sob medida',
      ],
      use_custom_niches: [
        'Adicione até 12 nichos personalizados',
        'Emojis customizados por categoria',
        'Sem limite mensal de relatórios',
      ],
      photos_above_5: [
        'Até 20 fotos por relatório (vs 5)',
        'Relatórios ilimitados',
        'Resize automático e backup',
      ],
      generic: [
        'Relatórios ilimitados',
        'Módulo Contratos completo',
        'Temas e nichos personalizados',
      ],
    };

    function _styles() {
      return ''+
'.fd-upg-ov{position:fixed;inset:0;z-index:900;background:rgba(14,14,20,.78);'+
  'backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);'+
  'display:flex;align-items:flex-end;justify-content:center;padding:0;animation:fdUpgIn .25s ease}'+
'@media(min-width:560px){.fd-upg-ov{align-items:center;padding:1.25rem}}'+
'@keyframes fdUpgIn{from{opacity:0}to{opacity:1}}'+
'@keyframes fdUpgUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}'+
'.fd-upg-box{background:var(--paper);border:1px solid var(--border2);'+
  'border-radius:18px 18px 0 0;width:100%;max-width:460px;max-height:92dvh;overflow-y:auto;'+
  'animation:fdUpgUp .3s var(--ez);position:relative}'+
'@media(min-width:560px){.fd-upg-box{border-radius:18px}}'+
'.fd-upg-close{position:absolute;top:.65rem;right:.85rem;width:32px;height:32px;'+
  'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:50%;'+
  'display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;'+
  'font-size:1.05rem;line-height:1;z-index:2;transition:background .2s;font-family:inherit}'+
'.fd-upg-close:hover{background:rgba(255,255,255,.14)}'+
'.fd-upg-hero{background:var(--ink);color:#fff;padding:2rem 1.75rem 1.5rem;'+
  'position:relative;overflow:hidden;border-radius:18px 18px 0 0}'+
'.fd-upg-hero::before{content:"";position:absolute;inset:0;'+
  'background:radial-gradient(ellipse at 100% 0%,rgba(196,154,48,.32) 0%,transparent 60%),'+
  'radial-gradient(ellipse at 0% 100%,rgba(154,114,24,.2) 0%,transparent 50%);pointer-events:none}'+
'.fd-upg-eye{position:relative;font-family:var(--mono);font-size:.6rem;letter-spacing:.22em;'+
  'text-transform:uppercase;color:var(--gold-l);display:flex;align-items:center;gap:.55rem;margin-bottom:.85rem}'+
'.fd-upg-eye::before{content:"";width:14px;height:1px;background:var(--gold-l)}'+
'.fd-upg-title{position:relative;font-family:var(--serif);font-size:clamp(1.5rem,5vw,1.9rem);'+
  'font-weight:300;line-height:1.15;color:rgba(255,255,255,.95);letter-spacing:-.02em;margin-bottom:.45rem}'+
'.fd-upg-title em{font-style:italic;color:var(--gold-l)}'+
'.fd-upg-sub{position:relative;font-size:.85rem;color:rgba(255,255,255,.7);line-height:1.6}'+
'.fd-upg-body{padding:1.25rem 1.75rem 1.5rem}'+
'.fd-upg-feats{list-style:none;padding:0;margin:0 0 1.25rem;display:flex;flex-direction:column;gap:.55rem}'+
'.fd-upg-feats li{font-size:.84rem;color:var(--text);display:flex;align-items:flex-start;gap:.55rem;line-height:1.5}'+
'.fd-upg-feats li::before{content:"✓";color:var(--gold);font-weight:600;flex-shrink:0;margin-top:.05rem}'+
'.fd-upg-cta{display:flex;flex-direction:column;gap:.5rem}'+
'.fd-upg-cta a,.fd-upg-cta button{display:flex;align-items:center;justify-content:center;gap:.5rem;'+
  'padding:.85rem 1rem;border-radius:12px;font-size:.9rem;font-weight:500;text-decoration:none;cursor:pointer;'+
  'border:none;font-family:inherit;transition:background .2s}'+
'.fd-upg-primary{background:var(--gold);color:#fff}.fd-upg-primary:hover{background:var(--gold-d)}'+
'.fd-upg-wa{background:#25d366;color:#fff}.fd-upg-wa:hover{background:#1fbb59}'+
'.fd-upg-ghost{background:transparent;border:1px solid var(--border2);color:var(--muted);font-size:.78rem}'+
'.fd-upg-ghost:hover{color:var(--text)}'+
'';
    }

    function _injectStylesOnce() {
      if (document.getElementById('fd-upg-style')) return;
      var s = document.createElement('style');
      s.id = 'fd-upg-style';
      s.textContent = _styles();
      document.head.appendChild(s);
    }

    function _waUrl() {
      var prof = _profData || {};
      var nm = prof.name ? ' (' + prof.name + ')' : '';
      /* Mensagem diz o CONTEXTO: quem atende precisa saber por que a
         pessoa chegou ali, e ela precisa saber que veio ao lugar certo. */
      var motivo = _ultimoMotivo === 'quota_exceeded'
        ? ' Atingi o limite de relatórios do plano gratuito.'
        : '';
      var msg = 'Olá! Sou usuário do Fieldo' + nm + '.' + motivo +
                ' Quero ativar o plano Pro.';
      return 'https://wa.me/' + WPP + '?text=' + encodeURIComponent(msg);
    }

    var _ultimoMotivo = null;

    function show(opts) {
      opts = opts || {};
      _ultimoMotivo = opts.reason || null;
      if (typeof document === 'undefined') return;
      _injectStylesOnce();

      var reasonKey = REASONS[opts.reason] ? opts.reason : 'generic';
      var actionKey = ACTION_FEATURES[opts.action] ? opts.action : 'generic';
      var meta  = REASONS[reasonKey];
      var feats = ACTION_FEATURES[actionKey];

      var ov = document.createElement('div');
      ov.className = 'fd-upg-ov';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-labelledby', 'fdUpgTitle');

      var box = document.createElement('div');
      box.className = 'fd-upg-box';
      box.addEventListener('click', function (e) { e.stopPropagation(); });

      box.innerHTML =
        '<button class="fd-upg-close" aria-label="Fechar">✕</button>' +
        '<div class="fd-upg-hero">' +
          '<div class="fd-upg-eye">Fieldo · Pro</div>' +
          '<h2 class="fd-upg-title" id="fdUpgTitle">' + meta.title + '</h2>' +
          '<p class="fd-upg-sub">' + UI.esc(meta.sub) + '</p>' +
        '</div>' +
        '<div class="fd-upg-body">' +
          '<ul class="fd-upg-feats">' +
            feats.map(function (f) { return '<li>' + UI.esc(f) + '</li>'; }).join('') +
          '</ul>' +
          '<div class="fd-upg-cta">' +
            '<a href="ativar.html" class="fd-upg-primary">Ativar Pro →</a>' +
            '<a href="' + _waUrl() + '" target="_blank" rel="noopener" class="fd-upg-wa">' +
              'Falar com a equipe Fieldo' +
            '</a>' +
            '<button type="button" class="fd-upg-ghost" data-fd-upg-dismiss>Agora não</button>' +
          '</div>' +
        '</div>';

      ov.appendChild(box);

      function close() {
        ov.remove();
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = '';
        if (typeof opts.onClose === 'function') opts.onClose();
      }
      function onKey(e) { if (e.key === 'Escape') close(); }

      box.querySelector('.fd-upg-close').addEventListener('click', close);
      box.querySelector('[data-fd-upg-dismiss]').addEventListener('click', close);
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      document.body.appendChild(ov);
    }

    return { show: show };
  })();

  /* ════════════════════════════════════════════════════════════
     USAGE GUARD (NOVO em v4.3) — entitlement+quota multi-camada
     ─────────────────────────────────────────────────────────────
     Single source of truth pra "pode fazer X agora?".
     Combina Auth + Pro entitlement + plan quota + feature flag.

       guard(action, ctx)        → Promise<{allowed, reason, message, ...}>
       enforce(action, opts)     → guard + abre UpgradeUI se !allowed
       attach(el, action, opts)  → wrap rápido pra <a>/<button>

     Actions reconhecidas:
       'create_report'      → Reports.canCreate (free 5/mês)
       'create_budget'      → sempre permitido hoje (futuro: 10/mês free)
       'access_contratos'   → Pro
       'use_themes'         → ctx.theme === 'paper' OK; outros Pro
       'use_custom_niches'  → Pro
       'photos_above_5'     → ctx.count <= 5 OK; >5 Pro

     Ações desconhecidas → allowed=true (fail open por design,
     pra permitir adicionar features sem quebrar guards existentes).
  ════════════════════════════════════════════════════════════ */
  var UsageGuard = (function () {
    function _r(allowed, reason, message, extra) {
      var base = {
        allowed: !!allowed,
        reason:  reason || (allowed ? 'ok' : 'unknown'),
        message: message || '',
      };
      if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) base[k] = extra[k];
      return base;
    }

    function guard(action, ctx) {
      ctx = ctx || {};
      if (!Auth.isLoggedIn()) {
        return Promise.resolve(_r(false, 'auth_required', 'Faça login para continuar.'));
      }

      switch (action) {
        case 'create_report':
          return Reports.canCreate().then(function (q) {
            if (q.allowed) return _r(true, 'ok', null, { quota: q });
            return _r(false, 'quota_exceeded',
              'Limite mensal atingido (' + q.used + '/' + q.limit + ').',
              { quota: q });
          }).catch(function () {
            /* sem internet — RLS protege; libera otimisticamente */
            return _r(true, 'offline_optimistic');
          });

        case 'access_contratos':
        case 'use_custom_niches':
          return Pro.check().then(function (isPro) {
            return isPro
              ? _r(true)
              : _r(false, 'pro_required', 'Esse recurso é exclusivo do plano Pro.');
          });

        case 'use_themes':
          if (!ctx.theme || ctx.theme === 'paper') return Promise.resolve(_r(true));
          return Pro.check().then(function (isPro) {
            return isPro
              ? _r(true)
              : _r(false, 'pro_required', 'Temas alternativos requerem o plano Pro.');
          });

        case 'photos_above_5':
          if ((ctx.count || 0) <= 5) return Promise.resolve(_r(true));
          return Pro.check().then(function (isPro) {
            return isPro
              ? _r(true)
              : _r(false, 'pro_required', 'Mais de 5 fotos por relatório requer Pro.');
          });

        case 'create_budget':
          return Promise.resolve(_r(true));

        default:
          return Promise.resolve(_r(true, 'unknown_action'));
      }
    }

    /* Verifica + abre UpgradeUI quando bloqueado.
       Retorna Promise<bool> (true = pode prosseguir). */
    function enforce(action, opts) {
      opts = opts || {};
      return guard(action, opts.ctx).then(function (r) {
        if (r.allowed) return true;
        if (r.reason === 'auth_required') {
          window.location.href = 'entrar.html';
          return false;
        }
        var reasonKey = ({
          quota_exceeded: 'quota_exceeded',
          pro_required:   'pro_required',
        })[r.reason] || 'generic';
        UpgradeUI.show({
          reason:  reasonKey,
          action:  action,
          onClose: opts.onClose,
        });
        return false;
      });
    }

    /* Intercepta click de <a>/<button>. Se passar, segue navegação. */
    function attach(el, action, opts) {
      if (!el) return;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        enforce(action, opts).then(function (ok) {
          if (ok && el.getAttribute('href')) {
            window.location.href = el.getAttribute('href');
          }
        });
      });
    }

    return { guard: guard, enforce: enforce, attach: attach };
  })();

  /* ── EXPOSIÇÃO GLOBAL ────────────────────────────────────── */
  return {
    config: {
      SUPABASE_URL: SUPABASE_URL,
      REST_URL:     REST_URL,
      STORAGE_URL:  STORAGE_URL,
      EDGE_URL:     EDGE_URL,
      ANON_KEY:     ANON_KEY,
      HEADERS:      HEADERS,
      PLAN_LIMITS:  PLAN_LIMITS,
    },
    Auth:          Auth,
    AuthEmail:     AuthEmail,
    License:       License,
    Validator:     Validator,
    Pix:           Pix,
    publicUrl:     publicUrl,
    publicUrlConfigurado: publicUrlConfigurado,
    colunasPublicas: _comSelect,

    /* ── v7.0 · superfície para módulos externos ───────────────────

       `db.locacao.js` precisa falar com o PostgREST. Sem isto ele
       reimplementaria `_req` — e junto viriam, mal copiados, o timeout
       de 25s, a troca de JWT por anon key em página pública, a
       normalização de `err.status` e a injeção de `select=`. Quatro
       comportamentos que já custaram patch (v5.8.2, v6.5, v6.7) e que
       divergiriam em silêncio na primeira correção feita só de um lado.

       Exportar aqui é uma decisão, não um vazamento: é uma lista curta
       e escolhida. A alternativa que eu havia recomendado — quebrar o
       db.js em db.core + db.servicos + db.locacao — foi descartada
       depois de ler o arquivo: são 3.770 linhas dentro de UMA closure
       com estado privado compartilhado. Separar exigiria expor TODOS os
       internos (encapsulamento pior que este) ou uma cirurgia mecânica
       sem nenhum teste cobrindo as costuras. O ganho real da
       modularização é o código NOVO nascer em arquivo próprio, e isso
       se obtém aqui, com dez linhas.

       `get` usa o JWT do dono. `getPublic` força a anon key e injeta o
       select — é o que página pública deve usar. Trocar um pelo outro
       vaza o JWT do dono numa página aberta. */
    rest: {
      get:       _get,
      getPublic: _getPublic,
      post:      _post,
      postPublic: _postPublic,
      patch:     _patch,
      del:       _del,
      rpc:       _rpc,
    },
    Pagamento:     Pagamento,
    PWA:           PWA,
    RateLimit:     RateLimit,
    LocalDB:       LocalDB,
    Draft:         Draft,
    SyncEngine:    SyncEngine,
    Pro:           Pro,
    Professionals: Professionals,
    Reports:       Reports,
    Avaliacoes:    Avaliacoes,
    Hashes:        Hashes,
    Budgets:       Budgets,
    Contratos:     Contratos,
    Marketplace:   Marketplace,
    /* ── v4.3 ──────────────────────────────── */
    Niches:        Niches,
    Themes:        Themes,
    Photos:        Photos,
    UpgradeUI:     UpgradeUI,
    UsageGuard:    UsageGuard,
    /* ──────────────────────────────────────── */
    UI:            UI,
    HBG:           HBG,
    Nav:           Nav,

    toast: UI.toast,
  };

})();

var HBG = FIELDO.HBG;

/* ════════════════════════════════════════════════════════════
   AUTO-REVEAL DE ELEMENTOS PRO
   Quando há elementos [data-pro="1"] na página, esconde por
   default (já vem com style display:none). Após Pro.check(),
   revela se o usuário tiver entitlement.
   Para botões (qa-btn) que devem mudar de comportamento se NÃO
   for Pro: o helper troca href para 'ativar.html' e adiciona
   um pequeno ícone de cadeado, mas mantém o item visível.
════════════════════════════════════════════════════════════ */
(function () {
  if (typeof document === 'undefined') return;

  function applyProState() {
    var els = document.querySelectorAll('[data-pro="1"]');
    if (!els.length) return;

    /* Se não estiver logado, mantém escondido (default) */
    if (!FIELDO.Auth.isLoggedIn()) return;

    FIELDO.Pro.check().then(function (isPro) {
      els.forEach(function (el) {
        /* Itens de menu lateral: mostra se Pro, esconde se não */
        if (el.classList.contains('menu-nav-item')) {
          el.style.display = isPro ? '' : 'none';
          return;
        }
        /* Botões de ação rápida (qa-btn): sempre visíveis.
           v4.3: em vez de redirecionar bruto pra ativar.html, intercepta
           o click e abre UpgradeUI (modal). Mantém label "Pro" no botão. */
        if (el.classList.contains('qa-btn')) {
          el.style.display = '';
          if (!isPro) {
            el.setAttribute('title', 'Ativar Pro para acessar Contratos');
            var lbl = el.querySelector('.qa-label');
            if (lbl) lbl.innerHTML = 'Contratos <span style="opacity:.5;font-size:.7em">·</span> <span style="font-size:.8em;color:var(--gold-d)">Pro</span>';
            /* Click intercept: abre UpgradeUI em vez de seguir o href */
            if (!el._fdGuarded) {
              el._fdGuarded = true;
              el.addEventListener('click', function (e) {
                e.preventDefault();
                FIELDO.UpgradeUI.show({
                  reason: 'pro_required',
                  action: 'access_contratos',
                });
              });
            }
          }
          return;
        }
        /* Genérico: revela se Pro */
        el.style.display = isPro ? '' : 'none';
      });
    }).catch(function () {
      /* Em caso de erro, mantém escondido (lado seguro) */
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyProState);
  } else {
    applyProState();
  }
})();

/* ════════════════════════════════════════════════════════════
   AUTO-START SYNC ENGINE (v4.2)
   Inicia a fila de sincronização em background. Páginas que
   chamarem create() em modo offline terão dados no IndexedDB,
   e essa engine envia para o Supabase quando voltar a rede.
════════════════════════════════════════════════════════════ */
(function () {
  if (typeof document === 'undefined') return;

  function injectIndicator() {
    if (document.getElementById('fieldo-sync-indicator')) return;
    var el = document.createElement('div');
    el.id = 'fieldo-sync-indicator';
    el.style.cssText = [
      'position:fixed', 'bottom:1.2rem', 'right:1.2rem',
      'background:rgba(154,114,24,.95)', 'color:#fff',
      'font-family:monospace', 'font-size:.7rem', 'letter-spacing:.06em',
      'padding:.45rem .85rem', 'border-radius:2rem',
      'box-shadow:0 4px 16px rgba(0,0,0,.18)',
      'z-index:1000', 'opacity:0', 'pointer-events:none',
      'transition:opacity .25s'
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function updateIndicator(text, visible, clicavel) {
    var el = document.getElementById('fieldo-sync-indicator') || injectIndicator();
    if (!el) return;
    el.textContent = text;
    el.style.opacity = visible ? '1' : '0';
    el.style.cursor  = clicavel ? 'pointer' : 'default';
    el.style.pointerEvents = clicavel ? 'auto' : 'none';

    if (clicavel && !el._diagBound) {
      el._diagBound = true;
      el.addEventListener('click', mostrarFalhas);
    }
  }

  /* v6.6: diagnóstico das falhas de envio.
     Mostra o que travou, com resumo do registro, e deixa escolher entre
     tentar de novo e descartar. Descartar pede confirmação nomeando o
     que se perde — "1 item" não diz nada a quem está em obra. */
  function mostrarFalhas() {
    FIELDO.SyncEngine.errors().then(function (lista) {
      if (!lista.length) {
        updateIndicator('', false);
        return;
      }
      var desc = lista.map(function (e, i) {
        return (i + 1) + '. ' + (e.resumo ? e.resumo + ' — ' : '') +
               e.tabela + ' (' + e.motivo + ')';
      }).join('\n');

      var msg = 'Não foi possível enviar:\n\n' + desc +
        '\n\nTentar enviar de novo?\n\n' +
        'OK = tentar de novo\nCancelar = ver opção de descartar';

      if (window.confirm(msg)) {
        FIELDO.SyncEngine.retryErrors().then(function (n) {
          updateIndicator('↻ Reenviando ' + n, true);
          return FIELDO.SyncEngine.flush();
        });
        return;
      }

      if (window.confirm('Descartar definitivamente?\n\n' + desc +
          '\n\nEsses dados serão perdidos e não podem ser recuperados.')) {
        FIELDO.SyncEngine.discardErrors().then(function () {
          updateIndicator('', false);
        });
      }
    });
  }

  function startSync() {
    if (!FIELDO.LocalDB.isSupported()) return;
    if (!FIELDO.Auth.isLoggedIn()) return;

    FIELDO.SyncEngine.on(function (event, data) {
      if (event === 'start') {
        FIELDO.SyncEngine.status().then(function (s) {
          if (s.pending > 0) updateIndicator('↻ Sincronizando ' + s.pending, true);
        });
      } else if (event === 'end') {
        FIELDO.SyncEngine.status().then(function (s) {
          if (s.pending > 0) {
            updateIndicator('⏱ ' + s.pending + ' pendente' + (s.pending>1?'s':''), true);
          } else if (s.errors > 0) {
            /* v6.6: clicável. Antes era um aviso permanente sem ação —
               o usuário não sabia o que falhou nem como resolver. */
            updateIndicator('⚠ ' + s.errors + ' falha' + (s.errors>1?'s':'') + ' no envio · toque', true, true);
          } else {
            updateIndicator('✓ Sincronizado', true);
            setTimeout(function () { updateIndicator('', false); }, 2000);
          }
        });
      } else if (event === 'offline') {
        updateIndicator('◌ Offline', true);
      }
    });

    FIELDO.SyncEngine.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSync);
  } else {
    startSync();
  }
})();


/* ════════════════════════════════════════════════════════════
   AUTO-BOOT THEMES (v4.3)
   Aplica o tema persistido ANTES do paint pra evitar flash.
   Roda inline (não espera DOMContentLoaded) — assume que
   <script src="db.js"> está no <head> ou no fim do <body>.
   Se o usuário perdeu o Pro, o tema volta pra 'paper'
   silenciosamente após Pro.check resolver.
════════════════════════════════════════════════════════════ */
(function () {
  if (typeof document === 'undefined') return;
  try { FIELDO.Themes.boot(); } catch (e) { /* fail open */ }
})();
