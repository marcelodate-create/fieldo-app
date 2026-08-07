# Plano de Auditoria Pesada — Fieldo
### Página por página · foco em agilidade e faturamento

## Método

Cada página passa por 4 lentes, nesta ordem:

1. **Fluxo** — quantos toques até o objetivo? Qual toque não precisa existir?
2. **Dados** — o que a tela promete e o banco não guarda (ou o contrário)?
3. **Campo** — funciona com uma mão, sol na tela, 3G ruim, luva?
4. **Risco** — XSS, vazamento, perda de dado.

Prioridade = **impacto no dinheiro ÷ esforço**. Estética entra por último.

---

## 🔴 ACHADO ZERO — antes de qualquer página

**O valor do serviço nunca é salvo.**

`servico.html` tem o campo "Valor cobrado (opcional)", com a legenda
*"Não aparece no relatório — apenas nos seus registros"*.

O campo é lido **zero vezes** no código. Não vai para o banco, não existe
coluna `valor` em `reports`, não aparece em relatório nenhum. O profissional
digita e o número evapora.

Consequência direta: hoje é **impossível** saber quanto você faturou. Não há
relatório de faturamento porque não há dado de faturamento.

Isso bloqueia tudo que você pediu. É o primeiro item.

---

## Página por página

### 1. `servico.html` — registro de serviço ⭐ prioridade máxima
É a tela mais usada e a que gera o produto que o cliente vê.

| # | Proposta | Por quê |
|---|---|---|
| 1.1 | **Persistir `valor`** (+ coluna no banco) | destrava faturamento e PIX |
| 1.2 | Campo **status de pagamento** (pendente/pago) | sem isso não há "quem me deve" |
| 1.3 | **PIX Copia e Cola com valor embutido** no relatório | ver seção PIX abaixo |
| 1.4 | Data padrão = hoje, editável | 1 toque a menos, sempre |
| 1.5 | Cliente recorrente: autocompletar por nome | evita redigitar em obra longa |
| 1.6 | Rascunho automático visível ("salvo há 2s") | confiança em 3G ruim |
| 1.7 | Compressão de foto mais agressiva + indicador | upload em 3G é o gargalo real |

### 2. `relatorio.html` + relatório gerado ⭐ prioridade máxima
O que o cliente recebe. É a sua vitrine e o seu cobrador.

| # | Proposta | Por quê |
|---|---|---|
| 2.1 | Mostrar **valor** e **status de pagamento** | pedido direto |
| 2.2 | **Botão PIX Copia e Cola** com valor já preenchido | 1 toque para pagar |
| 2.3 | Botão "Já paguei" → avisa você no WhatsApp | fecha o ciclo |
| 2.4 | Recibo automático quando marcado como pago | documento que o cliente pede |
| 2.5 | Fotos antes/depois lado a lado | é o que impressiona |
| 2.6 | **Revisar `innerHTML`** — nome do cliente é entrada livre | XSS real |

### 3. `index.html` — painel
Hoje mostra listas. Deveria responder "quanto tenho a receber?".

| # | Proposta |
|---|---|
| 3.1 | Cartão do topo: **a receber / recebido no mês** |
| 3.2 | Lista "aguardando pagamento" com botão de cobrar |
| 3.3 | Ação rápida flutuante: novo serviço em 1 toque |
| 3.4 | Alerta de orçamento parado há +7 dias |

### 4. `orcamento.html` — orçamento
Já é o mais completo. Faltam os fechamentos.

| # | Proposta |
|---|---|
| 4.1 | **Aprovação pelo cliente no link** (botão aprovar/recusar) |
| 4.2 | Orçamento aprovado → vira serviço com 1 toque, sem redigitar |
| 4.3 | Modelos salvos de itens (o mesmo serviço se repete) |
| 4.4 | Sinal de entrada: PIX parcial no próprio orçamento |

### 5. `perfil.html`
| # | Proposta |
|---|---|
| 5.1 | Validar chave PIX por tipo (CPF/CNPJ/telefone/e-mail/aleatória) |
| 5.2 | Prévia de como o cliente vê o perfil |
| 5.3 | **Mostrar o código de recuperação de novo** (hoje só no onboarding) |

### 6. `contratos.html` (Pro)
| # | Proposta |
|---|---|
| 6.1 | Fechamento de período: total a pagar por empreiteiro |
| 6.2 | Comprovante de pagamento de diária |
| 6.3 | Corrigir 55 usos de `innerHTML` (nome de empreiteiro é entrada livre) |

### 7. `avaliar.html`
| # | Proposta |
|---|---|
| 7.1 | Pedir avaliação por WhatsApp com 1 toque após o serviço |
| 7.2 | Lembrete automático em 3 dias se não avaliou |

### 8. `explorar.html` / `busca.html`
Só fazem sentido com massa de profissionais. **Adiar.**

### 9. `verificar.html` / `ativar.html`
Funcionais. Só ajuste de texto. **Baixa prioridade.**

---

## A proposta do PIX, detalhada

Hoje o relatório mostra a chave e um botão "Copiar chave". O cliente ainda
precisa: abrir o banco → colar a chave → **digitar o valor** → conferir → pagar.
São 5 passos e uma chance de digitar errado.

**PIX Copia e Cola (BR Code / padrão EMV do Banco Central)** carrega chave,
nome, cidade **e valor** numa única string. O cliente cola no banco e o valor
já vem preenchido. Vira: abrir banco → colar → pagar.

Detalhes técnicos:
- É geração de string com CRC16-CCITT. ~40 linhas de JS, **funciona offline**.
- Cabe também como QR Code — e o `qrcode_min.js` já está no projeto.
- Precisa de chave PIX válida, nome e cidade do recebedor (já temos no perfil).
- Não exige integração bancária, não tem custo, não precisa de API.

**Limite honesto:** o PIX estático não notifica você do pagamento. Saber que
o cliente pagou exige ou o botão "Já paguei" (confiança) ou integração com
PSP (Mercado Pago, Gerencianet), que é outro projeto.

---

## Ordem de execução sugerida

**Bloco 1 — o dinheiro (faça primeiro)**
1. Persistir `valor` + status de pagamento (achado zero)
2. PIX Copia e Cola com valor no relatório
3. Painel com "a receber / recebido"

**Bloco 2 — o ciclo**
4. Aprovação de orçamento pelo cliente
5. Orçamento aprovado → serviço
6. Botão "Já paguei" + recibo

**Bloco 3 — segurança pendente**
7. Auditoria dos 55 `innerHTML`
8. Service worker (offline de verdade)
9. Offline para `update`/`delete`

**Bloco 4 — crescimento**
10. Avaliação por WhatsApp
11. Marketplace (explorar/busca)
12. Webhook de pagamento → licença automática

---

## Como vamos trabalhar

Uma página por vez, na ordem acima. Para cada uma:
inspeção → proposta → sua decisão → implementação → teste → próxima.

Nada de mexer em 5 páginas ao mesmo tempo: foi assim que o `codes.html`
sobreviveu a uma "correção completa".
