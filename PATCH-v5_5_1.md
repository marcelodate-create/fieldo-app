# PATCH v5.5.1 — WhatsApp abria em branco

## Sintoma
Botão verde do WhatsApp abre o app, mas sem número e sem mensagem.

## Causa 1 — regex quebrado (relatorio.html)

```js
(prof.whatsapp||'').replace(/\\D/g,'')   // ERRADO
```

`/\\D/g` procura **uma barra invertida seguida de "D"**, não "não-dígito".
O `replace` não fazia nada, e o telefone ia formatado para a URL:

```
https://wa.me/55(12) 99999-8888?text=...
```

URL inválida — o WhatsApp abre e não consegue interpretar nada. É um erro
que passa por qualquer revisão visual: `\\D` e `\D` são quase idênticos na
tela, e o código "funciona" sem lançar erro.

## Causa 2 — destinatário errado (servico.html)

```js
var num=(p.whatsapp||'')...   // p = _prof → o número do PRÓPRIO profissional
window.open('https://wa.me/55'+num+...)
```

`enviarWA()` e `solicitarAvaliacao()` mandam conteúdo **para o cliente**,
mas usavam o WhatsApp do profissional: abria um chat consigo mesmo.

O formulário de serviço não captura telefone do cliente, então o certo é
o **seletor de contatos** (`wa.me/?text=`) — o profissional escolhe para
quem enviar.

## Causa 3 — DDI duplicado

`'https://wa.me/55' + num` prefixava 55 cegamente. Quem salvou o número
como `+55 12 99999-8888` virava `wa.me/555512999998888`.

## Correção

Um único helper, `waLink(prof, texto)`, em vez de três formas diferentes
espalhadas pelo código:

- só dígitos (com o regex certo)
- DDI 55 apenas quando ainda não existe
- recusa número curto demais em vez de gerar link inválido — **melhor não
  mostrar o botão do que mostrar um que abre em branco**

| Entrada | Saída |
|---|---|
| `(12) 99999-8888` | `wa.me/5512999998888` |
| `+55 12 99999-8888` | `wa.me/5512999998888` |
| `12999998888` | `wa.me/5512999998888` |
| `123` | vazio → botão não aparece |
| vazio | vazio → botão não aparece |

## Lição

Este bug não seria pego pelo `smoke.js`: o código carrega, a função
existe, nada lança exceção. Só o resultado é inútil.

Testes de carga cobrem "quebrou". Não cobrem "produz lixo silenciosamente".
Para a próxima rodada vale acrescentar asserções de **saída** — como a
tabela acima — nas funções que geram URL, dinheiro ou identificador.
