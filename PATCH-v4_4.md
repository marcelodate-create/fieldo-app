# Fieldo v4.4 — PDF do orçamento, QR Code e vínculo orçamento↔relatório

Patches **M1, M2, M3, M4, M5** + patch **L** (relatório com WhatsApp/lightbox/OG, já incluído).

## Decisões técnicas tomadas

| Item | Decisão | Razão |
|---|---|---|
| Geração de PDF | `window.print()` + `@media print` | Zero dependência, 100% offline, texto selecionável, mantém identidade visual |
| Lib QR Code | `qrcode-generator` (Kazuhiko Arase, MIT, ~39 KB local) | Standalone, funciona offline, gera SVG escalável, ideal pra impressão |
| Resolver QR→relatório | Coluna existente `reports.linked_budget_id` | Coluna já estava em produção, evitou migration |
| Vínculo automático | Sugestão + confirmação (não silencioso) | Evita match falso por nomes parecidos |
| Bug `{desc,val}` | Padronizar `{descricao,valor}` + leitura compat | Orçamentos antigos no banco seguem renderizando |

## Resumo dos patches

### M1 — Correção do bug latente em itens de orçamento (`orcamento.html`)

**Problema:** `addItem` gravava `{desc, val}`, `buildOrcamentoHTML` lia `it.descricao` / `it.qtd` / `it.preco` → **tabela de itens estava em branco em produção**.

**Correção:**
- `addItem` agora grava `{descricao, valor}` (formato canônico)
- Helpers `_itemDesc(it)` / `_itemValor(it)` lêem 3 formatos: novo, legado v4.3 `{desc,val}`, antigo `{descricao,qtd,preco}`
- `renderItens`, `calcularTotais`, `buildOrcamentoHTML` usam os helpers
- `relatorio.html#renderOrcamento` também atualizado para o mesmo formato

**Compatibilidade:** orçamentos antigos no banco com `{desc,val}` continuam renderizando.

### M2 — Resolver `?orc=ID` em `relatorio.html`

**O que faz:** quando o cliente abre `relatorio.html?orc=<budget-id>`:

1. Busca `reports?linked_budget_id=eq.<budget-id>&is_public=eq.true`
2. **Se achar**: renderiza o relatório conclusivo (mesmo render do `?id=` / `?token=`)
3. **Se não achar**: renderiza o orçamento com aviso âmbar "⏳ Acompanhamento do serviço — Em andamento. Quando o serviço for concluído, este link mostrará o relatório completo."

**Funções:**
- `_renderReport(report)` — helper que reusa `renderRelatorio(r, prof)` existente
- `renderOrcamento(orc, prof, opts)` — novo terceiro arg `opts.emAndamento` injeta o banner

**Performance:** o índice parcial `idx_reports_linked_budget_id` (em `sql/008`) garante lookup em O(log n) mesmo com milhões de reports.

### M3 — `buildOrcamentoHTML` redesenhado + botão "Baixar PDF" (`orcamento.html`)

**Identidade visual:** pergaminho `#f5f2ec` + ink `#0e0e14` + gold `#9a7218` + serif Georgia + DM Mono. Match com o resto do app.

**Conteúdo consumido (antes não renderizava):**
- Número do orçamento + data de emissão (canto superior direito do header)
- WhatsApp do cliente + local do serviço (bloco Cliente)
- Descrição do serviço (em destaque com borda gold lateral)
- Prazo, Validade, Pagamento, Garantia (bloco Condições, só aparecem se preenchidos)
- Observações (bloco discreto)
- QR Code (bloco institucional com legenda)
- Footer com identidade do profissional + WhatsApp

**Botão "Baixar PDF":**
- Função `baixarPDF()` abre HTML em nova janela com `<script>` inline que dispara `window.print()` após 650ms (tempo do QR renderizar)
- Usuário escolhe "Salvar como PDF" no diálogo nativo
- Em mobile, o overlay nativo do Chrome/Safari tem "Salvar como PDF" em destaque
- Funciona 100% offline — HTML é self-contained

**CSS Print:**
- `@page { size: A4; margin: 14mm }`
- `-webkit-print-color-adjust: exact` + `print-color-adjust: exact` (gold/pergaminho fiéis)
- `page-break-inside: avoid` em totals, client, pix, qr-wrap, cond-wrap, obs-box
- `.bar { display: none }` no print (esconde barra de ações)

### M4 — Lib `qrcode.min.js` local (~39 KB)

**Arquivo:** raiz do projeto, `qrcode.min.js`.

**Lib usada:** `qrcode-generator` v2.0.4 (Kazuhiko Arase, MIT).

**API esperada no HTML gerado:**
```js
var qr = qrcode(0, 'M');         // typeNumber=0 auto-fit, ec level M
qr.addData(url);
qr.make();
slot.innerHTML = qr.createSvgTag({ scalable: true, margin: 1 });
```

**Fallback gracioso (cascata):**
1. `qrcode.min.js` carregou → SVG inline (offline)
2. Lib falhou ao carregar → `<img>` da API `api.qrserver.com` (online)
3. API externa também falhou → texto "Acompanhe em: <URL>"

**Por que não `davidshimjs/QRCode`:** lib desatualizada, sem releases há anos, não disponível em registries permitidos. `qrcode-generator` é mais novo, ativo, e funciona perfeitamente.

### M5 — Vínculo automático orçamento↔relatório (`servico.html`)

**UX:** profissional digita nome do cliente → app busca orçamentos pendentes do mesmo cliente (sem report vinculado ainda) → banner gold aparece com sugestão → 1 clique vincula.

**Lógica de matching:**
- Normalização: lowercase + remove acentos + colapsa whitespace
- Match: igualdade exata OU prefix match em ambas direções
- Debounce 350ms (evita flood do REST enquanto digita)
- Threshold: nome ≥ 3 caracteres
- Filtro: ignora orçamentos que já têm `linked_report_id` preenchido

**Ao gerar o relatório:**
1. `Reports.create({...linked_budget_id: _linkedBudgetId})` — vínculo principal
2. `Budgets.update(_linkedBudgetId, {linked_report_id: rep.id, status: 'concluido'})` — backfill
3. Backfill é tolerante a falha: se cair, o `linked_budget_id` no report já basta pro resolver QR

**UI:**
- 1 sugestão → "Vincular" (1 clique)
- 2+ sugestões → "Escolher" → prompt nativo com lista numerada (versão inicial; UI rica pode vir em v4.5)
- Confirmado → mensagem "✓ Vinculado ao orçamento" com link "Desfazer"

### Patch L (já entregue na v4.3, incluído aqui no zip)

WhatsApp + lightbox + OG tags + card de contato no relatório de serviço.

## SQL

Arquivo novo: `sql/008_v4_4_resolver_qr_indexes.sql`

**O que faz:** cria 2 índices parciais para o resolver QR ser rápido em produção.

**Não cria colunas** — `reports.linked_budget_id` e `budgets.linked_report_id` já existiam.

**Como rodar:** SQL Editor do Supabase, projeto `jrsctnncoljdcvdofxsg`. Cole o conteúdo e rode. Idempotente (`IF NOT EXISTS`).

**Reversível:**
```sql
DROP INDEX IF EXISTS idx_reports_linked_budget_id;
DROP INDEX IF EXISTS idx_budgets_linked_report_id;
```

## Estado do banco no momento desta entrega

- 8 reports, 10 budgets
- 0 vínculos populados (estado limpo)
- RLS habilitada em todas as tabelas com policies permissivas `USING true` — funcionalmente equivalente a sem-RLS, mas registrado pra futuro endurecimento (Fase 5 do roadmap)

## Compatibilidade

| Cenário | Status |
|---|---|
| Orçamentos antigos com `{desc,val}` no JSONB | ✅ Renderizam normal (helpers compat) |
| Relatórios já gerados (HTML estático no cliente) | ✅ Imutáveis, não mudam |
| QR sem internet | ✅ Lib local gera SVG offline |
| Lib local falhou | ✅ Fallback online (api.qrserver.com) |
| Browser antigo sem `window.print()` PDF | ⚠️ Vai imprimir físico ou pedir destino (caso esperado) |
| Cliente abre QR antes do serviço concluído | ✅ Vê o orçamento + aviso "Em andamento" |
| Cliente abre QR depois do serviço concluído | ✅ Vê o relatório completo |
| Profissional digita errado o nome do cliente | ✅ Não vincula (match falso é evitado por confirmação visual) |
| API pública do Supabase muda | ✅ Sem impacto (uso de `linked_budget_id` é coluna padrão) |

## Mudanças por arquivo

| Arquivo | Linhas antes | Linhas depois | Delta |
|---|---|---|---|
| `db.js` | 2828 | 2828 | 0 (sem mudança) |
| `orcamento.html` | 562 | 805 | +243 |
| `servico.html` | 746 | 908 | +162 |
| `relatorio.html` | 600 | 643 | +43 |
| `qrcode.min.js` | — | 1 file | novo (~39 KB) |
| `sql/008_*.sql` | — | 1 file | novo |
| `docs/PATCH-v4.4.md` | — | 1 file | novo (este) |

## Testes obrigatórios antes do deploy

### Patch M1 (orçamento — bug latente)
1. Abrir `orcamento.html` → adicionar 3 itens com valores → ir até Pré-visualizar
2. Confirmar que os 3 itens aparecem na tabela com descrição + valor
3. Abrir um orçamento antigo do banco via `relatorio.html?orc=<id>` → itens devem aparecer (compat)

### Patch M2 (resolver QR)
1. Pegar um `budget.id` qualquer (sem report vinculado): abrir `relatorio.html?orc=<id>` → ver orçamento + banner "⏳ Em andamento"
2. Manualmente: `UPDATE reports SET linked_budget_id='<budget-id>', is_public=true WHERE id='<report-id>';`
3. Abrir mesma URL `relatorio.html?orc=<budget-id>` → agora vê o **relatório**, não o orçamento

### Patch M3 (PDF + visual)
1. Gerar orçamento preenchendo TODOS os campos (cliente, WhatsApp, local, prazo, validade, pagamento, garantia, obs, 3 itens, desconto)
2. Clicar "Baixar PDF" → janela nova abre → diálogo de impressão automático
3. "Salvar como PDF" → arquivo gerado bate com a identidade Fieldo
4. Imprimir físico — cores gold/pergaminho devem aparecer (com `print-color-adjust:exact`)
5. Gerar orçamento minimalista (só obrigatórios) → seções opcionais somem do HTML

### Patch M4 (QR)
1. Online + lib local OK → QR como SVG nítido
2. Bloquear `qrcode.min.js` no DevTools → recarregar → QR vira `<img>` da api.qrserver.com
3. Bloquear `api.qrserver.com` também → texto fallback "Acompanhe em: <URL>"
4. Ler o QR com celular → abre `relatorio.html?orc=<id>` corretamente

### Patch M5 (vínculo automático)
1. Criar 2 orçamentos pra "Maria Aparecida" sem gerar relatório
2. Em `servico.html`, digitar "Maria" → banner "2 orçamentos pendentes — Escolher"
3. Clicar "Escolher" → prompt com lista → escolher 1 → "Vinculado ✓"
4. "Desfazer" → banner volta pra estado de sugestão
5. Gerar o relatório → confirmar no Supabase:
   ```sql
   SELECT id, linked_budget_id FROM reports ORDER BY created_at DESC LIMIT 1;
   SELECT id, linked_report_id, status FROM budgets WHERE id='<linked_budget_id>';
   ```
   Os dois lados devem estar populados, status do budget = 'concluido'

## Plano de rollback

```bash
# Por patch (a partir do release v4.3):
cp orcamento.html.before-M1 orcamento.html   # reverte M1+M3
cp relatorio.html.before-M2 relatorio.html   # reverte M2
cp servico.html.before-M5 servico.html       # reverte M5

# Lib QR
rm qrcode.min.js

# SQL (no Supabase)
DROP INDEX IF EXISTS idx_reports_linked_budget_id;
DROP INDEX IF EXISTS idx_budgets_linked_report_id;

# Atenção: os reports já criados no banco com linked_budget_id NÃO precisam
# ser limpos — a coluna existe e é nullable; rollback não os apaga.
```

## Próximas direções sugeridas (não estão neste patch)

- **Patch H (remover OTP)** — você pediu, mas separamos. Pode entrar em v4.5.
- **Fortalecer RLS** — substituir `USING true` por policies que dependem de `linked_budget_id` ou similar pra leitura pública (Fase 5).
- **UI rica de escolha de orçamento** — quando há 2+ sugestões, substituir `prompt()` por modal.
- **Edge Function para QR** — mover geração do QR pra serverside permite QRs assinados HMAC, evitando spoof.
- **Assinatura digital do orçamento** — `signatures` já existe no banco, é tabela latente esperando uso.
