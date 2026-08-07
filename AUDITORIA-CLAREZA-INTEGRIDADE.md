# Auditoria — clareza para o cliente e integridade do profissional

## Frente 4 · O cliente não pode se sentir perdido

### O problema

Levantamento do vocabulário nas telas que o cliente vê: **78 ocorrências
de "hash", 7 de "SHA-256"**, além de "timestamp imutável" e "Selo de
Autenticidade".

Para quem contratou um eletricista, nada disso significa alguma coisa. E
ocupava justamente o espaço onde deveria estar a informação útil.

### O que mudou

**No selo do relatório:**

| Antes | Depois |
|---|---|
| `SHA-256` + 48 caracteres de hash | **Documento protegido contra alteração** — "Registrado em 21/07. Toque no código abaixo para conferir." |

O termo técnico continua ali, discreto, para quem quiser conferir. O que
mudou foi a **ordem**: primeiro o que importa, depois o detalhe.

**Na mensagem do WhatsApp:**

| Antes | Depois |
|---|---|
| "🔐 Documento verificável com Selo de Autenticidade Fieldo." | "Segue o comprovante do serviço com as fotos. O link fica salvo — pode guardar ou compartilhar. Se puder avaliar o atendimento, ajuda bastante." |

A anterior descrevia a tecnologia. A nova diz **o que é** e **o que
fazer**.

**Na página de verificação**, 9 textos reescritos. Exemplo:

> ~~"Cole o hash SHA-256 do documento para confirmar que ele é autêntico"~~
> "Cole o código que aparece no rodapé do documento. Se ele estiver
> registrado, você tem a confirmação de que o documento é o original."

### Beco sem saída, corrigido

Depois de avaliar, o cliente via *"Obrigado pela avaliação!"* e **nada
mais**. Sem próximo passo, sem saber que podia guardar o link.

Agora aparece: *"Este link fica salvo. Guarde para garantia ou imposto de
renda."* — e, se o perfil for público, um caminho para ver outros
trabalhos. Fecha o ciclo e alimenta o marketplace.

---

## Frente 5 · Integridade do profissional

### O problema

Uma avaliação injusta ficava pública, sozinha, **para sempre**. O
profissional não podia apagar (seria censura, e destruiria a confiança no
sistema) nem responder. Só sofrer.

### A solução: direito de resposta

A nota e o comentário do cliente permanecem **intocáveis**. O profissional
acrescenta a versão dele, exibida ao lado. Quem lê decide.

Garantido por **privilégio de coluna**, não por confiança no cliente:

```sql
revoke update on public.avaliacoes from authenticated;
grant update (resposta, respondido_em) on public.avaliacoes to authenticated;
```

### Verificado

| # | Cenário | |
|---|---|---|
| 1 | profissional responde | permitido |
| 2 | profissional altera a **nota** | bloqueado |
| 3 | profissional altera o **comentário** | bloqueado |
| 4 | profissional **apaga** a avaliação | bloqueado (0 linhas) |
| 5 | outro profissional responde no lugar dele | 0 linhas |
| 6-7 | nota e comentário preservados | sim |
| 8 | data da resposta registrada | sim |
| 9 | público lê a resposta | sim |

---

## Erro meu de método — terceira ocorrência

O teste 4 marcou "CONSEGUIU apagar" quando na verdade estava bloqueado.
Causa: escrevi `begin delete; "sucesso" exception when others then
"bloqueado" end`.

**DELETE barrado por RLS não lança exceção — apenas afeta zero linhas.**
Já cometi esse erro três vezes nesta auditoria.

A forma correta é comparar contagens antes/depois, **ambas medidas com o
mesmo papel**. Feito, e o veredito real foi `1 → 1`: bloqueado.

Registro porque teste errado é pior que teste ausente: dá confiança falsa
nas duas direções — e aqui quase me fez "corrigir" algo que já estava
certo.

---

## Pendente

A tela para o profissional **escrever** a resposta ainda não existe. A
API (`FIELDO.Avaliacoes.responder`) e a proteção no banco estão prontas;
falta o campo na interface.
