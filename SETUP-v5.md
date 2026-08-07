# Fieldo v5.0 — Setup

Ordem obrigatória. Pular um passo deixa o app num estado pior que a v4.

## 1. Painel do Supabase — Authentication

**Authentication → Providers → Anonymous sign-ins: ATIVAR.**
Sem isso o onboarding falha no primeiro toque.

**Authentication → Providers → Email → "Confirm email": DESATIVAR.**
O código de recuperação vincula um e-mail sintético
(`fd-<codigo>@device.fieldo.app`) que ninguém vai confirmar. Com a
confirmação ligada, o vínculo fica pendente e a recuperação não funciona.

**Authentication → Sessions → JWT expiry: 3600s** (padrão) está ok.
O refresh token não expira por inatividade, então o app volta do offline
sem pedir nada ao usuário.

## 2. SQL Editor — rodar na ordem

| # | Arquivo | O que faz |
|---|---------|-----------|
| 1 | `sql/100_reset.sql` | **APAGA TUDO.** Derruba o schema v4. |
| 2 | `sql/101_schema.sql` | Tabelas, constraints, índices, view pública. |
| 3 | `sql/102_rls.sql` | Policies reais. Fim do `USING true`. |
| 4 | `sql/103_storage.sql` | Buckets com escrita restrita à pasta do uid. |
| 5 | `sql/104_rpc_rating.sql` | Avaliação do cliente, atômica. |

## 3. Edge Function

```bash
supabase secrets set FIELDO_LICENSE_SECRET="<segredo novo, 32+ chars>"
supabase functions deploy license
```

> Gere um segredo **novo**. O da v4 (`FIELDO_LICENSE_HMAC_v4_2026`) está
> publicado no bundle antigo — trate-o como comprometido e reemita todas
> as licenças Pro já distribuídas.

## 4. Teste de aceite da RLS

Este é o teste que a v4 reprovava. Rode com a anon key pura:

```bash
curl "https://<projeto>.supabase.co/rest/v1/reports?select=*" \
  -H "apikey: <ANON_KEY>"
```

**Esperado:** apenas relatórios com `is_public = true`.
**Se voltar a base inteira ou permitir DELETE, pare — a RLS não subiu.**

```bash
# Deve retornar 401/403, nunca 204
curl -X DELETE "https://<projeto>.supabase.co/rest/v1/reports?id=neq.0" \
  -H "apikey: <ANON_KEY>"
```

## 5. Deploy

`netlify deploy --prod`. Sem build step — o projeto continua sendo HTML
estático + um `db.js`.
