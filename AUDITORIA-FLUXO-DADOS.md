# Auditoria de fluxo de dados — o que sai do aparelho

## O princípio que estava sendo violado

**A RLS controla LINHAS, não COLUNAS.** Se a linha é visível para o
público, *todas* as colunas vão junto — inclusive as que existem só para
uso interno.

Eu tinha construído dois fluxos baseados em token secreto e guardado os
segredos em colunas que o público lê.

## 🔴 CRÍTICO 1 — Token de avaliação exposto

`reports.rating_token` era legível por `anon`.

Esse token é a **credencial** que autoriza avaliar um relatório. Estando
legível, bastava:

```
GET /rest/v1/reports?select=rating_token&is_public=eq.true
```

...para obter o token de **todos** os relatórios públicos e forjar nota
1 ou 5 em massa. A RPC `submit_rating` validava o token corretamente —
mas o token era público.

## 🔴 CRÍTICO 2 — Token de aprovação exposto

`budgets.approval_token`, mesma coisa. Qualquer um podia **aprovar ou
recusar** o orçamento de qualquer profissional. Um concorrente recusaria
todos os seus orçamentos em lote.

Anulava por completo o fluxo de aprovação da v5.4.

## 🟠 Dados pessoais expostos sem necessidade

| Coluna | Problema |
|---|---|
| `budgets.client_phone` | telefone de terceiro, público |
| `professionals.phone` | contato interno; o canal público é o whatsapp |
| `professionals.email` | idem |

## Correção

**1. Privilégio de coluna para SELECT.** Revogar a tabela e conceder
coluna a coluna — revogar coluna sobre um GRANT de tabela não tem efeito
(lição repetida da correção do `plan`).

**2. Leitura por token via RPC.** `report_por_token` e
`orcamento_por_token` são `SECURITY DEFINER`: leem a linha ignorando RLS
e devolvem os campos que o cliente precisa **sem o token**. O link
continua abrindo; o segredo não volta na resposta nem é listável.

**3. Formulário de avaliação exige token.** Abrir por `?id=` mostra o
relatório mas não permite avaliar. Sem esta checagem o formulário
apareceria e o envio falharia **em silêncio** — o cliente escolheria as
estrelas, tocaria em enviar e nada aconteceria.

## Verificado

| # | Cenário | |
|---|---|---|
| 1 | anon lê `rating_token` | oculto |
| 2 | anon lê `approval_token` | oculto |
| 3 | anon lê telefone do cliente | oculto |
| 4 | anon lê phone/email do profissional | oculto |
| 5 | anon lê o relatório público | funciona |
| 6 | anon lê whatsapp/pix | funciona |
| 7 | RPC abre relatório pelo token | funciona |
| 8 | RPC devolve o token junto? | não |
| 9 | RPC abre orçamento pelo token | funciona |
| 10 | RPC devolve `approval_token`? | não |
| 11 | dono lê o próprio `rating_token` | funciona |
| 12 | dono lê o próprio `approval_token` | funciona |

Os itens 5, 6, 11 e 12 existem para provar que o uso legítimo não
quebrou.

## Mapa final — o que o público enxerga

**Relatório público:** cliente (nome curto), categoria, data, cidade,
descrição, fotos, valor, situação de pagamento, nota.
**Não expõe:** token, telefone do cliente.

**Perfil público:** nome, profissão, cidade, whatsapp, bio, foto, Pix,
avaliações (avaliador com nome curto), galeria (só com consentimento).
**Não expõe:** telefone interno, e-mail.

**Marketplace:** nome, profissão, cidade, nota, uma foto de capa (só com
consentimento).

## Pendência conhecida

A chave Pix é pública por necessidade — é como o cliente paga. Para
CPF/CNPJ isso significa expor o documento. Uma chave aleatória evita
isso, e vale sugerir ao profissional no cadastro.
