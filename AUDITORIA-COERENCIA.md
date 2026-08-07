# Auditoria de coerência — integridade referencial

## O que foi testado

Sete estados que o banco **aceitava** e não deveriam existir. Todos
reproduzidos antes de corrigir, todos reprovados depois.

## 🔴 Quatro vínculos entre contas diferentes

Um profissional podia apontar o próprio registro para o de **outro**:

| Cenário | Antes |
|---|---|
| relatório de A → orçamento de B | aceito |
| orçamento de B → relatório de A | aceito |
| avaliação atribuída ao profissional errado | aceito |
| obra de A com empreiteiro de B | aceito |

**Por que é grave:** o relatório público resolve o orçamento vinculado.
Apontar para o orçamento de um concorrente exporia nome de cliente e
valores dele numa página pública. Vazamento entre contas, sem invadir
nada — só trocando um id.

### Causa

FK simples garante que o id **existe**, não que **pertence ao mesmo
dono**. A RLS protege as linhas, mas não protege as referências entre
elas.

### Correção

Chave composta: referenciar `(id, professional_id)` em vez de `(id)`.
O Postgres passa a exigir que os dois lados tenham o mesmo dono.

Precisou de `UNIQUE (id, professional_id)` nas tabelas-pai — redundante
em teoria (o id já é único), necessário em prática para a FK composta.

## 🔴 Bug que EU introduzi, pego pelo teste

`ON DELETE SET NULL` numa FK **composta** anula **todas** as colunas da
referência — inclusive `professional_id`, que é `NOT NULL`.

Efeito: **apagar um orçamento vinculado quebrava** com erro de not-null.
Uma correção de segurança quebrando uma operação normal do dia a dia.

Corrigido com a sintaxe do Postgres 15+, que restringe quais colunas
anular:

```sql
on delete set null (linked_budget_id)
```

Registrado porque é exatamente a classe pedida — bug silencioso
introduzido por uma melhoria. Só apareceu porque o teste incluía a
limpeza dos dados no final.

## 🟠 Três estados incoerentes

**`valor` preenchido com `payment_status = 'nao_cobrado'`.** O relatório
sumia do painel financeiro: não contava como a receber nem como
recebido. R$ 500 desapareciam sem erro nenhum.

**`rating` sem `rating_used`.** A RPC faz os dois juntos; a constraint
garante que nenhum caminho futuro escreva só um.

**`rating_comment` sem `rating`.** Comentário sem nota.

Os três viraram CHECK constraints.

## Resultado

| # | Cenário | Depois |
|---|---|---|
| 1 | report A → orçamento B | recusado |
| 2 | orçamento B → report A | recusado |
| 3 | avaliação no profissional errado | recusado |
| 4 | valor com `nao_cobrado` | recusado |
| 5 | nota sem marcar usado | recusado |
| 6 | obra A com empreiteiro B | recusado |
| 7 | vínculo na mesma conta | **permitido** |
| 8 | valor com `pendente` | **permitido** |
| 9 | apagar orçamento vinculado | **permitido** |
| 10 | relatório sobrevive com link nulo | sim |

Os itens 7 a 10 existem para provar que a correção não quebrou o uso
normal — travar tudo seria fácil e inútil.

Suíte de código: 5/5 verdes. O app já gravava `payment_status` coerente
com o valor, então nada precisou mudar no cliente.

## Próximas frentes da auditoria

- **Fluxo de dados**: mapa de onde cada dado pessoal aparece
- **Clareza para o cliente**: termos como "SHA-256" e "hash" não
  significam nada para quem recebe o relatório
- **Integridade do profissional**: hoje não há como responder a uma
  avaliação injusta
- **Sintaxe e consistência**: padrões divergentes, código morto
