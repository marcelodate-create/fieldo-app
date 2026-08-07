# Rollback v5.0 → v4.4

**Não há rollback de dados.** O `100_reset.sql` é destrutivo e foi
autorizado como tal. Este documento cobre só o rollback de código.

## Se a v5 falhar em produção

1. `netlify rollback` para o deploy anterior (ou redeploy da tag v4.4).
2. O schema v5 **não é compatível** com o `db.js` da v4: `professionals.id`
   agora referencia `auth.users`, e a v4 inseria perfis com uuid próprio.
   Voltar o front sem voltar o banco gera erro de foreign key no cadastro.
3. Para voltar de verdade, é preciso rodar `100_reset.sql` e recriar o
   schema v4 a partir do `MIGRACAO.md` antigo.

## Falhas parciais mais prováveis

| Sintoma | Causa | Correção |
|---|---|---|
| Onboarding trava em "Criando…" | Anonymous sign-ins desativado | Ativar no painel Auth |
| Código de recuperação não funciona | "Confirm email" ligado | Desativar em Auth → Providers → Email |
| Listas vazias para o próprio dono | `102_rls.sql` não rodou, ou rodou antes do schema | Rodar na ordem 101 → 102 |
| Contratos recusa gravar | `is_pro()` false — licença não ativada | Ativar via Edge Function |
| Upload de foto retorna 403 | `103_storage.sql` não rodou | Rodar o script |
| Ativação Pro retorna `server_error` | `FIELDO_LICENSE_SECRET` não setado | `supabase secrets set` |

## Rollback só da Edge Function

A licença é o componente mais isolado. Se a function falhar, o app
continua funcionando em modo free — nenhuma outra tela depende dela.
