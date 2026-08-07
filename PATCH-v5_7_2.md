# PATCH v5.7.2 — Por que os dados ainda sumiam

## O erro do meu diagnóstico anterior

Na v5.7.1 adicionei cache offline em `Reports.list()` e `Budgets.list()`,
testei cada função isolada, vi tudo verde e declarei resolvido.

O painel continuou vazio. A causa era um nível acima:

```js
return Promise.all([
  FIELDO.Reports.stats(),
  FIELDO.Reports.recent(5),
  FIELDO.Hashes.list(3),        // ← sem fallback
  FIELDO.Budgets.list(5).catch(...),
]);
```

`Promise.all` é **tudo-ou-nada**. Bastava `Hashes.list` rejeitar para o
`.then` inteiro ser pulado — e **nenhum** render rodava. O cache estava
cheio, os dados estavam lá, e a tela ficava vazia mesmo assim.

Meus testes passavam porque testavam cada função **isolada**. O bug só
existe na **composição**.

## Correções

**1. `Hashes.list` com `.catch`.** Hash é informativo; nunca deve impedir
o resto da tela de aparecer.

**2. Cada fonte com seu próprio fallback.** Num painel, falha parcial
deve degradar a seção, não a tela inteira.

**3. Cada render isolado em `try/catch`.** Um erro de layout numa seção
não pode impedir as outras de aparecerem.

## Teste novo, e a prova de que ele serve

`test/offline.js` cenário 5 reproduz o painel completo offline —
`Promise.all` com as quatro fontes, exatamente como `index.html` chama.

Verifiquei que o teste **falha** com o bug reintroduzido e **passa** com
a correção:

```
--- com o bug de volta ---
  ✗ hashes não rejeita offline
  ✗ Promise.all do painel sobrevive offline
✗ 2 falha(s)

--- corrigido ---
✓ offline funciona
```

Um teste que passa antes e depois da correção não prova nada. Este
reprova o bug.

## Lição de processo

Três rodadas, três lacunas diferentes na minha rede de testes:

| Rodada | O que passou batido | Teste criado |
|---|---|---|
| WhatsApp | código carrega, resultado é lixo | `outputs.js` |
| offline v1 | função isolada funciona | `offline.js` |
| offline v2 | **composição** falha | cenário `Promise.all` |

O padrão: eu testava a unidade que acabara de escrever, não o caminho
que o usuário percorre. Para os próximos blocos, o teste deve começar
pela **tela**, não pela função.
