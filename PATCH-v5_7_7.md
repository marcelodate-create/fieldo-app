# PATCH v5.7.7 — Perfil público

A página que você chamou de mais importante tinha dois defeitos, e o
segundo tornava ela inútil para o propósito dela.

## 🔴 1. O perfil nunca ficava público

`entrar.html` cria o profissional com:

```js
is_public: false,  /* entra no marketplace após 3 serviços */
```

**Nenhuma linha do código jamais fazia isso.** A função que ativaria não
foi escrita — só o comentário.

Consequência: todo perfil ficava privado para sempre. Você via a própria
página normalmente (a RLS permite ler o próprio perfil), tocava em
"Compartilhar", mandava o link — e o cliente **não via nada**. A página de
vitrine do produto não funcionava para visitante nenhum.

### Correção: gatilho no banco

A regra passou a viver no Postgres, não no cliente. Assim não depende do
app estar aberto, não pode ser burlada e vale para qualquer origem.

```sql
create trigger trg_ativar_perfil
  after insert or update of is_public on public.reports
  for each row execute function public.ativar_perfil_publico();
```

Publica ao atingir **3 serviços públicos**, e só se nome, profissão e
cidade estiverem preenchidos — perfil vazio no marketplace é pior que
nenhum. Testado: `false` → `false` → `true` no terceiro.

### Aviso para o dono

Você não tinha como saber. Agora, enquanto o perfil não estiver público,
aparece um aviso — **só para o dono** — dizendo quantos serviços faltam e
avisando que o link compartilhado ainda não abre para o cliente.

## 🟠 2. Score em branco com 2 avaliações

A página lia `prof.review_avg`. Essa coluna **não existe** no schema v5 —
era campo desnormalizado da v4 que eu não recriei na migração.

`undefined` → `0` → mostra "—". Enquanto isso, a contagem de avaliações
vinha de outra consulta e aparecia normal. Daí a contradição na tela:
**"2 avaliações" com score vazio**.

O banco tinha o dado certo o tempo todo: média 5,0.

Corrigido calculando a partir das próprias avaliações já carregadas.
Elimina a desnormalização — não existe mais um segundo lugar para
dessincronizar.

### O mesmo bug ia para o Google

O JSON-LD publicava `ratingValue: "0.0"` nos resultados de busca. Nota
zero é **pior que nota nenhuma**: o Google trata rating inválido como
sinal negativo e pode desqualificar o rich result inteiro.

Agora calcula das avaliações reais, inclui `bestRating`/`worstRating`, e
**omite** o bloco quando não há avaliação — que é o correto pelo
schema.org.

## Observação, não corrigida

Sua profissão está gravada como **"Elétricista"**. A grafia correta é
**"Eletricista"** (sem acento). Não alterei porque é dado seu — mas
aparece no título da página, no JSON-LD e nas buscas.

## Ainda a melhorar nesta página

Ficam anotados para a próxima:

- "2 SERVIÇOS" e o score aparecem duas vezes (hero e grade)
- A grade de estatísticas tem uma célula vazia
- Sem foto de serviço na vitrine — hoje o cliente não vê trabalho nenhum
