# PATCH v5.0 — Identidade real e RLS

## O problema que isto resolve

A v4 tinha duas falhas estruturais, ambas com a mesma causa raiz.

**1. O banco estava aberto.** RLS ligada, mas com `USING (true)` em todas
as tabelas. Como a anon key é necessariamente pública, qualquer pessoa
com o DevTools lia, alterava e apagava a base inteira com um `curl`.

**2. A licença Pro era decorativa.** O segredo HMAC morava no `db.js`,
ofuscado em Base64. Qualquer usuário emitia licença vitalícia.

A causa comum: a v4.0 removeu o Supabase Auth. Sem JWT, não existe
`auth.uid()`; sem `auth.uid()`, não existe policy que separe um
profissional do outro. O `USING (true)` não foi descuido — foi a única
saída possível depois daquela remoção.

## A decisão de arquitetura

**Anonymous Auth**, não login. `signInAnonymously()` cria um usuário real
em `auth.users` — com uuid e JWT assinado — **sem e-mail, sem senha, sem
tela de login**. A fricção para o profissional continua zero: um toque.

Autenticação e offline nunca foram opostos. Um JWT é texto no
dispositivo. O que a v4 trocou por "simplicidade" não foi a fricção do
login — foi a possibilidade de ter autorização.

`professionals.id` passou a ser **o próprio `auth.uid()`**. É essa
igualdade que torna toda policy escrevível:

```sql
create policy rep_all_own on public.reports
  for all to authenticated
  using (professional_id = auth.uid());
```

## Mudanças

### Segurança
- Todo request autenticado leva o JWT. `_req` resolve o token antes de
  montar o header; páginas públicas pedem `{ anon: true }` explicitamente
  para não vazar o JWT do dono numa página compartilhada por link.
- Segredo da licença movido para a Edge Function `license`. O cliente
  manda o token, o servidor valida e grava `plan='pro'` no banco.
- **A trava do Pro virou uma policy.** As tabelas de Contratos exigem
  `is_pro(auth.uid())`. Adulterar o localStorage agora pinta um badge
  dourado e mais nada — o Postgres recusa a linha.
- Storage: upload restrito à pasta `<uid>/`. Antes, qualquer um
  sobrescrevia a logo de qualquer profissional.

### Correções de consistência
- **Avaliação do cliente virou RPC transacional.** A v4 fazia PATCH no
  relatório e depois INSERT na avaliação, com rollback manual. Se o
  navegador fechasse entre os dois, o relatório ficava marcado como
  avaliado sem avaliação — irreversível pelo usuário. Agora é uma
  transação com `FOR UPDATE`.
- Abrir INSERT anônimo em `avaliacoes` deixaria qualquer visitante forjar
  nota em qualquer relatório. A RPC valida o `rating_token` (96 bits)
  dentro do servidor; não há escrita anônima direta em lugar nenhum.
- `LocalDB.wipe()` no logout. Antes, os dados do profissional anterior
  ficavam no IndexedDB para o próximo usuário do aparelho.

### Onboarding
- `entrar.html` deixou de ser login e virou onboarding. Sumiram telefone,
  OTP e a dependência de SMS.
- **Código de recuperação de 16 caracteres** (~80 bits), gerado no
  dispositivo. Vincula um e-mail sintético derivado do próprio código, de
  modo que a recuperação exige só o código — o profissional não precisa
  decorar uuid nenhum. Os CTAs finais ficam bloqueados até a confirmação
  explícita de que o código foi salvo: fricção deliberada, porque perder
  esse código é perder a conta.

## O que NÃO mudou

Cerca de 80% do código está intacto. `Auth.getId()` e `Auth.isLoggedIn()`
mantiveram a assinatura **síncrona** de propósito — as oito páginas fazem
`if (!Auth.isLoggedIn()) redirect` no topo do script, e tornar isso async
quebraria todas de uma vez. O bootstrap assíncrono acontece só no
onboarding. LocalDB, SyncEngine, Draft, o resolver de QR e o design
system não foram tocados.

## Limitações assumidas

- **O primeiro boot exige internet, uma vez.** Não há como emitir
  identidade verificável offline. Depois disso, o app abre e opera
  desconectado normalmente.
- **Perder o código de recuperação é perder a conta.** É o preço de não
  pedir e-mail nem telefone. Vincular e-mail opcional depois do
  onboarding é uma evolução natural — nunca como barreira de entrada.
- A ativação do Pro precisa de rede. É uma operação rara; resolver isso
  offline exigiria confiar no cliente, que é exatamente o erro da v4.

## Não resolvido nesta fase

Continuam abertos, por escolha de escopo: offline-first cobre `create`
mas não `update`/`delete`; não há deduplicação entre dispositivos; não há
service worker, então ainda não é PWA de fato; o CSS está duplicado nas
páginas; não há testes nem CI.
