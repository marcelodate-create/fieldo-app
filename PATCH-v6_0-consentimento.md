# PATCH v6.0 — Consentimento de portfólio e vitrine

## O que motivou

`explorar` vai ser a porta de entrada do produto. Colocar fotos ali
significa que o trabalho feito na casa do seu cliente fica **navegável
por qualquer estranho** — não só por quem recebeu o link. Rosto, interior
da casa, número na porta.

Escolha do product owner: **opção B** — consentimento global no perfil,
com o profissional avisando os clientes por fora.

## Como ficou

**Toggle no perfil, padrão DESLIGADO.** Um opt-in que já vem ligado não é
consentimento — é armadilha.

O aviso de responsabilidade **só aparece quando o toggle liga**. Texto
permanente vira paisagem; texto que surge no momento da decisão é lido.

`portfolio_aceito_em` registra quando a responsabilidade foi assumida, e
é limpo ao desligar.

### Dois reforços que a opção B não tinha

**1. Escape por serviço.** `reports.portfolio_ok` esconde **um** trabalho
sem desligar o consentimento global. Sem isso, B seria tudo-ou-nada — e
sempre existe a obra que não deve ir para vitrine.

**2. Orientação no campo Cidade.** O campo é texto livre; sem aviso,
alguém digita rua e número, e isso aparece no relatório que o cliente
compartilha. Verificado: o campo pede cidade ("Ex: Campinas – SP"), então
o risco era de preenchimento, não de desenho.

## A vitrine, sem poluição

**Uma foto por card.** Não uma galeria.

`professional_stats` ganhou `foto_capa`: a primeira foto do serviço
público mais recente que não foi excluído. Proporção 16:9 em vez de
quadrada — ocupa menos altura, cabem mais profissionais na tela sem
virar mural.

Sem consentimento, o card volta ao formato anterior: **sem buraco, sem
placeholder cinza**.

O link do card já era `<a href>` direto — um toque, abre. Não precisou
mexer. O que fazia parecer quebrado era outra coisa: a página estava
vazia porque nenhum perfil era público (a regra de 3 serviços só passou a
funcionar de fato ontem).

## Galeria do perfil

Sem consentimento, some para visitantes. **O dono continua vendo**, com o
rótulo *"só você vê — ative em Configurações"* — ele precisa conferir o
que publicaria antes de publicar.

## Testado no banco

| | |
|---|---|
| perfil publica com 3 serviços | sim |
| capa sem consentimento | nula |
| capa com consentimento | aparece |
| data de aceite ao ligar | registrada |
| data limpa ao desligar | nula |
| serviço excluído individualmente | filtrado |

Suíte de código: 5/5 verdes.

## O que a opção B não resolve

Sendo direto: **o consentimento continua sendo seu, não do cliente.** O
banco registra que *você* aceitou, não que *ele* autorizou. Se um cliente
reclamar, o registro mostra a data em que você assumiu a responsabilidade
— não uma autorização dele.

A opção A (marcar por serviço, no momento do registro, com o cliente
presente) seria defensável de verdade. B é praticável. Você escolheu
praticável, e isso é legítimo — mas convém saber o que ficou de fora.

Caminho intermediário, se um dia quiser: uma linha no relatório que o
cliente recebe — *"as fotos deste serviço podem aparecer no portfólio do
profissional"* — com link para pedir remoção. Transforma o aviso "por
fora" em registro.
