# PATCH v5.5.2 — WhatsApp: as quatro implementações

## O erro do meu diagnóstico anterior

Na v5.5.1 corrigi dois pontos e declarei resolvido. **Não auditei o
projeto inteiro** — existiam SEIS lugares montando link de WhatsApp, cada
um à sua maneira. Corrigi dois e o botão que você usava era outro.

Lugares encontrados: `relatorio.html` (2×), `servico.html` (3×),
`orcamento.html`, `contratos.html`, `perfil.html`, `index.html` (2×).

## Causa do seu caso

`orcamento.html`:

```js
var numero = wppCliente || (prof.whatsapp||'').replace(/\D/g,'');
var url = 'https://wa.me/55' + numero + '?text=' + ...
```

Dois defeitos:

1. **Prefixo `55` cego.** Se o WhatsApp do cliente foi digitado com DDI
   (`+55 12 99999-8888`), vira `wa.me/555512999998888`. URL inválida — o
   app abre e ignora, sem erro nenhum.
2. **Fallback para o próprio número.** Sem número do cliente, usava
   `prof.whatsapp`: abria conversa consigo mesmo.

## Correção estrutural

Uma implementação só, em `FIELDO.UI`:

- `waNumero(bruto)` — normaliza; devolve `''` quando não serve
- `waLink(numero, texto)` — link ou `''`
- `waPicker(texto)` — seletor de contatos, quando o destinatário é desconhecido

Regra: **`''` significa esconder o botão.** Botão ausente é melhor que
botão que abre em branco — o usuário ao menos entende que falta cadastro.

Todas as seis chamadas passaram a delegar. `contratos.html` e
`perfil.html` tinham o mesmo defeito e também foram corrigidos.

## Novo teste: asserções de saída

`test/outputs.js`. O `smoke.js` prova que o código **carrega**; este prova
que ele **produz valor correto**. Foi a lacuna que deixou esse bug passar
duas vezes: nada quebrava, só o resultado era inútil.

Cobre as três famílias em que lixo silencioso custa caro: URL, dinheiro e
identificador.

```
node test/smoke.js     # 31 verificações de carga
node test/outputs.js   # 17 asserções de saída
```

| Entrada | waNumero |
|---|---|
| `(12) 99999-8888` | `5512999998888` |
| `+55 12 99999-8888` | `5512999998888` |
| `5512999998888` | `5512999998888` |
| `012999998888` | `5512999998888` |
| `999` | `''` → botão escondido |
| vazio / null | `''` → botão escondido |

## Limitação assumida

Números de 11 dígitos iniciados por 1 são ambíguos entre EUA e DDD
brasileiro. O app assume Brasil — é o público do produto. Suporte
internacional exigiria pedir o país no cadastro.
