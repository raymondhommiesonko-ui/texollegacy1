// TEXOL Collect — simple service worker
// Caches the app shell so it loads instantly and works offline.

const CACHE = 'texol-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only cache GET requests to same origin
  if (request.method !== 'GET') return
  if (!request.url.startsWith(self.location.origin)) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        // Try network first (so we always get fresh data)
        const response = await fetch(request)
        // Cache successful responses for next time
        if (response.ok) cache.put(request, response.clone())
        return response
      } catch (err) {
        // Offline — serve from cache if available
        const cached = await cache.match(request)
        if (cached) return cached
        throw err
      }
    })
  )
})