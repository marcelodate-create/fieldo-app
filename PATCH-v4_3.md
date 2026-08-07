# Fieldo v4.3 — UpgradeUI + UsageGuard + Niches + Themes + Photos

**Fases 3 e 4 do roadmap pós-FadReview.** Conclui a sequência iniciada em
v4.1 (Validator/RateLimit) e v4.2 (offline-first).

## O que mudou

### `FIELDO.UpgradeUI` — modal de upgrade reutilizável

Único ponto pra solicitar upgrade, com hero + features contextuais + CTAs
(Ativar Pro · WhatsApp). Estilos auto-injetados na primeira chamada.

```js
FIELDO.UpgradeUI.show({
  reason: 'quota_exceeded',   // 'pro_required' | 'quota_exceeded' | 'expired' | 'generic'
  action: 'create_report',    // determina a lista de features mostrada
  onClose: function () {},    // opcional
});
```

Actions reconhecidas — cada uma mostra 3 features-chave:
`create_report`, `access_contratos`, `use_themes`, `use_custom_niches`,
`photos_above_5`, `generic`.

### `FIELDO.UsageGuard` — entitlement + quota multi-camada

Single source of truth pra "pode fazer X agora?". Combina `Auth` + `Pro` +
quota do plano + feature flag.

```js
// Check puro
FIELDO.UsageGuard.guard('create_report').then(function (r) {
  // r = { allowed, reason, message, ...extras (ex: quota) }
});

// Check + abre UpgradeUI quando bloqueado
FIELDO.UsageGuard.enforce('access_contratos').then(function (ok) {
  if (ok) /* prossegue */;
});

// Wrap rápido de <a>/<button>
FIELDO.UsageGuard.attach(btnEl, 'use_custom_niches');
```

Actions cobertas:
- `create_report` — usa `Reports.canCreate` (free: 5/mês)
- `access_contratos` — exige Pro
- `use_themes` — `ctx.theme === 'paper'` libera; outros Pro
- `use_custom_niches` — Pro
- `photos_above_5` — `ctx.count <= 5` libera; >5 Pro
- `create_budget` — sempre permitido (placeholder pra quota futura)

Ações desconhecidas retornam `allowed=true` (fail open), pra permitir
adicionar features sem quebrar guards existentes.

### `FIELDO.Niches` — categorias customizáveis

8 defaults sempre presentes. Pro pode adicionar até **12 nichos
customizados** com emoji + label. Persistido em `localStorage`.

```js
FIELDO.Niches.list();        // → [{ key, label, emoji, _default? }, ...]
FIELDO.Niches.emoji('eletrica');   // → '⚡'
FIELDO.Niches.label('jardinagem'); // → 'Jardinagem' (mesmo que custom)
FIELDO.Niches.add({ label: 'Jardinagem', emoji: '🌱' });
// → { ok:true, niche: { key, label, emoji } }
// errors: 'empty_label' | 'too_long' | 'duplicate' | 'limit'

FIELDO.Niches.remove('jardinagem');
FIELDO.Niches.isCustom('eletrica'); // → false
```

`emoji()` e `label()` funcionam pra qualquer key — default ou custom — então
relatórios antigos com niche customizado removido continuam exibindo bem
(fallback 🔧).

### `FIELDO.Themes` — paletas alternativas Pro

4 temas, aplicados via `<html data-theme="X">`. CSS reescreve as variáveis
base, o resto consome `--bg`/`--paper`/`--text`/`--gold` normalmente.

| Tema | Pro? | Vibe |
|---|---|---|
| `paper`    | ❌ | Pergaminho (padrão) |
| `midnight` | ✅ | Dark, accent gold |
| `sage`     | ✅ | Verde-acinzentado, accent oliva |
| `ember`    | ✅ | Areia/terracota, accent quente |

```js
FIELDO.Themes.list();        // → todos
FIELDO.Themes.current();     // → 'paper' ou outro
FIELDO.Themes.set('midnight').then(function (r) {
  if (!r.ok) /* r.error === 'pro_required' */;
});
```

`Themes.boot()` roda **automaticamente no fim do `db.js`**, aplicando o tema
persistido antes do paint pra evitar flash. Se o usuário perdeu o Pro,
volta pra `paper` silenciosamente após `Pro.check` resolver.

### `FIELDO.Photos` — pipeline captura/resize/upload

Resize client-side antes de qualquer upload (canvas, JPEG q .82, lado maior
de 1600px). Economiza banda e storage do Supabase.

```js
FIELDO.Photos.add(file).then(function (p) {
  // p = { _localId, dataURL, blob, w, h, bytes }
  _fotos.push(p);
});

FIELDO.Photos.upload(_fotos, { reportId: rep.id })
  .then(function (urls) {
    // urls = [url|null, ...] — null = falha, ficou staged no IDB
    var ok = urls.filter(function (u) { return u; });
    if (ok.length) FIELDO.Reports.update(rep.id, { photos: ok });
  });

FIELDO.Photos.quota();
// → { limit: 5|20, plan: 'free'|'pro', isPro: bool }
```

Falhas de upload vão pro IDB (store `photos`) e o `SyncEngine` retomará
o que conseguir. Bucket usado: `reports` — path `{profId}/{reportId}/{idx}.jpg`.

Limites: Free **5 fotos/relatório**, Pro **20**.

## Páginas atualizadas

| Arquivo | Mudança |
|---|---|
| `db.js` | 5 módulos novos, header reescrito, qa-btn Pro intercept usa UpgradeUI |
| `fieldo.css` | 3 temas (`[data-theme="..."]`) + theme picker + niche editor |
| `servico.html` | Grid de categorias dinâmico, pipeline Photos com resize, UsageGuard.enforce no submit |
| `index.html` | Seção "Personalização" no perfil (themes + niches) |
| `contratos.html` | Pro gate via UsageGuard + UpgradeUI (era redirect bruto) |

## Compatibilidade

- ✅ Toda interface pública v4.0/v4.1/v4.2 preservada
- ✅ Relatórios antigos com `niche` removido seguem mostrando emoji fallback
- ✅ Tema `paper` é default — usuários atuais não veem mudança visual
- ✅ Fotos no formato antigo (sem `_localId`/`blob`) continuam sendo aceitas;
  o pipeline só converte na próxima captura
- ✅ Tokens HMAC v4.0 continuam válidos
- ✅ Storage bucket `reports` precisa estar criado no Supabase com policy
  pública de read. Se não existir, fotos falham silenciosamente — o
  relatório principal segue.

## Como testar

1. Substitua `db.js`, `fieldo.css`, `servico.html`, `index.html`,
   `contratos.html`. Coloque `docs/PATCH-v4.3.md`.
2. Abre `index.html` → menu → Perfil. Role até "Personalização":
   - 4 swatches de tema visíveis. Clica em "Midnight" → modal de upgrade
     aparece (você é free).
   - Cola um token Pro em `ativar.html`. Volta pro perfil → clica
     "Midnight" → tema aplica imediatamente. Recarrega a página → tema
     permanece (boot antes do paint, sem flash).
3. Perfil → "Adicionar categoria personalizada" → como Pro, aparece o
   form. Coloca emoji `🌱`, label `Jardinagem`, clica Add. Chip aparece.
4. Abre `servico.html` → grid agora tem 9 categorias (8 defaults + Jardinagem).
5. Como Free (limpa licença), tenta:
   - Adicionar 6ª foto → modal "photos_above_5"
   - Acessar Contratos pelo qa-btn do dashboard → modal "access_contratos"
   - Criar o 6º relatório do mês → modal "quota_exceeded"
6. Captura 6 fotos como Pro → todas redimensionadas pra 1600px. Verifica
   no DevTools → IndexedDB → `fieldo > photos`: as que falharam estão lá.

## Limitações conhecidas

- **Upload de fotos é dispara-e-esquece.** Se falhar, fica staged no IDB
  mas não há trigger no `SyncEngine` ainda pra subir só fotos (ele só
  reprocessa rows tabelares). Fica pra v4.3.1 se necessário.
- **Bucket `reports`** precisa existir no Supabase com política
  `(bucket_id = 'reports' AND auth.role() = 'authenticated' OR true)` pra
  leitura pública. Como usamos anon key, hoje qualquer um lê — adequado
  pra relatório público (`is_public: true`).
- **Tema persiste por dispositivo** (localStorage). Trocar de aparelho
  começa em `paper`.
- **Nichos custom também são por-dispositivo.** Se o usuário trocar de
  celular, precisa re-adicionar. Migração pra `professionals.niches_json`
  fica como possível v4.4.

## Próximas direções (post-v4.3)

- Edge Function `/api/sync` pra batch de uploads (inclui fotos)
- Niches custom persistidos no banco (sincroniza entre devices)
- Onboarding curto explicando o que Pro libera (showcase dos 3 temas + 12 niches)
- Limite de orçamentos pra Free (já placeholder no UsageGuard)
