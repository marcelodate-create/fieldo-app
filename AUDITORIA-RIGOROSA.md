# Auditoria rigorosa — Fieldo (21/07/2026)

Executada contra o projeto real, não contra o código. Toda afirmação foi
verificada por teste.

---

## 🔴 CRÍTICO 1 — Qualquer usuário virava Pro sozinho

**O pior achado de todas as auditorias até agora.**

A policy `prof_update` permite editar a própria linha. RLS **não
distingue colunas**. Bastava:

```
PATCH /rest/v1/professionals?id=eq.<meu-uid>
{"plan":"pro","plan_expires_at":"2099-01-01"}
```

Pro liberado, de graça, para sempre. E como `private.is_pro()` lê
exatamente essas colunas, o módulo Contratos abria junto.

É a **mesma falha conceitual** do HMAC no cliente que eu critiquei na v4:
quem consome o direito não pode ser quem o concede. Eu movi o segredo
para o servidor e deixei a coluna aberta.

### Duas tentativas de correção falharam antes de acertar

**1ª — revoke de coluna sem revogar a tabela.** Em Postgres, `GRANT
UPDATE` no nível da tabela se sobrepõe: quem tem UPDATE na tabela altera
qualquer coluna. O revoke de coluna não teve efeito nenhum.

**2ª — gatilho `SECURITY DEFINER`.** Dentro dele, `current_user` é o
**dono da função**, não quem chamou. Minha verificação
`current_user in ('service_role', …)` era sempre verdadeira.

### Correção final

```sql
revoke update on public.professionals from authenticated, anon;
grant update (name, profissao, ..., is_public) on public.professionals to authenticated;
```

Mais gatilho `SECURITY INVOKER` como defesa em profundidade.

Verificado: autopromoção bloqueada, extensão de validade bloqueada,
edições legítimas funcionando, servidor ainda concede.

---

## 🔴 CRÍTICO 2 — O código de recuperação está em texto claro no banco

Falha de **desenho meu**, encontrada ao inspecionar o usuário restante.

A recuperação usa um e-mail sintético derivado do próprio código:

```
fd-6w1h8vss1p8kxtw8@device.fieldo.app
```

O código é `6W1H8VSS1P8KXTW8`. Ele está **legível em `auth.users.email`**.

Eu documentei em três patches que *"o servidor nunca vê o código em texto
claro"*. **Isso é falso.** Qualquer pessoa com acesso de leitura ao banco
— painel do Supabase, backup vazado, futuro funcionário — assume qualquer
conta.

**Risco hoje:** baixo, porque só você tem acesso ao projeto.
**Risco ao crescer:** alto. É a chave-mestra de todas as contas.

### Caminho de correção (não aplicado — muda o fluxo de login)

Trocar o e-mail derivado por um **identificador aleatório independente**,
guardando apenas `sha256(código)` numa tabela. A recuperação passa a ser
uma Edge Function que compara o hash e emite a sessão. O código deixa de
existir em qualquer lugar do servidor.

Não apliquei porque quebra a recuperação das contas atuais e você pediu
estabilidade. Fica como o próximo item de segurança.

---

## 🟠 Corrigido — função de gatilho exposta como API

`ativar_perfil_publico()` tinha `EXECUTE` para **PUBLIC**, `anon`,
`authenticated` e `service_role`, acessível em
`/rest/v1/rpc/ativar_perfil_publico`. Função de gatilho não deve ser
chamável por ninguém. Revogado.

## 🟠 Corrigido — `search_path` inconsistente

`submit_rating` tinha `search_path=public`, sem `pg_temp` ao final. Sem
ele, um objeto temporário criado pelo chamador pode sombrear um nome
resolvido dentro de uma função `SECURITY DEFINER`. Uniformizado nas três
RPCs.

---

## ✅ Verificado e correto

| | |
|---|---|
| 15 FKs | todas indexadas |
| Advisor de performance | zero WARN |
| `anon` lê professionals | 0 (nenhum público) |
| `anon` lê reports | só `is_public` |
| `anon` DELETE / UPDATE | 2 linhas → 2 linhas, nomes intactos |
| `anon` INSERT | bloqueado |
| `anon` forja avaliação | bloqueado |
| Usuário B lê privado de A | 0 linhas |
| B edita/cria como A | bloqueado |
| FREE grava Contratos | barrado pela RLS |
| PRO grava Contratos | funciona |
| RPC avaliar / replay | `ok` / `ja_avaliado` |
| RPC aprovar / replay | `ok` / `ja_decidido` |
| Gatilho `updated_at` | reescreve corretamente |
| Colunas lidas pelo código | todas existem no schema |
| `review_avg` | só em comentários |
| Suíte de testes | 5/5 verdes |

---

## Método: dois erros meus de teste, registrados

**1.** Medi "antes" como `anon` (contagem filtrada por RLS) e "depois"
como dono (sem filtro). Deu falso positivo de "DELETE funcionou".
Cometi o mesmo erro duas vezes nesta sessão.

**2.** Comparei `updated_at > created_at` dentro da mesma transação.
`now()` é fixo por transação, então dava sempre falso. O teste decisivo
foi jogar o campo para 2020 e ver o gatilho reescrever.

Registrado porque teste errado é pior que teste ausente: ele dá confiança
falsa nas duas direções.

---

## Estado final

Banco limpo. Resta **1 conta** — a sua, criada às 13:27. Sem relatórios,
orçamentos ou avaliações.

18 policies em `public`, 2 em `storage`, 6 funções em `public`.

## Pendências conhecidas, por escolha

- Código de recuperação em texto claro (crítico 2 acima)
- `update`/`delete` exigem rede
- Sem deduplicação entre dispositivos
- Sem service worker (removido na v5.9 por instabilidade)
