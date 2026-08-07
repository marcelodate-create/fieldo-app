# PATCH v5.7.1 — Offline de verdade

Relato: no modo avião a **foto de perfil some** e os **dados somem ao
atualizar a página**. Eram dois bugs distintos, ambos contrariando a
promessa central do produto.

## Bug 1 — foto some

O service worker excluía **todo** `supabase.co` do cache. A regra estava
certa para a API (dados por usuário, JWT, RLS — cachear seria vazamento),
mas larga demais: pegou junto o `/storage/v1/object/public/`, que serve
**fotos e logos sem autenticação nenhuma**. São públicas por definição —
não há o que vazar.

Correção: caminho público do Storage passa a ser cache-first. O resto do
Supabase continua sempre indo à rede.

Se não houver cache nem rede, devolve um GIF 1×1 transparente em vez do
ícone de imagem partida — o layout não quebra.

## Bug 2 — dados somem ao atualizar (o grave)

```js
return _get(qs).then(...)   // sem .catch
```

`Reports.list()` e `Budgets.list()` iam à rede **sem fallback**. Offline,
a promise rejeitava e a tela ficava vazia.

E havia um problema por trás: **os dados nunca eram gravados localmente**.
O IndexedDB só guardava o que estava na fila de envio. Mesmo com fallback,
não haveria o que ler.

O app dizia "funciona sem internet" e mostrava zero serviços. Sem
mensagem de erro — só vazio, que o usuário lê como "perdi tudo".

### Correção: write-through

`_listaComCache(store, fetcher)`:

- leitura bem-sucedida → grava no IndexedDB como `synced`
- falha de rede → lê do IndexedDB
- falha que **não** é de rede (403, 500) → propaga o erro, porque
  esconder atrás de dado velho seria pior
- `_localId = id do servidor` → recarregar reescreve o mesmo registro em
  vez de acumular duplicata

O offline passa a ser consequência do uso normal: quem abriu o app com
sinal já tem os dados. Não existe passo de "preparar para offline".

## Teste novo: `test/offline.js`

Simula a queda de rede com IndexedDB em memória:

| Cenário | Verifica |
|---|---|
| online | devolve dados **e** grava local como `synced` |
| offline | ainda devolve os mesmos dados, ordenados |
| stats offline | "a receber" e total corretos sem rede |
| recarregar | não duplica registros |

Também tem uma checagem de sanidade da sessão logo no início — na
primeira execução o teste falhou por chave de `localStorage` errada, e
sem isso o diagnóstico teria apontado para o lugar errado.

```
node test/all.js    # smoke + outputs + pwa + offline
```

## Ícone

A variante maskable tinha margem creme de 20%, e o Samsung desenhava um
anel claro em volta. Agora o dourado sangra até a borda: a máscara corta
o próprio dourado e o ícone preenche o espaço como os apps nativos. O
check ficou dentro da zona segura de 80%, então nenhuma máscara o corta.

## Ainda aberto

- Offline para `update`/`delete` (só `create` entra na fila)
- Sem deduplicação entre dispositivos
