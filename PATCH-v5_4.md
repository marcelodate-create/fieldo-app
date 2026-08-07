# PATCH v5.4 — Bloco 2: o ciclo

## Rede de proteção antes do código

Pedido explícito: nada de bug silencioso. Então a **primeira** entrega foi
`test/smoke.js` — carrega `db.js` + o script inline de cada uma das 13
páginas num contexto isolado e falha se qualquer uma parar de carregar.

Também valida um **contrato de funções**: se um refactor renomear
`avancarStep`, `bindPagoBtns` ou `copiarPix`, o teste acusa. Sem isso, o
botão correspondente viraria no-op mudo — exatamente a classe de bug que
o `fValor` (campo lido zero vezes) representava.

```
node test/smoke.js
```

Rodado após **cada** alteração deste patch. Baseline: 30 verificações.
Final: 31.

## 1. Cliente aprova o orçamento no próprio link

Antes o orçamento era beco sem saída: o cliente recebia, respondia por
WhatsApp, e o profissional redigitava tudo.

Mesma classe de problema da avaliação — cliente anônimo precisando
escrever. Abrir `UPDATE` para `anon` deixaria qualquer um aprovar
orçamento alheio. Solução idêntica: **token secreto + RPC
`SECURITY DEFINER`**. Nenhuma policy de escrita anônima foi criada.

- `budgets.approval_token` (96 bits), gerado no insert
- `decide_budget(token, decisao, nota, assinatura)` — transacional, com
  `FOR UPDATE` para serializar dois cliques simultâneos
- Decisão é **definitiva**: `ja_decidido` bloqueia o replay
- Constraint `chk_decisao_tem_data`: aprovado/recusado exige `approved_at`

**Compatibilidade:** o link vira `relatorio.html?orc={id}&t={token}`.
Sem `t`, o orçamento continua apenas visualizável — **links antigos não
quebram**.

Ao aprovar, abre o WhatsApp do profissional com a mensagem pronta. Não é
notificação de verdade, mas fecha o ciclo hoje sem depender de push.

## 2. Botão "Já paguei" no relatório

**Decisão deliberada: isto NÃO marca o serviço como pago.**

Pix estático não confirma recebimento. Aceitar a palavra do cliente como
verdade contábil faria o painel financeiro mentir — e o painel é a razão
de existir do Bloco 1.

Fica registrado como **aviso** (`client_paid_claim_at`). No painel, o
serviço mostra "cliente avisou que pagou" e o botão `R$` fica verde,
pulsando. O profissional confirma; só então `payment_status = 'pago'`.

## 3. Código de recuperação no Perfil

Antes só aparecia no onboarding, uma vez. Quem pulava perdia a conta ao
limpar o navegador — foi o que gerou **9 perfis órfãos** durante os
testes, e o que fez a chave Pix acabar numa conta perdida.

Agora fica em Configurações → Segurança da conta, oculto por padrão, com
"Mostrar" e "Baixar .txt".

## Duas falhas que eu ia introduzir (pegas antes de fechar)

**1. Vazamento no logout.** Ao persistir o código em `localStorage` para
o Perfil poder reexibi-lo, o `logout` não o apagava. O próximo usuário do
mesmo aparelho encontraria o código de recuperação do anterior — ou seja,
**acesso permanente à conta alheia**. `Auth.logout` agora limpa.

**2. Recuperação sem código.** Quem recuperasse a conta num aparelho novo
não teria o código salvo localmente, e o Perfil mostraria "indisponível" —
deixando a pessoa sem saída no aparelho seguinte. `recoverWithCode` agora
persiste.

## Testado (banco)

| Cenário | Resultado |
|---|---|
| aprovar orçamento válido | ok, status aprovado |
| replay do mesmo token | `ja_decidido` |
| recusar outro orçamento | ok, assinatura fica nula |
| token inexistente | `nao_encontrado` |
| decisão inválida ("talvez") | `decisao_invalida` |
| anon faz UPDATE direto em budgets | 0 linhas |
| avisar pagamento | ok |
| avisar 2ª vez | `already: true` (idempotente) |
| avisar em serviço sem valor | `nao_cobrado` |
| **status após aviso** | **continua `pendente`** ✔ |

## Avisos do advisor que são intencionais

Não foram "corrigidos" porque corrigir quebraria o produto:

- **`submit_rating`, `decide_budget`, `claim_payment` executáveis por
  `anon`.** É o desenho: existem justamente para que o anônimo **não**
  precise de permissão de escrita nas tabelas. O token de 96 bits é a
  credencial, validada dentro da função.
- **"Anonymous Access Policies".** O Supabase chama de anônimo todo
  usuário criado por anonymous sign-in — que no Fieldo é *todo* usuário.
  As policies filtram por `auth.uid()`, então o isolamento é real.
- **`license_redemptions` com RLS e sem policy.** Intencional: invisível
  para `anon` e `authenticated`; só a Edge Function acessa.

## Ainda aberto

- Orçamento aprovado → virar serviço com um toque (item 2 do plano,
  não implementado neste patch)
- Notificação real de aprovação (hoje é WhatsApp manual)
- 55 usos de `innerHTML` nas páginas antigas
- Service worker
