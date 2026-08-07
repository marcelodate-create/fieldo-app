# Fieldo — contexto para continuar o trabalho

> **Cole este arquivo no início da nova conversa, junto com o zip do projeto.**

---

## 1. O que é

App para **profissional de campo** (eletricista, pintor, encanador)
registrar serviços com foto, gerar relatório para o cliente, emitir
orçamento e receber por Pix.

**O usuário está em obra:** celular na mão, sol na tela, 3G ruim, às
vezes de luva. Cada toque precisa existir por um motivo. Cada tela
precisa funcionar com uma mão.

**Stack:** HTML estático + `db.js` (sem build, sem framework) · Supabase
(Postgres + Auth + Storage + Edge Functions) · Netlify.

---

## 2. Estado atual — v6.5

Projeto Supabase: **`jrsctnncoljdcvdofxsg`** (nome "Fieldo", us-east-2).

### Configurações que PRECISAM estar ligadas no painel

| Config | Onde | Estado |
|---|---|---|
| Anonymous sign-ins | Auth → Providers | **ligado** (sem isso o onboarding trava) |
| Confirm email | Auth → Providers → Email | **desligado** (sem isso a recuperação não vincula) |

Secrets das Edge Functions estão **embutidos no código da function**
(decisão da v5.8.2, porque o painel de secrets não estava funcionando).

### Arquitetura de identidade

- **Anonymous Auth**: `signInAnonymously()` cria usuário real com uuid e
  JWT. Sem e-mail, sem senha, sem tela de login.
- `professionals.id` **é** o `auth.uid()`. É isso que torna a RLS possível.
- **Código de recuperação**: 16 chars, gerado no dispositivo. O e-mail
  sintético carrega o **SHA-256** do código (v6.5) — o servidor nunca
  armazena o código em claro.
- Depende de `crypto.subtle` → **exige HTTPS ou localhost**.

### Segurança — invariantes que NÃO podem ser quebradas

1. **`plan` e `plan_expires_at` não são graváveis pelo usuário.**
   `REVOKE UPDATE` na tabela + `GRANT UPDATE` coluna a coluna + gatilho.
   Sem isso qualquer um vira Pro com um PATCH.
2. **Tokens secretos não são legíveis pelo `anon`.**
   `rating_token` e `approval_token` saíram do GRANT de SELECT. Leitura
   por token acontece via RPC (`report_por_token`, `orcamento_por_token`)
   que devolve o dado **sem** o token.
3. **Vínculos entre registros usam FK composta** `(id, professional_id)`.
   FK simples permitia apontar para registro de outra conta.
4. **Escrita anônima acontece só por RPC** com token: `submit_rating`,
   `decide_budget`, `claim_payment`.
5. **Avaliação: o profissional só escreve `resposta`.** Nota e comentário
   do cliente são intocáveis; apagar é bloqueado.

### Privacidade

- Nome de cliente aparece como **"Maria A."** nas páginas públicas.
- **Portfólio é opt-in**, padrão desligado (`portfolio_publico`), com
  escape por serviço (`reports.portfolio_ok`).
- Telefone e e-mail do profissional não são públicos; o canal é o whatsapp.

### Regras de negócio no banco

- Perfil publica no marketplace ao atingir **3 serviços públicos**
  (gatilho `ativar_perfil_publico`), e só com nome, profissão e cidade.
- `valor` preenchido implica `payment_status <> 'nao_cobrado'`.
- `aprovado`/`recusado` exigem `approved_at`; `concluido` preserva a data.

---

## 2.1 · ⚠️ A pasta `sql/` está desatualizada

Os scripts em `sql/` são da **v5.0**. O banco evoluiu por ~20 migrações
aplicadas direto no Supabase e **não replicadas ali**.

**Não recrie o banco a partir daquela pasta** — o schema resultante fica
sem as proteções de segurança posteriores (plano não-gravável, tokens
ocultos, FKs compostas, consentimento, direito de resposta).

Para o schema real: `Dashboard → Database → Migrations`, ou
`supabase db dump --schema public`.

Detalhes em `sql/LEIA-ME.md`.

---

## 3. Disciplina de teste — não negociável

```
node test/all.js
```

6 suítes: `smoke`, `outputs`, `offline`, `criar-offline`, `timeout`,
`recuperacao`. Rodar **antes e depois de cada mudança**.

### A regra que mais importa

**Um teste que passa antes e depois da correção não prova nada.**
Sempre: reintroduzir o bug, ver o teste falhar, corrigir, ver passar.

### O que cada suíte cobre

| Suíte | Prova |
|---|---|
| `smoke` | as páginas carregam; funções esperadas existem (contrato) |
| `outputs` | URL/dinheiro/escape produzem valor **correto** |
| `offline` | listas sobrevivem à queda de rede |
| `criar-offline` | criar serviço/orçamento sem rede **e vê-los na lista** |
| `timeout` | nada gira para sempre |
| `recuperacao` | o código não é reconstruível do que o servidor guarda |

---

## 4. Meus padrões de erro — leia antes de testar qualquer coisa

Estes se repetiram várias vezes. Evitá-los economiza horas.

### 4.1 · DELETE/UPDATE barrado por RLS **não lança exceção**

Apenas afeta zero linhas. Escrevi três vezes um teste do tipo
`begin delete; "conseguiu" exception when others then "bloqueado" end` —
e ele reporta "conseguiu" quando estava bloqueado.

**Correto:** comparar contagem antes/depois, **ambas medidas com o mesmo
papel**. Medir "antes" como `anon` (filtrado) e "depois" como owner (sem
filtro) também dá falso positivo — cometi isso duas vezes.

### 4.2 · Em `SECURITY DEFINER`, `current_user` é o DONO da função

Não quem chamou. Uma verificação `current_user in ('service_role',...)`
dentro de SECURITY DEFINER é **sempre verdadeira**. Use `SECURITY
INVOKER` quando precisar saber quem chamou.

### 4.3 · `REVOKE` de coluna não tem efeito sobre `GRANT` de tabela

Quem tem `UPDATE` na tabela altera qualquer coluna. É preciso revogar a
tabela e conceder coluna a coluna.

### 4.4 · `ON DELETE SET NULL` em FK composta anula TODAS as colunas

Inclusive `professional_id`, que é `NOT NULL`. Use
`on delete set null (coluna_especifica)` — Postgres 15+.

### 4.5 · Substituição por texto em arquivo grande é frágil

Âncoras casam no lugar errado. Já inseri código dentro de `<style>`,
dentro de string JavaScript, e dentro de outra função. **Sempre verificar
depois** onde o código foi parar (escopo, sintaxe, ordem).

Exemplo real: inserir antes de `</body>` acertou a primeira ocorrência —
que estava **dentro da string do relatório gerado** — e quebrou 3 páginas.

### 4.6 · Testar a função isolada não basta

Bug real: cada função tinha fallback offline e passava no teste, mas o
painel usava `Promise.all` e **uma** fonte sem `.catch` derrubava tudo.
**Começar o teste pela tela, não pela função.**

### 4.7 · Não afirmar garantia sem verificar o desenho

Documentei três vezes que "o servidor nunca vê o código de recuperação" —
era falso desde o início. Documentação errada é pior que bug.

### 4.8 · `now()` é fixo dentro da transação

Comparar `updated_at > created_at` no mesmo bloco dá sempre falso.

---

## 5. Método que funcionou

1. **Medir antes de opinar.** Já apontei "CSS duplicado" com base no
   número bruto; ao comparar regra a regra, eram 3, não 400.
2. **Testar no banco real**, não no código. As falhas mais graves só
   apareceram consultando dados de verdade.
3. **Bloco pequeno, teste, próximo.** Mexer em 5 páginas de uma vez foi
   como o `codes.html` sobreviveu a uma "correção completa".
4. **Falha silenciosa é o inimigo.** Vários bugs passaram semanas porque
   um `.catch(function(){})` engolia o erro. Preferir falhar alto.
5. **Documentar o que ficou de fora**, não só o que foi feito.

---

## 6. Pendências declaradas

| # | Item | Gravidade |
|---|---|---|
| 1 | Tela para o profissional **escrever** a resposta à avaliação (API `FIELDO.Avaliacoes.responder` e banco prontos) | média |
| 2 | `setText()` em `contratos.html` e `hide()` em `perfil.html` — funções mortas | baixa |
| 3 | Sem service worker (removido na v5.9 após 4 bugs) — app precisa de rede para **abrir** | média |
| 4 | `update`/`delete` exigem rede; só `create` é offline | média |
| 5 | Sem deduplicação entre dispositivos | baixa |
| 6 | Consentimento de portfólio é do profissional, não do cliente (opção B) | conhecida |
| 7 | Chave Pix é pública; se for CPF, expõe o documento | informar no cadastro |

---

## 7. Como quero que você trabalhe

- **Questione decisões ruins minhas.** Se houver caminho melhor, diga
  antes de implementar.
- **Não concorde automaticamente.** Já pedi coisas que estavam erradas
  (ex.: "vincular a licença ao id do aparelho" — a web não expõe isso).
- **Verifique antes de afirmar.** Se não deu para testar, diga que não
  deu.
- **Relate o que quebrou por sua causa**, com a mesma clareza do que
  funcionou.
- **Uma página por vez**, com teste antes de seguir.
- Português do Brasil. Comentários no código explicando **por quê**, não
  o quê.

---

## 8 · Publicação (v6.9)

**O app precisa estar publicado para os links funcionarem.** Relatório,
orçamento e avaliação são links que o CLIENTE abre no aparelho dele.

Rodando local (`127.0.0.1`), o link aponta para o celular do
profissional e não abre em lugar nenhum. O app avisa antes de enviar.

### Configuração

`db.js` → `PUBLIC_BASE_URL`

- **Publicado**: deixe vazio. O app usa a origem real automaticamente.
- **Testando local e querendo links reais**: preencha com o domínio
  publicado.

### ⚠️ Não reaproveite `fieldo.netlify.app`

Esse endereço estava fixado no código desde a v4, mas **o site foi
excluído da Netlify**. Subdomínio abandonado pode ser registrado por
qualquer pessoa — e os links do Fieldo carregam **tokens** na URL
(avaliação, aprovação de orçamento). Quem registrasse receberia os
tokens dos clientes.

Por isso o padrão passou a ser vazio: **melhor link que não abre do que
link que abre no site de um estranho.**

### Custos

O time está no plano **`nf_team_dev` (gratuito)**. HTML estático +
Supabase dificilmente estoura os limites livres (100 GB de banda/mês).
Se houve cobrança, vale conferir se era plano pago ativado sem querer,
ou cobrança do Supabase — não da Netlify.
