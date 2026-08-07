# Auditoria de consistência de código

## 🔴 O achado — três implementações de `esc()`

O projeto tinha **três versões diferentes** da função de escape:

| Versão | Escapa | Páginas |
|---|---|---|
| `FIELDO.UI.esc` | `& < > " '` | db.js (correta) |
| local A | `& < >` | 6 páginas |
| local B | `& < > "` | 2 páginas |

As versões locais **não escapavam aspas** — e eram usadas dentro de
atributos HTML:

```js
'<img src="' + esc(p.foto_capa) + '"/>'      // explorar.html
'<a href="relatorio.html?id=' + esc(r.id)    // busca.html
```

Um valor contendo `"` escaparia do atributo. Em `explorar.html` os
valores vêm do banco (`logo_url`, `foto_capa`).

### Por que várias implementações é perigoso por si só

Não é questão de estilo. Com três versões, **a correta pode ser
contornada por acidente** — basta a página errada chamar a função errada.
E quem lê o código vê `esc(...)` e assume que está protegido.

### Correção

Todas as 10 páginas passam a delegar para `FIELDO.UI.esc`. Uma
implementação, uma responsabilidade.

### O teste que revelou

Comparei a saída de `esc()` de cada página contra `FIELDO.UI.esc`, com
uma string contendo os cinco caracteres perigosos:

```
FIELDO.UI.esc → aspa&quot; simples&#39; &lt;tag&gt; &amp;e
✗ relatorio.html → aspa&quot; simples' &lt;tag&gt; &amp;e
```

A diferença é **um caractere**. Sem comparação automática, ninguém
enxerga isso lendo o código.

O teste ficou permanente em `test/outputs.js`. Verificado que reprova a
regressão.

## 🟢 O que eu esperava encontrar e não encontrei

**Duplicação de CSS.** O número bruto assustava — 104 regras inline em
`relatorio.html`, 85 em `perfil.html`. Mas ao comparar regra a regra,
apenas **3** aparecem em 3 ou mais páginas (`.logo-icon`,
`.topbar-brand`, `.skel`). O resto é específico de cada tela.

Não vale extrair. Registro porque eu tinha listado "CSS duplicado" como
pendência em auditorias anteriores, com base no número bruto — estava
errado.

**Mistura pt/en nos nomes.** Meu detector classificou 88 nomes como
português e 77 como inglês, mas a classificação é ruim (chamou
`atualizarBotao` de inglês). Sem base para afirmar que há problema.

## 🟠 Código morto

- `_registrarDesativado()` em `db.js` — 28 linhas, resíduo da remoção do
  service worker na v5.9. Removido.
- `setText()` em `contratos.html` e `hide()` em `perfil.html` — declaradas
  e nunca chamadas. Identificadas; deixadas para uma limpeza com o
  arquivo aberto, já que remover por script em HTML grande é o tipo de
  edição que já me custou conteúdo perdido antes.

## Resultado

| | |
|---|---|
| `esc()` idêntico em 10 páginas | verificado por teste |
| Teste reprova regressão | confirmado |
| db.js | 3544 → 3516 linhas |
| Suíte completa | 5/5 verdes |

## Encerramento das seis frentes

| Frente | Resultado |
|---|---|
| 1 · Coerência de dados | 7 estados impossíveis fechados; bug meu de FK composta pego pelo teste |
| 2 · Fluxo de dados | 2 tokens secretos estavam públicos — anulavam avaliação e aprovação |
| 3 · Consentimento | opt-in de portfólio, padrão desligado, com escape por serviço |
| 4 · Clareza | jargão técnico substituído; beco pós-avaliação resolvido |
| 5 · Integridade | direito de resposta, sem poder alterar nota nem apagar |
| 6 · Consistência | 3 implementações de escape unificadas |

## Pendências declaradas

- **Código de recuperação em texto claro** no `auth.users.email` — o mais
  sério que resta
- Tela para o profissional **escrever** a resposta (API e banco prontos)
- `setText`/`hide` mortos em duas páginas
