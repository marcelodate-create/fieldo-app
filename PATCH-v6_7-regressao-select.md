# PATCH v6.7 — Perfil ficava carregando para sempre

Regressão que **eu introduzi na v6.5**.

## Causa

Na v6.5 revoguei colunas sensíveis do `anon` (`rating_token`,
`approval_token`, telefone, e-mail) usando privilégio de coluna.

O que não previ: o PostgREST monta **`SELECT *`** quando a chamada não
lista colunas. E no Postgres, `SELECT *` exige privilégio em **todas** as
colunas da tabela. Faltando uma, a consulta **inteira** falha:

```
ERRO: permission denied for table professionals
```

Não é "vem sem a coluna" — é "não vem nada".

Quebrou toda leitura pública sem `select=`: **perfil, relatório, busca,
verificação**. A página disparava o fetch, recebia erro, e o estado de
carregamento nunca saía.

## Por que os testes não pegaram

A suíte roda com `fetch` simulado. Ela prova que o **código** funciona;
não fala com o PostgREST real, então não viu a diferença entre `SELECT *`
e lista explícita.

Foi preciso consultar o banco de verdade para encontrar. É o mesmo padrão
de várias falhas desta sessão: **o dado real denuncia o que o código
esconde.**

## Correção

Lista de colunas públicas por tabela, num **lugar só** (`db.js`), e
injeção automática do `select=` nas leituras públicas.

Espalhar `select=` por dezenas de chamadas funcionaria — e falharia na
primeira que alguém esquecesse. Centralizado, o padrão passa a ser
**"privado até que se decida o contrário"**: coluna nova só vira pública
se for adicionada à lista.

Views ficam de fora (não têm colunas revogadas). Chamadas que já trazem
`select=` são respeitadas.

Também corrigidas as páginas com `fetch` cru: `perfil.html`,
`relatorio.html`, `verificar.html`.

## Verificado no banco

| Consulta como `anon` | |
|---|---|
| perfil público (colunas do app) | 2 linhas |
| relatórios públicos | 6 linhas |
| avaliações | 3 linhas |
| hashes | 0 linhas (tabela vazia) |
| marketplace (view) | 2 linhas |
| `rating_token` ainda oculto | sim |

## Teste que trava a regressão

`test/outputs.js` verifica que cada tabela sensível recebe `select=`, que
os tokens **não** entram na lista, que views não recebem select
desnecessário e que um `select=` já informado é respeitado.

Confirmado que reprova:

```
✗ injeta select em /professionals
✗ injeta select em /reports
✗ injeta select em /budgets
```

## Lição

Privilégio de coluna em Postgres não degrada — **corta**. Ao revogar
qualquer coluna de um papel, toda consulta `SELECT *` daquele papel
morre. Se for revogar coluna, é preciso garantir na mesma mudança que
ninguém faz `SELECT *`.
