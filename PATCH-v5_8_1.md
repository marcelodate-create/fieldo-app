# PATCH v5.8.1 — As fotos nunca subiram

A galeria estava correta. Não havia o que mostrar: **zero fotos no banco,
zero objetos no bucket**. Cinco serviços registrados, `photos: []` em
todos.

## Causa

```js
var BUCKET = 'reports';   // ← bucket que NÃO existe
```

Os buckets criados na migração são `avatars` e `photos`. Todo upload
apontava para `reports` e recebia **404**.

E o 404 era engolido:

```js
FIELDO.Photos.upload(...).catch(function(){ /* silencioso — retry depois */ });
```

## Por que passou semanas despercebido

O relatório continuava perfeito. As fotos aparecem nele porque são
embutidas em **base64 dentro do HTML gerado** — não vêm do Storage.

Então tudo parecia funcionar: você registrava o serviço, via as fotos no
relatório, mandava para o cliente, o cliente via as fotos. Nada indicava
falha. Só que:

- o campo `photos` do banco ficava vazio
- o bucket ficava vazio
- **as fotos existiam apenas dentro daquele arquivo HTML**

Se o cliente apagasse o arquivo, as fotos sumiam. E o perfil público —
sua vitrine — nunca teria uma imagem.

Um `.catch` vazio custou o recurso inteiro.

## Correções

**1. Bucket certo:** `'photos'`.

**2. Falha deixa de ser silenciosa.** Agora avisa e distingue os casos:

| Situação | Mensagem |
|---|---|
| nenhuma subiu | "As fotos não subiram. Elas estão no relatório, mas não no seu perfil." |
| parcial | "3 de 5 fotos enviadas" |
| offline | "Sem conexão: as fotos subirão quando houver rede." |
| subiu mas não vinculou | "Fotos enviadas, mas não vinculadas ao serviço." |

**3. Teste que trava o nome do bucket.** `test/outputs.js` compara todo
`BUCKET = '...'` do `db.js` com a lista de buckets reais. Verificado que
reprova a regressão:

```
✗ bucket 'reports' existe (reais: avatars, photos)
```

## Verificado no banco

| | |
|---|---|
| caminho `{uid}/{reportId}/{idx}.jpg` | aceito pela policy |
| upload em pasta alheia | bloqueado |
| bucket `photos` | existe, público |
| limites | 5 MB · jpeg/png/webp |

## Observação sobre os serviços já registrados

Os cinco serviços existentes ficam **sem foto no perfil** — elas nunca
chegaram ao servidor e só existem nos HTMLs gerados. Não há como
recuperá-las de forma automática.

A partir daqui, todo serviço novo com foto alimenta a galeria.
