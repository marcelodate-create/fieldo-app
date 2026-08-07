# PATCH v5.7.4 — "Volta pra tela inicial"

Relato: tocar em **Pesquisar**, **Explorar profissionais** ou **Ativar
Pro** joga de volta na tela inicial.

Bug meu, introduzido na v5.7 junto com o service worker.

## Causa

Duas coisas somadas:

**1. Precache incompleto.** Só quatro páginas estavam na lista:
`index`, `servico`, `orcamento`, `relatorio`. As do menu — `busca`,
`explorar`, `ativar`, `perfil`, `contratos` — ficaram de fora.

**2. Fallback errado.** Quando o `fetch` falhava (sinal fraco, 3G ruim,
avião), meu handler fazia:

```js
caches.match(req).then(hit => hit || caches.match('./index.html'))
```

Ou seja: **servia a tela inicial no lugar da página pedida**.

É o padrão *app-shell* de single-page app, que eu apliquei sem pensar
num site de várias páginas. Em SPA faz sentido — o roteador reconstrói a
tela certa. Aqui não há roteador: o navegador simplesmente recebe HTML de
outra página.

Resultado: navegação silenciosamente errada. Sem mensagem, sem erro no
console, sem nada — só a tela errada. O pior tipo de falha, e o mais
difícil de relatar: "clico e volta pro início".

## Correção

**1. Todas as páginas no precache.** As 12 do app.

**2. Fallback nunca substitui página.** Quando não há cache nem rede,
responde uma página de offline honesta, com **503**, dizendo qual página
não pôde abrir e oferecendo "Ir para o início" e "Tentar de novo". Ir
para o início vira **escolha do usuário**, não decisão silenciosa do
service worker.

## Teste que trava a regressão

`test/pwa.js` agora falha se:

- qualquer `.html` do projeto ficar fora do `PRECACHE`
- voltar a existir `caches.match('./index.html')` como fallback
- a resposta de offline não for 503

Verificado que reprova o bug reintroduzido:

```
--- com o bug de volta ---
  ✗ busca.html está no PRECACHE do sw.js
  ✗ sem fallback para index.html (navegação silenciosamente errada)
  ✗ tem página de offline honesta
✗ 3 falha(s)
```

O primeiro item é o que mais vale: **se você criar uma página nova e
esquecer o `sw.js`, o teste avisa** — antes de virar "clico e volta pro
início" de novo.

## Instalação

Versão do SW subiu para `5.7.4`, então o cache antigo é descartado
sozinho. Se persistir, use Configurações → **Corrigir app travado**.
