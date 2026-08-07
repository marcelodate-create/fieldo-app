# Auditoria completa — Fieldo v5.0 (20/07/2026)

Executada contra o projeto real (`jrsctnncoljdcvdofxsg`), não contra o código.
Toda afirmação abaixo foi verificada por teste, não por leitura.

## 🔴 Falhas críticas encontradas E corrigidas

### 1. Fábrica aberta de licenças Pro (`codes.html`)
A página de emissão ia deployada publicamente no Netlify. Continha o segredo
HMAC (reconstruído em 3 linhas de Base64) **e** a senha de admin — esta última
documentada em comentário no próprio arquivo (`fieldo2026`).

Quem achasse `/codes.html` emitia licenças vitalícias ilimitadas.

Pior que a falha equivalente da v4: aquela permitia *forjar*; esta era a
ferramenta oficial de *cunhagem*, com a chave dentro.

**Correção:** arquivo removido do projeto. Emissão movida para a Edge Function
`license-issue`, autorizada por `x-admin-key` (env var, comparação em tempo
constante, atraso fixo em falha). Bloqueio no `netlify.toml` como defesa em
profundidade.

### 2. Storage continuava aberto para escrita anônima
Duas policies sobreviveram ao meu próprio script de limpeza:
`avatars_public_insert` e `avatars_public_update`, ambas para o role `public`
com check apenas de `bucket_id`.

Causa: no `103_storage.sql` eu **adivinhei** os nomes das policies antigas em
vez de enumerá-las. O bug que declarei corrigido seguia vivo — qualquer um
sobrescrevia a logo de qualquer profissional.

**Correção:** limpeza por enumeração dinâmica (`pg_policies`), não por nome.
Somam-se limites de upload (5 MB) e MIME restrito a JPEG/PNG/WebP — sem isso,
um cliente adulterado subiria um `.html` executável servido do nosso domínio.

### 3. Funções de autenticação paralela ainda publicadas
`f5_login(text,text)` e `f5_signup(...)`, `SECURITY DEFINER`, executáveis por
`anon` via `/rest/v1/rpc`. Um mecanismo de login com PIN de iteração anterior,
esquecido e exposto. Mais `rls_auto_enable()`, chamável por qualquer um.

**Correção:** removidas, junto de 9 tabelas órfãs (`f5_*`, `otp_sessions`,
`payments`, `subscriptions`, `plans`, `signatures`) — todas vazias.

### 4. Listagem de buckets públicos
`av_read`/`ph_read` permitiam **listar** todos os arquivos, ou seja, enumerar
as fotos de todos os clientes de todos os profissionais.

**Correção:** removidas. Buckets públicos servem por `/object/public/...` sem
passar por RLS, então a leitura por URL continua funcionando.

## 🟠 Escalabilidade — corrigido

`auth.uid()` era reavaliado **por linha** em todas as 12 policies. Numa tabela
com 50 mil relatórios, 50 mil chamadas por query. Envolvido em `(select ...)`
para virar initplan (uma vez por query).

Policies `SELECT` duplicadas (dono + público) fundidas em uma só com `OR`: o
Postgres executava as duas em toda leitura. `FOR ALL` foi quebrado em
INSERT/UPDATE/DELETE explícitos, já que `FOR ALL` inclui `SELECT`.

Índices adicionados nas FKs `empreitadas.empreiteiro_id` e
`work_entries.empreiteiro_id` — sem eles, deletar um empreiteiro fazia seq scan.

Resultado: **zero WARN** no advisor de performance.

## ✅ Bateria de segurança — resultados

| Cenário | Resultado |
|---|---|
| ANON lê relatórios | só os `is_public` |
| ANON apaga relatórios | 0 linhas |
| ANON insere relatório | bloqueado |
| ANON forja avaliação direto na tabela | bloqueado |
| ANON faz upload no Storage | bloqueado |
| ANON lista bucket | 0 arquivos |
| Usuário A grava na pasta de B | bloqueado |
| Usuário A edita perfil de B | 0 linhas |
| FREE grava em Contratos | barrado pela RLS |
| PRO grava em Contratos | funciona |
| Dono lê próprio privado + públicos alheios | correto |
| RPC: avaliação válida | ok |
| RPC: replay do mesmo token | `ja_avaliado` |
| RPC: token inexistente | `nao_encontrado` |
| RPC: nota fora de 1–5 | `nota_invalida` |

## ⚠️ Duas correções que eu mesmo introduzi e revertei

Registrado porque explica decisões que parecem estranhas no SQL:

1. Revoguei `EXECUTE` de `is_pro` do role `authenticated` para atender o
   advisor. **Isso quebrou as policies de Contratos** — expressões de policy
   são avaliadas com o privilégio do chamador. Solução correta: mover a função
   para o schema `private`, que o PostgREST não expõe. Some da API, continua
   funcionando nas policies.

2. Meus dois primeiros testes davam falso positivo *e* falso negativo:
   `insufficient_privilege` (42501) é o mesmo código de violação de RLS, e um
   DELETE barrado por RLS **não gera erro** — apenas afeta zero linhas. Testes
   de RLS precisam comparar contagem antes/depois, não capturar exceção.

## 🟡 Aberto — não resolvido nesta fase

Por escolha de escopo, não por descuido:

- **Offline-first cobre só `create`.** `update`/`delete` exigem rede.
- **Sem deduplicação entre dispositivos** na fila de sincronização.
- **Sem service worker** — não é PWA de fato; não abre com a rede totalmente
  fora se o cache do navegador for limpo.
- **55 usos de `innerHTML`** nas páginas. Superfície de XSS: hoje o conteúdo
  vem do próprio usuário, mas nome de cliente e comentário de avaliação vêm de
  terceiros e são renderizados. Auditoria dedicada pendente.
- **Sem testes automatizados nem CI.** Toda a validação acima foi manual.
- **CSS duplicado** em cada página.
- **Sem rate limit próprio** na `license-issue` além do atraso fixo.

## Pendências de configuração (painel)

1. `FIELDO_LICENSE_SECRET` — valor **novo**. O da v4 está publicado.
2. `FIELDO_ADMIN_KEY` — para emitir licenças.
3. Reemitir toda licença Pro já distribuída com o segredo antigo.
4. Opcional: *Leaked password protection* (HaveIBeenPwned) no Auth.
