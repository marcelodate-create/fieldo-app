# Fieldo v4.0 — Pro via HMAC client-side (modelo FadReview)

## Por quê

Versões anteriores (v3.x) usavam Pro via:
- Supabase Auth (magic link / OTP por email) — frágil em local, dependia de URL pública
- Tabelas `activation_codes` + `pro_access` no banco — 6 migrations, complexidade
- RPCs `activate_pro_code`, `has_pro_access` — 4 funções server-side
- RLS em tabelas de Contratos — risco médio de quebrar usuários atuais

A v4.0 substitui tudo por **token HMAC assinado pelo admin, validado offline pelo app**.

## Como funciona

```
ADMIN gera (admin/codes.html)        APP valida (db.js → FIELDO.License)
─────────────────────────────         ─────────────────────────────
1. Login com senha local              1. Cliente cola token em ativar.html
   (hash SHA-256 sessionStorage)      2. Token = base64(payload).assinatura
2. Preenche nome + plano + dias       3. Reconstrói o secret em runtime
3. Monta payload: {u,p,d,exp,iat}     4. Recalcula HMAC do payload
4. HMAC-SHA256(payload, SECRET)       5. Compara com a assinatura embutida
5. Token = base64(payload).sig20      6. Verifica payload.exp > hoje
6. Manda pro cliente via WhatsApp     7. Salva em localStorage
                                       8. Pro liberado offline até exp
```

## Estrutura nova

| Onde | Componente | Responsabilidade |
|---|---|---|
| `db.js` | `FIELDO.License` | HMAC verify, decode, getStatus, activate, save em localStorage |
| `db.js` | `FIELDO.Pro` | Wrapper de compat. Delega tudo para License. |
| `admin/codes.html` | Painel standalone | Senha local + gera tokens HMAC + envia via WhatsApp |
| `ativar.html` | Página de ativação | Cola token → License.activate → mostra status |
| `entrar.html` | Login | Apenas WhatsApp OTP (Auth telefone) |

## Secret HMAC

**Localizado em DOIS arquivos** que precisam ficar em sincronia:
- `db.js` (verify)
- `admin/codes.html` (sign)

```js
const _P = ['TUFDXw==','RkRfTA==','djRfMg==','SUNFTg==','MDI2','U0VfSA=='];
const _ORDER = [1, 3, 5, 0, 2, 4];
function _buildSecret() { return _ORDER.map(i => atob(_P[i])).join(''); }
// Secret real: FD_LICENSE_HMAC_v4_2026
```

Para trocar o secret (invalidando todos os tokens existentes):
1. Gere novo secret
2. Divida em chunks
3. Codifique cada chunk em Base64
4. Atualize `_P` e `_ORDER` em **AMBOS** os arquivos
5. Tokens antigos param de funcionar

## Senha do admin

Default: **`fieldo2026`**

Para mudar:
1. Escolha nova senha
2. Calcule SHA-256(novaSenha + "FIELDO_ADMIN_SALT_2026")
3. Substitua `_SENHA_HASH` em `admin/codes.html`

```js
// Exemplo via Node:
node -e "console.log(require('crypto').createHash('sha256').update('NOVA_SENHA' + 'FIELDO_ADMIN_SALT_2026').digest('hex'))"
```

Lockout: 5 tentativas erradas → bloqueia 15 min via sessionStorage.

## O que removi

- `FIELDO.AuthEmail` (Supabase Auth) — virou stub, todos métodos retornam falso
- Steps 0/0b do `entrar.html` (email + OTP email)
- Nudge de vinculação de email no `index.html`
- Funções `processarCallbackMagicLink`, `vincularOuCriarProfissional`
- RPCs do `FIELDO.Pro.Admin` — agora são stubs que rejeitam (admin gera tokens local)

## O que mantive (compat)

- `FIELDO.Pro.check()`, `Pro.activate()`, `Pro.details()` — mesma interface, agora delegam para License
- `[data-pro="1"]` auto-reveal continua funcionando
- Páginas legadas (busca, explorar, etc) com `<a data-pro="1">` em menus

## Trade-offs aceitos

| Você ganha | Você perde |
|---|---|
| Funciona local em qualquer porta | Revogação remota (token offline) |
| Funciona em `file://` | Lista de "quem é Pro" centralizada |
| Sem dependência de URL pública | Fácil de reverse-engineer (ofuscação só pra leigos) |
| Sem limite de email no Supabase | Volume alto de ativações (gera manual) |
| Banco 100% intacto | — |
| 0 SQL migrations necessárias | — |

## Testando agora

1. Abra `admin/codes.html` no browser local
2. Senha: `fieldo2026`
3. Preencha nome, escolha plano, clica "Gerar chave"
4. Copia a chave gerada
5. Abre `ativar.html`
6. Cola a chave
7. Pro ativo · menu Contratos aparece · ir pra `contratos.html` funciona

Tudo offline. Sem Supabase. Sem URL pública. Sem 404.

## Em produção quando deployar

Mesmo modelo continua funcionando. Vantagem extra: você pode hospedar o
`admin/codes.html` num caminho não-público (ex: `/admin/codes.html` com
.htaccess) e proteger por IP além da senha.

Token em produção é o **mesmo** que o teste local — nada muda.
