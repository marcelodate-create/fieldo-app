# PATCH v5.7.3 — Criação offline, verificada

Você escreveu: *"o importante é que offline ele funciona para criar
relatórios e orçamentos, isso já basta"*.

Concordo com o escopo. Mas como você passaria a **depender** disso, testei
antes de concordar. E encontrei um problema justo aí.

## O bug

`Reports.create()` guardava o registro **embrulhado**:

```js
LocalDB.put('reports', { data: data })   // { data: {...}, _localId, _syncStatus }
```

A lista concatenava isso com as linhas do servidor, que são **planas**:

```js
localOnly.concat(remote)   // formas diferentes, sem normalizar
```

Resultado: o relatório criado offline aparecia **em branco** na lista.
Nome do cliente, valor, data — tudo vazio.

O dado estava salvo e na fila de sincronização. Mas o profissional que
registra um serviço em obra, olha a lista e vê uma linha vazia conclui
que **perdeu o trabalho**. E o passo seguinte costuma ser refazer tudo,
gerando duplicata quando a rede voltar.

## Correção

`_normalizarLocal()` desembrulha e uniformiza as duas formas históricas,
preenchendo `id`, `created_at` e `_pendingSync`. Aplicado nos três pontos
onde registro local vira lista.

## Sinal visual

Item ainda não enviado agora mostra **⟳ não enviado** na lista. Sem isso,
o profissional não sabe que precisa pegar sinal em algum momento — e o
registro sumiria se ele limpasse os dados do navegador.

## Teste novo: `test/criar-offline.js`

Escrito **a partir da tela**, não da função — foi a lacuna que deixou
passar os três bugs anteriores. Sem rede desde o primeiro instante:

| Verifica | |
|---|---|
| `Reports.create` não rejeita | ✓ |
| devolve o dado digitado | ✓ |
| entra na fila de sincronização | ✓ |
| idem para `Budgets.create` | ✓ |
| **a lista mostra nome e valor** | ← era o que falhava |

## Suíte

```
node test/all.js
```

5 suítes: `smoke`, `outputs`, `pwa`, `offline`, `criar-offline`.

## O que continua fora do escopo

Por decisão sua, e concordo para agora:

- **Editar e excluir exigem rede.** Só a criação é offline.
- **Sem deduplicação entre dispositivos.** Mesmo serviço criado em dois
  aparelhos offline vira dois registros.
- Marcar como pago, aprovar orçamento e ativar Pro precisam de conexão.
