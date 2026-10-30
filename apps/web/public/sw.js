// 루나 서비스 워커: 한 번 본 페이지와 자산을 Cache Storage에 두고 다음 방문부터 바로 꺼낸다.
// - 페이지(HTML): 캐시를 먼저 보여 주고 뒤에서 새 HTML로 바꿔 둔다(stale-while-revalidate). 주 메뉴 5개만 다룬다.
// - /_astro/*: 파일 이름에 내용 해시가 붙어 바뀌지 않으므로 캐시에 있으면 네트워크에 묻지 않는다.
// - /intro/* 사진·파비콘: 캐시를 먼저 쓰고 뒤에서 갱신한다.
// - /img/* 사진, 다른 출처, /admin 은 건드리지 않는다. 사진은 1년 immutable HTTP 캐시로 충분하다.
// 쿠키는 요청마다 서버로 실려 가고 4KB 남짓이라 자산 캐시로 쓸 수 없다. 그래서 Cache Storage를 쓴다.
// 캐시 형식을 바꿀 때만 VERSION을 올린다(예전 캐시는 activate에서 지운다).
const VERSION = 'v1';
const PAGES = `luna-pages-${VERSION}`;
const ASSETS = `luna-assets-${VERSION}`;
const NAV = ['/', '/members', '/projects', '/awards', '/faq'];

const pageKey = (url) => url.pathname.replace(/(\.html|\/)$/, '') || '/';
const isPage = (url) => NAV.includes(pageKey(url));
const saveData = () => self.navigator.connection?.saveData === true;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [PAGES, ASSETS];
      for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
      await warm();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if (isPage(url)) event.respondWith(page(event, url));
    return;
  }
  if (url.pathname.startsWith('/_astro/')) event.respondWith(immutable(request));
  else if (url.pathname.startsWith('/intro/') || url.pathname === '/favicon.svg')
    event.respondWith(revalidate(event, request));
});

async function page(event, url) {
  const cache = await caches.open(PAGES);
  const key = pageKey(url);
  const cached = await cache.match(key);
  const network = (async () => {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    if (response.ok && !response.redirected) {
      // 화면에는 바로 넘기고, 캐시 저장·자산 받기는 뒤에서 한다.
      const forCache = response.clone();
      const forScan = response.clone();
      event.waitUntil(
        (async () => {
          await cache.put(key, forCache);
          await cacheAssets(await forScan.text());
          await prune();
        })(),
      );
    }
    return response;
  })();
  if (!cached) return network;
  event.waitUntil(network.catch(() => {}));
  return cached;
}

async function immutable(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function revalidate(event, request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (!cached) return network;
  event.waitUntil(network.catch(() => {}));
  return cached;
}

const assetRefs = (html) => new Set(html.match(/\/_astro\/[\w.-]+\.(?:js|css)/g) ?? []);

/** 캐시에 넣은 HTML이 쓰는 JS·CSS도 같이 받아 둔다. 배포 뒤 예전 HTML이 나와도 그 HTML의 자산이 캐시에 있다. */
async function cacheAssets(html) {
  const cache = await caches.open(ASSETS);
  await Promise.all(
    [...assetRefs(html)].map(async (path) => {
      if (await cache.match(path)) return;
      const response = await fetch(path);
      if (response.ok) await cache.put(path, response);
    }),
  );
}

/** 처음 설치될 때 주 메뉴 페이지를 미리 받아 둔다(데이터 절약 모드면 건너뜀). */
async function warm() {
  if (saveData()) return;
  const cache = await caches.open(PAGES);
  for (const path of NAV) {
    if (await cache.match(path)) continue;
    try {
      const response = await fetch(path, { credentials: 'same-origin' });
      if (!response.ok || response.redirected) continue;
      await cache.put(path, response.clone());
      await cacheAssets(await response.text());
    } catch {
      return;
    }
  }
  await prune(true);
}

let lastPrune = 0;
/** 어느 캐시 페이지도 쓰지 않는 예전 배포의 JS·CSS를 지운다(폰트는 그대로 둔다). 1분에 한 번만. */
async function prune(force = false) {
  if (!force && Date.now() - lastPrune < 60_000) return;
  lastPrune = Date.now();
  const pages = await caches.open(PAGES);
  const used = new Set();
  for (const request of await pages.keys()) {
    const response = await pages.match(request);
    if (response) for (const ref of assetRefs(await response.text())) used.add(ref);
  }
  const assets = await caches.open(ASSETS);
  for (const request of await assets.keys()) {
    const path = new URL(request.url).pathname;
    if (/\.(js|css)$/.test(path) && path.startsWith('/_astro/') && !used.has(path))
      await assets.delete(request);
  }
}
