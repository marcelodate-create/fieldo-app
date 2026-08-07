# Licenciamento Pro — como funciona (v5.2)

## Fluxo de venda

1. Cliente paga (PIX, o que for) — fora do sistema, por enquanto
2. Você abre `admin.html`, entra com a chave de admin
3. Preenche o nome dele, escolhe a duração, gera
4. Botão **WhatsApp** monta a mensagem pronta
5. Cliente abre o Fieldo → menu → **Ativar Pro** → cola

## A chave é de uso único POR CONTA

No primeiro resgate, o servidor grava qual conta consumiu a chave
(`license_redemptions`, chaveada pelo SHA-256 do token).

| Situação | Resultado |
|---|---|
| Cliente ativa pela 1ª vez | libera |
| Mesmo cliente, celular novo | libera (é reativação legítima) |
| Outra pessoa cola a mesma chave | **recusado** (`ja_usada`) |

### Por que a conta, e não o aparelho

Foi a pergunta certa, com a resposta errada. Dois motivos:

**A web não expõe id de aparelho.** Não existe identificador de hardware
acessível pelo navegador. O que existe é fingerprinting, que muda a cada
atualização do Chrome e é ativamente bloqueado. Seria uma trava que solta
sozinha.

**E se existisse, seria pior.** O cliente troca de celular e perde o Pro que
pagou — exatamente o suporte que o código de recuperação foi feito para evitar.

A conta (`auth.uid()`) sobrevive à troca de aparelho justamente porque tem
código de recuperação. É o único âncora estável que temos.

## Liberar uma chave presa

Cliente perdeu o código de recuperação, abriu conta nova, e a chave dele está
vinculada à conta antiga. No SQL Editor:

```sql
-- Ver quem consumiu o quê
select token_hash, professional_id, nome_referencia, redeemed_at, reactivations
from license_redemptions order by redeemed_at desc;

-- Liberar (ele poderá resgatar de novo na conta nova)
select private.release_license('<token_hash>');
```

## Segurança

- O token **nunca** é guardado; só o SHA-256 dele.
- `license_redemptions` tem RLS ligada e **nenhuma policy**: invisível para
  `anon` e `authenticated`. Só a Edge Function (service_role) acessa.
- Corrida entre duas ativações simultâneas é resolvida pela PK: só uma grava.
- O plano real vive em `professionals.plan`, e as policies de Contratos
  consultam `private.is_pro()`. Adulterar o localStorage não libera nada.

## Limites conhecidos

- **Processo manual.** Escala até algumas dezenas de clientes. O passo natural
  é o webhook de pagamento (Mercado Pago / Stripe) chamar `license-issue`
  sozinho.
- **Sem tela de gestão de resgates.** Hoje é SQL. Se o volume crescer, vale
  uma aba no `admin.html`.
- **Renovação é uma chave nova.** Não há prorrogação automática da mesma chave.
