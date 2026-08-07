# PATCH v5.3 — Bloco 1: o dinheiro

## O problema

`servico.html` tinha o campo **"Valor cobrado (opcional)"**, com a legenda
*"Não aparece no relatório — apenas nos seus registros"*.

O campo era lido **zero vezes** no código. Não ia para o banco, não existia
coluna `valor` em `reports`, não aparecia em relatório nenhum. O profissional
digitava e o número evaporava — inclusive dos "seus registros" que a tela
prometia.

Consequência: era **impossível** responder "quanto eu faturei?". Não havia
relatório financeiro porque não havia dado financeiro. Isso bloqueava tudo
que o Bloco 1 pretendia entregar.

## Banco

```sql
alter table reports
  add column valor          numeric(12,2) check (valor >= 0),
  add column payment_status text not null default 'nao_cobrado',
  add column paid_at        timestamptz;
```

Duas constraints, ambas testadas:

- `valor >= 0` — valor negativo é recusado
- `chk_pago_tem_data` — `pago` **exige** `paid_at`; qualquer outro status
  **exige** `paid_at IS NULL`

A segunda existe porque "pago sem data de pagamento" é um estado impossível
que apareceria em qualquer relatório financeiro futuro. Garantido pelo
Postgres, não pelo JavaScript: o front pode ter bug, a constraint não.

Índice parcial `idx_rep_pagamento` para o painel "a receber", ignorando os
registros sem cobrança.

## PIX Copia e Cola (BR Code / EMV)

Antes o relatório mostrava só a chave. O cliente abria o banco, colava a
chave, **digitava o valor**, conferia e pagava — 5 passos, com a digitação
como ponto de erro.

Agora o `FIELDO.Pix` gera a string do padrão do Banco Central **com o valor
embutido**. Colar e pagar.

- CRC16-CCITT validado contra implementação independente
- Campos EMV decodificados um a um na verificação
- Acentos removidos do nome/cidade (banco recusa BR Code com acento)
- Normalização por tipo de chave: CPF/CNPJ só dígitos, telefone com `+55`,
  e-mail em minúsculas, chave aleatória como está
- `validate()` recusa chave malformada **antes** de gerar — BR Code inválido
  é pior que nenhum: o cliente cola, o banco recusa, e ele conclui que o
  profissional é golpe
- Funciona offline; vai embutido no HTML do relatório

**Limite honesto:** PIX estático não notifica o recebimento. Saber que o
cliente pagou depende do botão manual ou de um PSP — fora deste bloco.

## Relatório do cliente

Três estados, mutuamente exclusivos:

| Situação | O que aparece |
|---|---|
| valor + a receber + Pix válido | botão "Copiar código Pix" com valor |
| valor + já pago | selo verde "✓ Pago", sem cobrança |
| valor sem Pix utilizável | só o valor |
| sem valor | nada (comportamento antigo) |

Decisão a contestar se discordar: o bloco de Pix **some** quando o serviço
está pago. Pedir pagamento de algo já pago confunde. Se preferir sempre
mostrar o valor, é uma linha.

## Painel

Cartão **A receber / Recebido no mês**, que **desaparece quando não há
movimento** — um cartão "R$ 0,00" todo dia treina o usuário a ignorar a área.

Na lista de serviços: valor inline e botão `R$` para marcar recebido sem
abrir o relatório. Delegação de evento no container, porque a lista é
recriada a cada render e listener por botão vazaria.

## Correções de passagem

1. **Injeção via atributo.** `onclick="copiarPix('CHAVE')"` colocava a chave
   dentro de um atributo HTML. Chave com aspas quebrava o atributo. Trocado
   por `data-attribute` + listener registrado após o `innerHTML`.

2. **Botão quebrado em iOS antigo.** O copiar dependia só da Clipboard API,
   ausente em WebViews e iOS antigo — justamente aparelhos de campo. Era o
   botão principal do relatório. Adicionado fallback `execCommand` e, em
   último caso, `prompt`.

3. **Erro de ponto flutuante.** Somar valores em float acumula desvio
   (`0.1 + 0.2 = 0.30000000000000004`). As métricas arredondam ao centavo.

4. **Feedback invisível.** O toast some no sol. O botão agora muda para
   "✓ Copiado! Cole no seu banco" por 2,6s.

## Testado

| Cenário | Resultado |
|---|---|
| pago sem data | recusado pelo banco |
| pendente com data | recusado pelo banco |
| valor negativo | recusado |
| soma a receber (2 serviços) | R$ 530,50 exato |
| marcar 1 como pago | a receber cai para R$ 180,50 |
| serviço sem valor | fica fora de ambas as somas |
| CRC16 vs implementação independente | idêntico |
| campos EMV decodificados | todos corretos |

## Não incluído

- Notificação de pagamento (exige PSP)
- Recibo em PDF
- Edição do valor depois de criado o serviço
- Cobrança parcial / sinal de entrada
