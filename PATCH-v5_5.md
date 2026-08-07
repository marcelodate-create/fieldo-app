# PATCH v5.5 — Bloco 2 completo: orçamento aprovado vira serviço

## O que entrou

`servico.html?orc={id}` preenche cliente, local, descrição e valor a
partir do orçamento, e já deixa os dois vinculados. No painel, orçamentos
**aprovados e ainda sem serviço** ganham um botão ▶ que leva direto para lá.

O botão some sozinho depois que o serviço é criado — a condição é
`status === 'aprovado' && !linked_report_id`.

## Decisões

**Não chuta a categoria.** Um orçamento de "reforma" pode virar serviço de
elétrica ou de alvenaria. Adivinhar errado é pior que deixar em branco: o
profissional confirmaria sem ler. A categoria continua sendo escolha
explícita.

**Não sobrescreve o que já foi digitado.** `setSeVazio()` só preenche
campo vazio. Voltar para a tela não apaga o que a pessoa escreveu.

**Checagem de dono.** `Budgets.getById` é leitura pública (o cliente
também abre o link do orçamento). Sem verificar `professional_id ===
auth.uid()`, daria para preencher um serviço com dado de orçamento alheio
trocando o id na URL. A verificação é feita antes de qualquer preenchimento.

**Rascunho é pulado quando vem de `?orc=`.** A restauração de rascunho
sobrescreveria o preenchimento — o campo voltaria ao valor antigo sozinho,
sem erro nenhum. Bug silencioso clássico.

## 🔴 Bug meu, da v5.4, encontrado aqui

A constraint `chk_decisao_tem_data` (que EU adicionei no patch anterior)
estava certa numa metade e errada na outra:

```sql
-- v5.4 (errado)
(status in ('aprovado','recusado') and approved_at is not null) or
(status not in ('aprovado','recusado') and approved_at is null)
```

O ciclo real é **aprovado → concluido**, e o concluido precisa preservar a
data da aprovação. Como `servico.html` faz `status:'concluido'` ao
vincular, **todo orçamento aprovado quebraria ao virar serviço**.

Pior: falharia só no momento do uso real, com o profissional na frente do
cliente. Não apareceu no smoke test porque é regra de banco, não de
JavaScript.

```sql
-- v5.5 (correto)
status not in ('aprovado','recusado') or approved_at is not null
```

Encontrado porque o teste de integração no banco simula a transição
inteira, não só cada operação isolada.

## Testado

| Cenário | Resultado |
|---|---|
| cliente aprova pelo link | ok |
| aprovado → concluido | passa (quebrava antes) |
| data da aprovação preservada | sim |
| serviço preenchido do orçamento | cliente, local, R$ e status corretos |
| vínculo bidirecional | os dois lados |
| botão ▶ some após criar o serviço | some |
| aprovado sem data | ainda recusado |
| smoke test das 13 páginas | 31 verificações ok |

## Ainda aberto

- 55 usos de `innerHTML` (Bloco 3)
- Service worker / PWA de fato (Bloco 3)
- Offline para `update`/`delete` (Bloco 3)
- Notificação real de aprovação (hoje é WhatsApp manual)
