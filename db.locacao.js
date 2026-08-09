/* ============================================================
   Fieldo · db.locacao.js  v1.0  —  módulo da Locação de equipamentos
   ─────────────────────────────────────────────────────────────
   Carrega DEPOIS de db.js. Usa FIELDO.rest (get/post/patch/del) e
   FIELDO.Auth — mesmo padrão do db.condo.js: não reimplementa
   timeout, JWT ou tratamento de erro.

   Requer que a página defina, ANTES de <script src="db.js">:
     <script>window.FIELDO_APP_NS = 'loc';</script>

   Tabelas (Supabase, mesmo projeto do Fieldo):
     locadoras, equipamentos, equipamento_categorias,
     locacoes, locacao_itens, locacao_laudos
   RLS: id = auth.uid() em locadoras; equipamentos herda via
   locadora_id. locacoes NÃO tem leitura pública nenhuma — cliente
   acessa a própria locação só pela RPC do token (fora do escopo
   deste módulo v1, que cobre o catálogo/vitrine).
============================================================ */

var FIELDO_LOCACAO = (function () {
  'use strict';

  if (typeof FIELDO === 'undefined' || !FIELDO.rest || !FIELDO.Auth) {
    console.error('[db.locacao.js] FIELDO.rest/Auth ausentes — carregue db.js antes deste arquivo.');
    return { Locadoras: {}, EquipamentoCategorias: {}, Equipamentos: {} };
  }

  var _get       = FIELDO.rest.get;
  var _getPublic = FIELDO.rest.getPublic;
  var _post      = FIELDO.rest.post;
  var _patch     = FIELDO.rest.patch;
  var _del       = FIELDO.rest.del;
  var Auth       = FIELDO.Auth;

  var _locadoraData = null;

  /* ════════════════════════════════════════════════════════════
     LOCADORAS — id = auth.uid(), igual Professionals/Sindicos
  ════════════════════════════════════════════════════════════ */
  var Locadoras = {

    me: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve(null);
      if (_locadoraData) return Promise.resolve(_locadoraData);
      return _get('/locadoras?id=eq.' + encodeURIComponent(id) + '&limit=1')
        .then(function (rows) { return rows[0] || null; })
        .then(function (l) {
          if (l) { _locadoraData = l; Auth.setSession(l); }
          return l;
        });
    },

    getBySlug: function (slug) {
      return _getPublic('/locadoras?slug=eq.' + encodeURIComponent(slug) + '&limit=1')
        .then(function (rows) { return rows[0] || null; });
    },

    /* O id vem do auth.uid() da sessão anônima — a policy
       locadora_insert_self recusa qualquer outro valor. */
    create: function (data) {
      return Auth.Session.ensure().then(function (s) {
        data.id = s.user_id;
        return _post('/locadoras', data);
      }).then(function (rows) {
        var l = Array.isArray(rows) ? rows[0] : rows;
        if (l) { _locadoraData = l; Auth.setSession(l); }
        return l;
      });
    },

    update: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      return _patch('/locadoras?id=eq.' + id, data)
        .then(function (rows) {
          var l = Array.isArray(rows) ? rows[0] : rows;
          if (l) { _locadoraData = l; Auth.setSession(l); }
          return l;
        });
    },
  };

  /* ════════════════════════════════════════════════════════════
     CATEGORIAS — leitura pública, só as aprovadas (moderação)
  ════════════════════════════════════════════════════════════ */
  var EquipamentoCategorias = {
    listAprovadas: function () {
      return _getPublic('/equipamento_categorias?aprovada=eq.true&order=ordem.asc');
    },
  };

  /* ════════════════════════════════════════════════════════════
     EQUIPAMENTOS — catálogo da locadora
  ════════════════════════════════════════════════════════════ */
  var Equipamentos = {

    /* Painel da própria locadora — todos os itens, público ou não. */
    listOwn: function () {
      var id = Auth.getId();
      if (!id) return Promise.resolve([]);
      return _get('/equipamentos?locadora_id=eq.' + id + '&order=created_at.desc');
    },

    /* Vitrine pública — só o que a própria locadora decidiu publicar
       (RLS já filtra is_public+ativo+locadora.is_public; aqui só
       fecha o filtro de qual locadora). */
    listPublicByLocadora: function (locadoraId) {
      return _getPublic('/equipamentos?locadora_id=eq.' + encodeURIComponent(locadoraId) +
        '&order=created_at.desc');
    },

    create: function (data) {
      var id = Auth.getId();
      if (!id) return Promise.reject(new Error('Não autenticado'));
      data.locadora_id = id;
      return _post('/equipamentos', data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    update: function (equipId, data) {
      return _patch('/equipamentos?id=eq.' + encodeURIComponent(equipId), data)
        .then(function (rows) { return Array.isArray(rows) ? rows[0] : rows; });
    },

    remove: function (equipId) {
      return _del('/equipamentos?id=eq.' + encodeURIComponent(equipId));
    },
  };

  return {
    Locadoras:             Locadoras,
    EquipamentoCategorias: EquipamentoCategorias,
    Equipamentos:          Equipamentos,
  };
})();
