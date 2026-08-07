# v5.9 — Service worker removido

## O que motivou

Quatro falhas seguidas em produção, todas da mesma origem:

| Sintoma | Causa |
|---|---|
| Foto de perfil sumia offline | Storage público excluído do cache |
| Dados sumiam ao atualizar | `Promise.all` derrubado por uma fonte sem fallback |
| "Pesquisar" voltava pra tela inicial | Precache incompleto + fallback servindo index.html |
| Relatório não abria | Chave de cache incluía a query string |

A raiz é a mesma nas quatro: **eu tratei cache como configuração, não
como código**. Escrevi 200 linhas com regras sutis de roteamento e
validei com asserções de texto, não com comportamento. Os testes que
teriam pego isso só foram escritos *depois* de cada falha.

O ganho — abrir sem rede — não pagou o custo.

## O que foi feito

**`sw.js` virou kill-switch, não foi apagado.**

Este ponto é importante: um service worker já instalado **continua
rodando mesmo que o arquivo suma do servidor**. Apagar deixaria a versão
com bug viva no aparelho, para sempre, sem forma de corrigir.

O novo `sw.js` se desregistra, apaga todos os caches e recarrega as abas.
**Manter publicado por algumas semanas**, até todos os aparelhos passarem
por ele ao menos uma vez.

## O que NÃO foi perdido

- **Instalação na tela inicial** continua funcionando (é o `manifest.json`,
  independente do service worker)
- **Offline de dados** continua: criar relatório e orçamento sem rede,
  fila de sincronização, cache de listas no IndexedDB
- Todas as correções de segurança, Pix, valor, aprovação de orçamento,
  galeria e privacidade permanecem

## O que muda na prática

O app passa a precisar de rede para **abrir**. Uma vez aberto, continua
funcionando offline como antes.

## Por que não voltamos ao v4

O banco foi migrado para o modelo v5 — identidade por `auth.uid()`, RLS
real por usuário. O código v4 esperava um banco sem autenticação e com
`USING (true)` em todas as policies.

Reverter só o código quebraria tudo; reverter o banco junto significaria
reabrir o buraco de segurança original, em que qualquer pessoa com a anon
key apagava a base inteira.

Uma cópia do estado anterior ficou em `v5-backup/` caso a decisão seja
revista.

## Suíte

```
node test/all.js
```

5 suítes: `smoke`, `outputs`, `offline`, `criar-offline`, `timeout`.
`pwa.js` e `sw-rotas.js` ficaram no repositório, fora da execução.
