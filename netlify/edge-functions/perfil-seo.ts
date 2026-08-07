// Fieldo v7.7 · Edge Function "perfil-seo"
//
// Reconstrução da function de SEO server-side do perfil.html. A anterior
// (perfil-sso.js, nome inferido) já preenchia title/description/OG/robots
// corretamente — confirmei isso buscando a página ao vivo antes de mexer
// aqui. O que faltava, e é o motivo desta reconstrução: o CORPO da página
// (nome, cidade, nota, contagens, bio) continuava chegando vazio no HTML
// que um crawler sem JS recebe — só "Carregando…" e "—". Só metadado sem
// conteúdo ranqueia mal: o Google sabe que a página existe, mas não tem
// texto pra associar às buscas.
//
// Estratégia: NÃO reconstruir o perfil.html inteiro no servidor (isso
// duplicaria toda a lógica de renderização que já existe em JS, e viraria
// dois lugares pra manter sincronizados). Em vez disso, busca os dados
// públicos (via a view professional_stats — mesma agregação que
// explorar.html já usa, uma query só) e faz substituições cirúrgicas no
// HTML estático que o Netlify serve, ancoradas nos IDs que o JS cliente
// já usa. Quando o JS carrega depois, ele sobrescreve os mesmos elementos
// com dados frescos — não há conflito, é hidratação normal.
//
// Falha de rede, profissional não encontrado, ou perfil privado (a view
// só devolve linhas is_public=true) → devolve a página padrão sem
// modificar nada. Nunca quebra a página por causa de SEO.

import type { Context, Config } from "@netlify/edge-functions";

const SUPABASE_URL = "https://jrsctnncoljdcvdofxsg.supabase.co";
// Anon key — não é segredo (já está hardcoded em db.js, servido a
// qualquer visitante; a proteção real é a RLS do Postgres, não esconder
// esta string). Por isso não precisa de variável de ambiente aqui.
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impyc2N0bm5jb2xqZGN2ZG9meHNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTEzMzgsImV4cCI6MjA5MDc4NzMzOH0.XJj5d37fOgK4nN9B3xI_x7P1HE_4lvnYC_qx_5eF0FI";

interface ProfStats {
  id: string;
  name: string | null;
  profissao: string | null;
  city: string | null;
  logo_url: string | null;
  bio: string | null;
  media_geral: string | null; // vem como texto do Postgres (numeric), ex. "4.9"
  total_geral: number;
  total_servicos_confirmados: number;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function buscarProfissional(
  slug: string | null,
  id: string | null,
): Promise<ProfStats | null> {
  if (!slug && !id) return null;

  const filtro = slug
    ? `slug=eq.${encodeURIComponent(slug)}`
    : `id=eq.${encodeURIComponent(id!)}`;
  const url =
    `${SUPABASE_URL}/rest/v1/professional_stats?${filtro}` +
    `&select=id,name,profissao,city,logo_url,bio,media_geral,total_geral,total_servicos_confirmados&limit=1`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);

  try {
    const r = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const rows: ProfStats[] = await r.json();
    return rows[0] || null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function substituirTexto(
  html: string,
  aberturaExata: string,
  fechamento: string,
  novoConteudo: string,
): string {
  const idx = html.indexOf(aberturaExata);
  if (idx === -1) return html;
  const fim = html.indexOf(fechamento, idx + aberturaExata.length);
  if (fim === -1) return html;
  return (
    html.slice(0, idx + aberturaExata.length) +
    novoConteudo +
    html.slice(fim)
  );
}

function substituirAtributo(
  html: string,
  aberturaExata: string,
  novoValor: string,
): string {
  const idx = html.indexOf(aberturaExata);
  if (idx === -1) return html;
  return html.slice(0, idx) + novoValor + html.slice(idx + aberturaExata.length);
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const id = url.searchParams.get("id");

  const prof = await buscarProfissional(slug, id);
  const resposta = await context.next();

  if (!prof) return resposta;

  let html = await resposta.text();

  const nome = prof.name || prof.profissao || "Profissional";
  const profissaoTexto = prof.profissao || "";
  const profissaoDesc = prof.profissao || "profissional";
  const cidade = prof.city || "";
  const totalServicos = prof.total_servicos_confirmados || 0;
  const totalAvals = prof.total_geral || 0;
  const nota = prof.media_geral ? parseFloat(prof.media_geral) : 0;

  const title = `${escHtml(nome)} · Fieldo`;
  const desc = escHtml(
    `Perfil verificado de ${profissaoDesc}` +
      (cidade ? ` em ${cidade}` : "") +
      `. ${totalServicos} serviço${totalServicos === 1 ? "" : "s"} realizado${totalServicos === 1 ? "" : "s"}.`,
  );

  html = substituirTexto(html, '<title id="pageTitle">', "</title>", title);
  html = substituirAtributo(
    html,
    '<meta name="description" id="metaDesc" content="Perfil de profissional verificado no Fieldo"/>',
    `<meta name="description" id="metaDesc" content="${desc}"/>`,
  );
  html = substituirAtributo(
    html,
    '<meta property="og:title" id="ogTitle" content="Profissional · Fieldo"/>',
    `<meta property="og:title" id="ogTitle" content="${title}"/>`,
  );
  html = substituirAtributo(
    html,
    '<meta property="og:description" id="ogDesc" content="Veja o histórico e avaliações verificadas"/>',
    `<meta property="og:description" id="ogDesc" content="${desc}"/>`,
  );

  if (totalServicos >= 3) {
    html = substituirAtributo(
      html,
      '<meta name="robots" content="noindex"/>',
      '<meta name="robots" content="index,follow"/>',
    );
  }

  const canonicalUrl = `${url.origin}/perfil.html?slug=${encodeURIComponent(slug || prof.id)}`;
  let injecaoHead = `<link rel="canonical" href="${canonicalUrl}"/>\n` +
    `<meta property="og:url" content="${canonicalUrl}"/>\n`;
  if (prof.logo_url) {
    injecaoHead += `<meta property="og:image" content="${escHtml(prof.logo_url)}"/>\n`;
  }

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: nome,
    description: prof.bio || desc,
    areaServed: cidade,
  };
  if (totalAvals > 0 && nota > 0) {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: nota.toFixed(1),
      reviewCount: String(totalAvals),
      bestRating: "5",
      worstRating: "1",
    };
  }
  injecaoHead += `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`;

  html = html.replace("</head>", injecaoHead + "</head>");

  html = substituirTexto(html, '<div class="hero-name" id="heroName">', "</div>", escHtml(nome));
  html = substituirTexto(html, '<div class="hero-spec" id="heroSpec">', "</div>", escHtml(profissaoTexto));
  if (cidade) {
    html = substituirTexto(html, '<div class="hero-city" id="heroCity">', "</div>", escHtml(cidade));
  }
  if (prof.logo_url) {
    html = substituirTexto(
      html,
      '<div class="hero-avatar" id="heroAvatar">',
      "</div>",
      `<img src="${escHtml(prof.logo_url)}" alt=""/>`,
    );
  }
  if (totalServicos > 0) {
    html = substituirAtributo(
      html,
      '<div class="hero-verified" style="display:none" id="heroVerified">',
      '<div class="hero-verified" id="heroVerified">',
    );
  }
  if (nota > 0 || totalAvals > 0) {
    html = substituirAtributo(
      html,
      '<div class="hero-score-row" id="heroScoreRow" style="display:none">',
      '<div class="hero-score-row" id="heroScoreRow">',
    );
    if (nota > 0) {
      html = substituirTexto(html, '<div class="hero-stat-val" id="heroScore"><em>', "</em>", escHtml(nota.toFixed(1)));
      const cheias = Math.round(nota);
      const estrelas = "★".repeat(cheias) + "☆".repeat(5 - cheias);
      html = substituirTexto(html, '<div class="hero-stat-stars" id="heroStars">', "</div>", estrelas);
    }
    html = substituirTexto(html, '<div class="hero-stat-val" id="heroAvals">', "</div>", String(totalAvals || "—"));
    html = substituirTexto(html, '<div class="hero-stat-val" id="heroServicos">', "</div>", String(totalServicos || "—"));
  }
  if (prof.bio) {
    html = substituirAtributo(
      html,
      '<div id="bioWrap" style="display:none">',
      '<div id="bioWrap">',
    );
    html = substituirTexto(html, '<p class="bio-text" id="bioText">', "</p>", escHtml(prof.bio));
  }

  return new Response(html, {
    status: resposta.status,
    headers: resposta.headers,
  });
};

export const config: Config = {
  path: "/perfil.html",
};
