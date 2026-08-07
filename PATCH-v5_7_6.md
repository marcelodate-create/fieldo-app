# PATCH v5.7.6 — Botões mortos na tela de recuperação

Relato: em aba anônima, ao tentar usar o código de recuperação, **nenhum
dos dois botões funcionou**.

## O que eu consegui e o que não consegui determinar

Testei `entrar.html` no harness e **todas as funções estão definidas**.
Em condições normais os botões funcionam. Não consegui reproduzir a
causa exata daqui — não tenho o console do seu aparelho.

Mas consegui identificar **por que a falha foi silenciosa**, e isso é o
problema mais grave dos dois.

## A causa estrutural

```js
(function () {
  'use strict';
  var Session = FIELDO.Auth.Session;   // ← PRIMEIRA linha
```

Se `db.js` não carregar — rede instável, download parcial, restrição da
aba anônima — `FIELDO` fica indefinido e essa linha lança
`ReferenceError`. O IIFE morre ali. **Nenhuma** função é definida.

Resultado: os `onclick` apontam para funções inexistentes, os botões
viram no-op, e a tela continua com aparência perfeita. Sem erro visível,
sem aviso, sem nada.

Numa tela de **recuperação de conta**, isso é o pior caso possível: a
pessoa toca, nada acontece, e conclui que perdeu os dados.

## Correções

**1. Guarda no início do IIFE.** Se `FIELDO` não existir, mostra uma
faixa vermelha com botão "Recarregar" em vez de falhar calado.

**2. Handler global de erro.** Qualquer exceção não tratada na tela passa
a aparecer, em vez de deixar botão morto.

**3. `onerror` no `<script src="db.js">`**, nas 12 páginas. É a única
forma de detectar falha de **rede** do script — o `try/catch` do
JavaScript não alcança, porque o script nunca chega a executar.

## A lacuna no meu processo

O contrato do smoke test para `entrar.html` estava **vazio**:

```js
entrar: [],
```

A tela de onboarding e recuperação de conta — a mais crítica do sistema,
onde o usuário pode perder tudo — não tinha **nenhuma** verificação. Eu
preenchi contrato para `index` e `servico`, e deixei esta em branco.

Agora tem 10 funções verificadas. Confirmado que reprova a regressão:

```
entrar        carregou, mas falta: recuperar
✗ 1 FALHA(S)
```

## Correção no próprio harness

`window.addEventListener` não existia no `dom-stub.js`. Qualquer página
que registrasse handler global de erro quebrava **no teste**, não no
browser — o tipo de falso negativo que faz desconfiar da suíte inteira.

## Para o próximo teste

Abra a aba anônima de novo. Se os botões continuarem inertes, agora deve
aparecer uma faixa vermelha explicando. Me diga o texto exato dela — aí
eu sei se é falha de rede, erro de script ou outra coisa.
