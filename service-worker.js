/* 엘리베이터 시뮬레이터 - 오프라인 지원 service worker
   ※ 파일(음원/이미지 등)을 추가하거나 고쳤다면 아래 CACHE_VERSION 숫자를 올려 주세요. */
const CACHE_VERSION = 1;
const CACHE = "elevator-sim-v" + CACHE_VERSION;

// 꼭 필요한 파일
const CORE = [
  "./elevator.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

// 음원: elevator.html 의 소리 이름 규칙과 동일 (sounds/<이름>.mp3). 아직 없는 파일은 그냥 건너뜁니다.
const SOUND_NAMES = ["close", "open", "door-open", "going-up", "going-down", "admin", "admin-off"];
for (let n = 1; n <= 20; n++) {
  SOUND_NAMES.push(String(n), n + "-cancel", "arrive-" + n, "max-" + n);
}
const SOUNDS = SOUND_NAMES.map((n) => "./sounds/" + n + ".mp3");

// 버튼 이미지 등 나중에 추가할 파일은 여기에 적어 주세요. 예: "./close.png", "./open.png"
const EXTRA = [];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map((u) => new Request(u, { cache: "reload" })));
    // 음원/이미지는 없어도 설치가 실패하지 않도록 하나씩 시도
    await Promise.allSettled([...SOUNDS, ...EXTRA].map(async (u) => {
      const res = await fetch(new Request(u, { cache: "reload" }));
      if (res.ok) await cache.put(u, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("elevator-sim-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.headers.has("range")) {            // 오디오/비디오 (특히 사파리)
    event.respondWith(handleRange(req));
  } else if (req.mode === "navigate") {      // 페이지: 온라인이면 최신, 아니면 저장본
    event.respondWith(networkFirstPage(req));
  } else {                                   // 그 외: 저장본을 먼저 쓰고 뒤에서 갱신
    event.respondWith(staleWhileRevalidate(event, req));
  }
});

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]);
    if (res.ok) cache.put("./elevator.html", res.clone());
    return res;
  } catch (e) {
    return (await cache.match("./elevator.html")) || Response.error();
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(refresh); return cached; }
  return (await refresh) || new Response("", { status: 404, statusText: "Offline" });
}

// 저장된 파일에서 요청된 구간(Range)만 잘라서 206으로 응답
async function handleRange(req) {
  const cache = await caches.open(CACHE);
  let res = await cache.match(req.url);
  if (!res) {
    try {
      const net = await fetch(req.url);
      if (!net.ok) return net;
      await cache.put(req.url, net.clone());
      res = net;
    } catch (e) {
      return new Response("", { status: 404, statusText: "Offline" });
    }
  }
  const buf = await res.arrayBuffer();
  const total = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  let start = 0, end = total - 1;
  if (m) {
    if (m[1] !== "") { start = parseInt(m[1], 10); if (m[2] !== "") end = parseInt(m[2], 10); }
    else if (m[2] !== "") { start = Math.max(0, total - parseInt(m[2], 10)); }
  }
  end = Math.min(end, total - 1);
  if (start > end) return new Response("", { status: 416, headers: { "Content-Range": "bytes */" + total } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": "bytes " + start + "-" + end + "/" + total,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
