# Fieldo v3.1 — Patch de problemas reportados

## Sumário

3 problemas corrigidos:

1. **Página admin não abre** → gate flexível, aceita login por telefone OU email
2. **Magic link não funciona** → callback resiliente + mensagens de erro diagnósticas
3. **Orçamento sem HTML + listagem no dashboard** → HTML local + URL pública + reenvio

---

## 1. Admin (`admin/codes.html`) — gate dual-path

**Antes:** exigia `AuthEmail.isLoggedIn()` E `app_metadata.role === 'admin'`.
Resultado: usuário logado por telefone era redirecionado para entrar.html sem nem chegar no painel.

**Agora:** aceita qualquer login (telefone ou email) e checa admin por dois caminhos:
1. JWT `app_metadata.role === 'admin'` (caminho oficial Supabase Auth)
2. `professionals.is_admin === true` (caminho durante Fase A da migração)

Se nenhum dos dois, mostra tela "Acesso restrito" com instrução SQL pronta para auto-promoção:

```sql
UPDATE professionals SET is_admin = true WHERE phone = '5511999999999';
```

**Migration nova:** `sql/007_admin_flag.sql` adiciona coluna `is_admin` em `professionals` e atualiza `is_fieldo_admin()` para considerar os dois caminhos.

### Como usar agora

1. Rode `sql/007_admin_flag.sql` no Supabase Dashboard
2. Execute `UPDATE professionals SET is_admin = true WHERE phone = 'SEU_TELEFONE';` (telefone com prefixo 55, sem espaços/parênteses)
3. Abra `admin/codes.html` — deve funcionar

---

## 2. Magic link — callback resiliente

**Possíveis causas (corrigidas todas):**

| Causa | Sintoma anterior | Correção |
|---|---|---|
| Migrations 001 não rodadas | Coluna `email` não existe → callback falha silenciosamente | Detecção de erro 400 com mensagem clara: "execute migration 001" |
| Redirect URL não autorizada | Erro genérico no console | Mensagem específica indicando o URL exato a adicionar no Supabase |
| `email` rejeitado por NOT NULL em `phone` | Falha ao criar professional novo | Fallback automático: tenta com colunas novas, se falhar usa apenas `name` + placeholder de phone |
| Erro vindo na URL (`?error=...`) | Callback nunca rodava | Detector inicial de query/hash params com `error_description` |

**Mensagens de erro novas em `entrar.html`:**

- "Configuração: adicione `https://seu-site/entrar.html` em Supabase → Authentication → URL Configuration → Redirect URLs"
- "Muitas tentativas. Aguarde alguns minutos." (rate limit)
- "Configuração incompleta — execute migration 001 no Supabase"
- Detalhe técnico mostrado em monospace para suporte/debug

### Checklist para o magic link funcionar

1. ✅ **Supabase Dashboard → Authentication → URL Configuration**
   - Site URL: `https://seu-site.netlify.app`
   - Redirect URLs (uma por linha): `https://seu-site.netlify.app/entrar.html`
2. ✅ **Migrations 001 → 005 rodadas** (verificar com `SELECT * FROM v_auth_migration_status;`)
3. ✅ **Email provider configurado** (Authentication → Providers → Email habilitado)

Se ainda assim falhar, abra o console do browser ao clicar no link — agora a mensagem te diz exatamente o que está faltando.

---

## 3. Orçamento — HTML local + URL pública + listagem

### 3a. Geração de HTML local
Quando você gera um orçamento, agora aparecem 4 botões na tela final:

- **Enviar pelo WhatsApp** — abre wa.me com mensagem + link público
- **Baixar HTML** — salva o arquivo no celular
- **Pré-visualizar** — abre numa nova aba para ver antes de enviar
- **Ir ao dashboard**

### 3b. URL pública
A URL `https://seu-site/relatorio.html?orc=ID-DO-ORCAMENTO` agora renderiza o orçamento publicamente (sem login). Cliente pode:
- Ver o orçamento completo
- Ver dados do profissional (foto, profissão, cidade)
- Ver itens, totais, prazo, validade
- Copiar chave Pix
- Falar com profissional pelo WhatsApp

### 3c. Listagem no dashboard
A tab "Orçamentos" do dashboard agora lista os 5 mais recentes com:
- Nome do cliente + status (pendente/aprovado/recusado)
- Título + data
- Total em destaque
- **Botão de reenvio** (↗) — abre WhatsApp com link público

A mesma lógica de reenvio foi adicionada para **relatórios** — botão ↗ ao lado de cada item da lista de Serviços recentes, abre WhatsApp com o link `avaliar.html?token=...`

---

## Arquivos modificados

```
admin/codes.html       gate dual-path com diagnóstico
entrar.html            callback resiliente + mensagens diagnósticas
orcamento.html         buildOrcamentoHTML + baixar/abrir + URL pública no WA
relatorio.html         carregarOrcamentoPublico() para ?orc=
index.html             tab Orçamentos preenchida + reenvio em ambas listas
fieldo.css             .reenvio-btn (botão flutuante ↗)
sql/007_admin_flag.sql migration nova: is_admin em professionals
```

---

## Ordem para aplicar

1. **Substituir frontend no Netlify** (zip novo)
2. **Rodar `sql/007_admin_flag.sql`** no Supabase Dashboard
3. **Executar** `UPDATE professionals SET is_admin = true WHERE phone = 'SEU_TELEFONE';`
4. **Abrir admin** — deve funcionar
5. Se magic link ainda falhar, **abrir console** ao clicar no link — a mensagem diagnostica o problema (provavelmente Redirect URL faltando no Supabase Dashboard)
