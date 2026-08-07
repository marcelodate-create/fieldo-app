# Fieldo v4.1 — Reestrutura modular + Validator + RateLimit

**Fase 1 do roadmap pós-análise FadReview.**

## O que mudou

### 1. `db.js` reorganizado
- Header com índice de módulos (igual ao FadReview)
- Cada módulo separado por banner visual `═══`
- Ordem lógica: config → utils → Auth → CRUD → UI → Pro stack
- Removido dead code: `_authHeaders` (não chamava mais nada relevante após v4.0)
- **Interface pública 100% preservada** — `FIELDO.Auth`, `FIELDO.Reports`, etc continuam idênticas

### 2. `FIELDO.Validator` (NOVO)
Estados tipados de licença com mensagens prontas para UI.

```js
FIELDO.Validator.validate().then(r => {
  // r.status: 'VALID' | 'UNLICENSED' | 'EXPIRED' | 'INVALID' | 'RATE_LIMITED'
  // r.message: já traduzida
  // r.payload: dados do token (se válido)
  // r.daysLeft: dias restantes
});

FIELDO.Validator.activate(token).then(r => {
  if (r.valid) celebrate();
  else showError(r.message); // mensagem pronta
});
```

Antes (v4.0) cada página mapeava manualmente:
```js
({
  invalid_code: 'Código inválido...',
  expired_code: 'Este código expirou.',
  exhausted_code: '...',
})[errKey]
```

Agora a mensagem vem direto do Validator, traduzida e contextual.

### 3. `FIELDO.RateLimit` (NOVO)
Limita tentativas por janela de tempo, persistido em sessionStorage.

```js
// Configurar
FIELDO.RateLimit.config('chave_qualquer', { max: 5, windowMs: 600000 });

// Verificar antes
const r = FIELDO.RateLimit.check('chave_qualquer');
if (!r.ok) return alert(r.message); // "Aguarde X minutos"

// Registrar tentativa
FIELDO.RateLimit.record('chave_qualquer');

// Reset (após sucesso)
FIELDO.RateLimit.reset('chave_qualquer');
```

Pré-configurado para `'activation'`: **5 tentativas / 10 min**. Validator usa
automaticamente — sem precisar mudar código de quem chama.

## Páginas atualizadas

| Arquivo | Mudança |
|---|---|
| `db.js` | Reorganização + 2 módulos novos |
| `ativar.html` | Usa `Validator.activate` em vez de `Pro.activate` (mensagem mais limpa) |
| Todas as outras | Sem mudança — `Pro.*` continua funcionando |

## Compatibilidade

- ✅ `FIELDO.Pro.check()`, `Pro.activate()`, `Pro.details()` — idênticos
- ✅ `FIELDO.License.*` — idêntico
- ✅ `FIELDO.AuthEmail.*` — stub, idêntico
- ✅ `FIELDO.Auth.*`, `FIELDO.Reports.*`, etc — idênticos
- ✅ `[data-pro="1"]` auto-reveal — idêntico
- ✅ HMAC secret — idêntico (tokens v4.0 continuam válidos)

## Como saber se funcionou

1. Substitua `db.js` (e opcionalmente `ativar.html`) pelos novos
2. Recarregue qualquer página — não pode haver erro no console
3. Em `ativar.html`, tente colar uma chave inválida 6 vezes seguidas
4. Da 6ª em diante deve aparecer "Muitas tentativas. Aguarde 10 minutos"
5. Após 10 min OU fechar/reabrir a aba, contador zera

## Próximas fases

- **Fase 2**: Offline-first (FIELDO.LocalDB com IndexedDB + SyncEngine + Draft auto-save)
- **Fase 3**: UpgradeUI completo (planos + Pix + WhatsApp) + UsageGuard multi-camada
- **Fase 4**: Niches customizáveis + Themes
