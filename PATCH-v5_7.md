# PATCH v5.7 — Service Worker e PWA

## O risco tratado com peso

Um service worker **persiste no aparelho**. Se servir uma versão quebrada
de cache, o usuário fica preso nela mesmo depois de você corrigir e
publicar — e não há como avisá-lo. É a única peça deste projeto que pode
inutilizar o app de forma que o próprio usuário não consegue desfazer.

Por isso as decisões abaixo são conservadoras de propósito.

## Estratégias de cache

| Recurso | Estratégia | Motivo |
|---|---|---|
| HTML | **network-first** | Correção publicada chega no próximo acesso com sinal. Sem isso, bug de cache vira permanente. |
| CSS/JS/ícones | stale-while-revalidate | Abre instantâneo, atualiza em segundo plano. |
| Supabase | **nunca cacheado** | Dados por usuário, com JWT e RLS. Guardar resposta de um usuário e servir a outro no mesmo aparelho seria vazamento. |
| POST/PATCH | passa direto | Escrita nunca vem de cache. |
| Origem externa | ignorada | Não intercepta o que não é nosso. |

O offline de **dados** continua sendo do IndexedDB/SyncEngine, que já
existia e sabe resolver conflito. O service worker cuida só do **casco**
do app — cachear dados seria duplicar responsabilidade e criar
divergência entre duas fontes de verdade.

## Três salvaguardas

**1. `FIELDO.PWA.reset()` e botão "Corrigir app travado"** em
Configurações. Remove o service worker e apaga todos os caches. Sem isto,
a única saída seria "limpar dados do navegador" — que apagaria a conta
junto, porque a identidade vive no `localStorage`.

**2. `sw.js` com `no-store` no Netlify.** Se o navegador cachear o próprio
worker, a correção nunca chega. É o caso em que o remédio fica preso
atrás da doença.

**3. Atualização avisada, não imposta.** Versão nova mostra aviso; a troca
só acontece quando o usuário aceita. Trocar o JS embaixo de um formulário
aberto perderia o que a pessoa digitou.

## 🔴 Bug pego pelo smoke test durante este patch

Ao inserir o script de registro antes de `</body>`, o `replace` acertou a
**primeira** ocorrência — que fica **dentro da string JavaScript** do
relatório autossuficiente, em `servico.html`, `orcamento.html` e
`contratos.html`.

Resultado: três páginas com JS inválido. O smoke test acusou na hora
(`Invalid or unexpected token`). Sem ele, isso iria para o zip e
quebraria as três telas mais usadas do sistema.

Corrigido inserindo na **última** ocorrência de `</body>`, e o
`test/pwa.js` agora tem uma asserção específica para isso.

## Ícones

Gerados a partir das cores da marca (`#9a7218` sobre `#f5f2ec`),
reproduzindo o selo de autenticidade. Inclui variante **maskable** com
margem de 20% — sem ela, o Android corta o desenho ao aplicar máscara
circular.

## Suíte de testes

```
node test/all.js        # roda tudo antes de publicar
```

| Suíte | O que prova |
|---|---|
| `smoke.js` | as 13 páginas carregam; funções esperadas existem |
| `outputs.js` | URL/dinheiro/identificador produzem valor correto |
| `pwa.js` | SW não cacheia API, HTML é network-first, ícones existem, boot fora de string |

## Limitação

Testes estáticos não substituem aparelho. O que só o celular confirma:
instalação na tela inicial, comportamento real offline e o prompt de
atualização. **Teste em modo avião depois de abrir o app uma vez com
sinal.**
