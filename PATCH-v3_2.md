# Fieldo v3.2 — OTP por email (sem URL pública)

## Por quê

A v3.0/v3.1 usava **magic link** — usuário recebe email com link, clica, é redirecionado para o app. Funciona em produção mas tem dois problemas em desenvolvimento local:

1. Exige que o domínio esteja whitelisted no Supabase Dashboard
2. Quebra em `file://` e em portas variáveis de servidores locais
3. Resultado típico: **404 ao clicar no link**

## A solução

Trocamos magic link por **OTP de 6 dígitos por email**:
- Mesma API do Supabase (`/auth/v1/otp` para enviar, `/auth/v1/verify` para validar)
- Sem URL de callback, sem `redirect_to`, sem whitelist
- Funciona local em qualquer porta — inclusive `file://` se preciso
- UX idêntica à do OTP por WhatsApp já existente

## Mudanças

### `db.js` v3.2 — `FIELDO.AuthEmail`

| Método | Status |
|---|---|
| `sendOtp(email)` | ✅ NOVO — envia código de 6 dígitos |
| `verifyOtp(email, code)` | ✅ NOVO — valida código, retorna sessão |
| `sendMagicLink(email)` | 🔧 Mantido como alias de `sendOtp` (compat) |
| `handleAuthCallback()` | 🔧 No-op (retorna `null`) |
| `getUser()`, `refreshSession()`, `isLoggedIn()`, `logout()` | ✅ Inalterados |

### `entrar.html`

- **Step 0** — campo de email + botão "Enviar código por email"
- **Step 0b** — 6 inputs de OTP (igual ao do WhatsApp), botão "Entrar", timer de reenvio
- Removido callback de `#access_token=` (não usa mais)
- Mantido fluxo de WhatsApp como fallback (link "Outras formas de entrar")

### `index.html`

- Nudge de email (Fase B) agora **salva o email** no perfil e instrui o usuário a fazer logout + entrar por email. Não tenta enviar magic link inline.

### Outras páginas

- `admin/codes.html`, `ativar.html`, `contratos.html`, `index.html` — sem mudança. `AuthEmail.isLoggedIn()` continua funcionando exatamente igual (a sessão é a mesma, só mudou a forma de obter).

---

## Setup necessário no Supabase

**1 minuto, uma vez só:** veja `docs/SETUP-OTP-EMAIL.md`. Resumo:

1. Em Auth → Providers → Email: certifique-se que está habilitado
2. Em Auth → Templates → "Magic Link": substitua o template por um que mostra `{{ .Token }}` em vez de `{{ .ConfirmationURL }}`. Template completo pronto para colar está no doc.

---

## Como testar

1. Substitua os arquivos do v3.1 pelos do v3.2 no servidor local
2. Configure o template de email (1 vez)
3. Abra `entrar.html`
4. Email → recebe 6 dígitos → cola → entra

Funciona em:
- Live Server (qualquer porta)
- `python -m http.server`
- `file://` (clique duplo no HTML)
- Qualquer hospedagem futura — sem nenhuma mudança de configuração

---

## Limitações conhecidas

- **3 emails por hora por IP** no Supabase grátis (limite anti-spam). Para produção, configure SMTP custom (Resend, SendGrid).
- Template de email "Magic Link" também é usado para outros fluxos (recuperação de senha etc) — se você habilitar password no futuro, edite os templates relevantes.

---

## Reverter para magic link

Se quiser voltar (após deployar com URL estável):

1. No Supabase Dashboard, restaure o template "Magic Link" original (volta automaticamente se você apagar suas customizações)
2. Em `entrar.html`, troque `enviarOtpEmail()` por uma função que chama `FIELDO.AuthEmail.sendMagicLink(email, redirectTo)` e processa callback
3. As funções `sendMagicLink` e `handleAuthCallback` ainda existem no `db.js` (mantidas para compat) — só precisam voltar a fazer o trabalho real.

Mas para a maioria dos casos, **OTP é mais simples e mais robusto** que magic link. Considere ficar com OTP mesmo em produção.
