# Fieldo v4.2 — Offline-first

**Fase 2 do roadmap pós-FadReview.**

## O que mudou

### `FIELDO.LocalDB` — IndexedDB wrapper

Stores criadas:
- `drafts` — auto-save de formulários (key=formId)
- `reports`, `budgets` — dados pendentes/sincronizados
- `syncQueue` — fila de operações
- `photos` — base64 antes do upload (não usado ainda, reservado pra Fase 4)

Cada record carrega:
- `_localId` UUID estável
- `_syncStatus` `'pending' | 'syncing' | 'synced' | 'error'`
- `_serverId` quando sincronizado

API:
```js
FIELDO.LocalDB.put('reports', { data: {...} })   // salva
FIELDO.LocalDB.list('reports', { status: 'pending' })
FIELDO.LocalDB.queueOp({ type:'create', table:'reports', payload, localId })
FIELDO.LocalDB.dequeueOps(20)
FIELDO.LocalDB.markOp(opId, 'syncing')
```

Falha gracioso quando IDB indisponível (modo privado, navegador antigo).

### `FIELDO.Draft` — auto-save

```js
FIELDO.Draft.attach('servico', containerEl, { debounce: 600 });
FIELDO.Draft.restore('servico', containerEl);
FIELDO.Draft.clear('servico');
```

Salva todos `<input>`, `<textarea>`, `<select>` (excluindo file/submit) a cada
600ms de inatividade. Já wired em:
- `servico.html` (relatório)
- `orcamento.html` (orçamento)

Ao reabrir uma dessas páginas com rascunho pendente, mostra prompt:
> "Você tem um rascunho não salvo. Continuar de onde parou?"

### `FIELDO.SyncEngine` — fila + retry

- Polling a cada 30s
- Triggera em `online`, `focus`
- Retry com backoff exponencial (5s, 10s, 20s, 40s, 80s — depois marca erro)
- Máximo 5 tentativas por op

```js
FIELDO.SyncEngine.start();           // já roda automático no boot
FIELDO.SyncEngine.flush();           // força agora
FIELDO.SyncEngine.status();          // { online, pending, errors, running }
FIELDO.SyncEngine.on(callback);      // hook em eventos
```

Eventos: `start`, `end`, `idle`, `offline`, `opSuccess`, `opError`, `error`.

### Reports e Budgets agora são local-first

Mudança transparente — interface igual:

```js
FIELDO.Reports.create({ client_name: 'João', ... })
  .then(report => { /* funciona online OU offline */ });
```

Comportamento:
1. Sempre salva em IndexedDB primeiro
2. Tenta enviar pra Supabase
3. Se sucesso: marca `synced`, retorna o registro do servidor
4. Se falha (offline ou erro): enfileira pra SyncEngine, retorna registro local com `_pendingSync: true`
5. SyncEngine retoma quando voltar online

`Reports.list()` mescla pendentes locais + servidor — usuário sempre vê seus dados.

### Sync Indicator

Badge sutil no canto inferior direito mostra:
- `↻ Sincronizando 3` durante envio
- `⏱ 2 pendentes` quando há fila
- `✓ Sincronizado` por 2s após sucesso
- `◌ Offline` quando navigator.onLine = false

### `netlify/functions/sync.mjs` (skeleton)

Function pronta para quando deployar — recebe batch de ops, valida tabela
e tipo, executa contra Supabase usando service_role key. Comentada em
`netlify.toml` por enquanto. Ativar quando Netlify voltar.

## Compatibilidade

- ✅ Páginas existentes funcionam sem mudança (interface preservada)
- ✅ `FIELDO.Reports.create`, `Budgets.create` — mesma assinatura
- ✅ Quando IDB indisponível, o app cai pro modo antigo (REST direto)
- ✅ Tokens HMAC v4.0 continuam válidos

## Como testar

1. Substitua `db.js` + `servico.html` + `orcamento.html`
2. Abre `servico.html` — preenche metade do formulário, fecha aba
3. Reabre — deve perguntar "Continuar do rascunho?"
4. Aceita → tudo restaurado
5. **Para testar offline:** DevTools → Network → throttle "Offline"
6. Cria um relatório → deve ver badge `↻ Sincronizando` ou `⏱ 1 pendente`
7. Volta online → badge muda pra `✓ Sincronizado`
8. Abre o registro no Supabase — deve estar lá

## Limitações conhecidas

- **Updates/deletes ainda são online-only.** Apenas `create` é local-first.
  Adicionar update/delete offline exige saber qual `serverId` foi atribuído,
  o que envolve coordenação adicional. Fica pra v4.2.1 se necessário.
- **Photos** — store reservado mas pipeline de resize não foi implementado.
  Fase 4 vai cobrir.
- **Sem deduplicação** entre dispositivos — se você criar offline em 2 lugares
  diferentes, pode duplicar ao sincronizar. Esse caso é raro pro perfil
  prestador autônomo.

## Próxima fase

- **Fase 3** — UpgradeUI (tela de planos completa) + UsageGuard multi-camada
- **Fase 4** — Niches customizáveis + Themes + Photos pipeline
