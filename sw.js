/* ═══════════════════════════════════════════════════════════════
   Fieldo · Service Worker — DESATIVADO (v5.9)

   ATENÇÃO: este arquivo NÃO pode ser simplesmente apagado.

   Um service worker já instalado continua rodando no aparelho mesmo
   que o arquivo suma do servidor. Apagar o sw.js deixaria a versão
   antiga viva e o usuário preso nela para sempre.

   Este é um "kill switch": ele se desregistra, apaga todos os caches
   e recarrega a página uma vez. Depois disso o app volta a funcionar
   como site normal, sem camada de cache.

   Manter este arquivo publicado por algumas semanas, até todos os
   aparelhos terem passado por ele ao menos uma vez.
═══════════════════════════════════════════════════════════════ */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* 1. Apaga todo cache criado pelas versões anteriores */
    const nomes = await caches.keys();
    await Promise.all(nomes.map((n) => caches.delete(n)));

    /* 2. Remove o próprio registro */
    await self.registration.unregister();

    /* 3. Recarrega as abas abertas, para saírem do controle do SW */
    const clientes = await self.clients.matchAll({ type: 'window' });
    clientes.forEach((c) => c.navigate(c.url));
  })());
});

/* Não intercepta mais nada: tudo vai direto para a rede. */
