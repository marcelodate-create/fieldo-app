# PATCH v5.7.5 — Relatório não abre ao tocar

Relato: depois de criado, tocar no relatório na tela inicial não abre.

Não é normal. Bug meu, e é o **terceiro** do service worker — a peça que
eu mesmo classifiquei como a mais arriscada do projeto, e que provou ser.

## Causa

`caches.match()` usa a **URL inteira** como chave, incluindo a query
string. O precache guarda `./relatorio.html`; o link pede
`relatorio.html?id=abc-123`. São chaves diferentes:

```
precache : /relatorio.html
pedido   : /relatorio.html?id=abc-123
casam?   : NÃO — cache miss
```

Cache miss → cai na página de offline. E como isso só acontece quando o
`fetch` falha, o sintoma é intermitente: funciona com sinal bom, falha no
3G ruim ou no avião.

Afetava **todo link com parâmetro**: abrir relatório, `servico.html?orc=`
(orçamento aprovado virando serviço) e `avaliar.html?t=` (link de
avaliação do cliente).

## Correção

**1. `{ ignoreSearch: true }`** ao procurar no cache durante navegação. O
HTML de `relatorio.html` é o mesmo para qualquer `?id=`; o que muda é só
o que o JavaScript busca depois.

**2. Guardar sob a URL sem query.** Cachear por id encheria o cache com
cópias idênticas do mesmo HTML — e ainda assim falharia num id novo.

## Teste novo: `test/sw-rotas.js`

Nenhum teste anterior pegava isso porque nenhum exercitava a **chave** do
cache — só a lógica ao redor. Este monta um Cache Storage falso com a
mesma regra do navegador (URL inteira como chave) e navega de verdade:

| Cenário offline | |
|---|---|
| `relatorio.html?id=...` | abre do cache |
| `servico.html?orc=...` | abre do cache |
| `busca.html` | abre do cache |
| página inexistente | 503, sem substituir por outra |

Confirmado que reprova o bug reintroduzido:

```
--- sem ignoreSearch (o bug) ---
  ✗ relatorio.html?id=... abre do cache (status: 503)
  ✗ servico.html?orc=... abre do cache (status: 503)
```

## Balanço do service worker

Três bugs em quatro versões, todos meus:

| Versão | Bug |
|---|---|
| v5.7.1 | Storage público excluído do cache — foto sumia |
| v5.7.4 | Precache incompleto + fallback servindo index.html |
| v5.7.5 | Chave de cache com query string |

Os três compartilham a mesma raiz: eu tratei o SW como configuração, não
como código que precisa de teste. Ele agora tem uma suíte própria
(`pwa.js` + `sw-rotas.js`), que é o que deveria ter existido antes da
v5.7.

## Suíte

```
node test/all.js
```

6 suítes: `smoke`, `outputs`, `pwa`, `offline`, `criar-offline`,
`sw-rotas`.
