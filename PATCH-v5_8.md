# PATCH v5.8 — Galeria de trabalhos no perfil público

> "As fotos são prova de bom serviço."

Concordo, e era a maior lacuna da página: o cliente chegava e **não via
trabalho nenhum** — só linhas de texto com nome e data.

## A galeria

Grade de 3 colunas com todas as fotos dos serviços públicos, **antes** da
lista de serviços. O cliente decide olhando foto, não lendo texto.

- Cada foto abre em tela cheia, com categoria, data e avaliação
- Do visualizador, link para o **relatório completo** — que é onde mora a
  credibilidade: hash de autenticidade, data, avaliação do cliente
- Navegação por swipe, setas do teclado e Esc
- 12 fotos por vez, com "ver mais": perfil com 40 fotos em 3G travaria o
  carregamento inteiro
- `loading="lazy"` e `decoding="async"`
- Foto com URL morta **some** em vez de mostrar ícone quebrado
- Seção inteira desaparece quando não há foto — grade vazia é pior que
  seção ausente

## 🔒 Privacidade dos seus clientes

Encontrado ao mexer aqui: a página pública exibia o **nome completo** dos
seus clientes.

Qualquer estranho na internet lia "Maria Aparecida Silva contratou este
eletricista". Um terceiro que nunca consentiu, exposto para dar
credibilidade a outra pessoa. Além do desconforto óbvio, é dado pessoal
de terceiro publicado sem base legal.

Agora exibe **"Maria A."** — concreto o bastante para dar veracidade, sem
expor ninguém. Mesmo critério aplicado ao nome de quem avalia.

## Dois erros meus, corrigidos no processo

**1. Código dentro do `<style>`.** Ao inserir `nomeCurto()`, minha âncora
casou com um comentário CSS que eu mesmo tinha acabado de escrever com o
mesmo texto. A função foi parar dentro da folha de estilo — CSS quebrado
e função indefinida.

**2. Galeria aninhada em `renderTudo`.** Inserida antes de um comentário
que estava **dentro** de outra função. Funcionaria por acidente, mas
re-registraria os listeners de teclado e swipe a cada render — vazamento
clássico. Movida para o nível superior.

Ambos pegos porque testei o escopo das funções depois de inserir, em vez
de confiar no `replace`. Substituição por texto em arquivo grande é
frágil; o teste é que dá a garantia.

## Testado

| Cenário | |
|---|---|
| 4 serviços, 3 fotos | conta e exibe 3 |
| serviço sem foto | ignorado, sem buraco na grade |
| nenhuma foto | seção some |
| navegar antes da primeira | dá a volta |
| navegar após a última | dá a volta |
| `nomeCurto` com nome completo / só nome / vazio / null | correto |

Contrato do smoke test para `perfil.html` também estava vazio. Agora tem
5 funções verificadas.

## Ainda pendente nesta página

- "2 serviços" e o score aparecem duas vezes (hero e grade)
- Célula vazia na grade de estatísticas
- Foto de capa / destaque escolhida pelo profissional
