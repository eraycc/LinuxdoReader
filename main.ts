import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置 ---
const DEFAULT_CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
  SCRAPE_BASE_URL: Deno.env.get("SCRAPE_BASE_URL") || "https://api.scrape.do",
  SCRAPE_TOKEN: Deno.env.get("SCRAPE_TOKEN") || "",
  // 缓存时间配置（单位：秒）
  RSS_CACHE_TTL: parseInt(Deno.env.get("RSS_CACHE_TTL") || "600"), // 默认 10 分钟
  JINA_CACHE_TTL: parseInt(Deno.env.get("JINA_CACHE_TTL") || "604800"), // 默认 7 天
};

const CATEGORIES = [
  { id: "latest", name: "最新话题", icon: "🆕", file: "latest.xml" },
  { id: "top", name: "热门话题", icon: "🔥", file: "top.xml" },
  { id: "develop", name: "开发调优", icon: "💻", file: "develop.xml" },
  { id: "resource", name: "资源荟萃", icon: "📚", file: "resource.xml" },
  { id: "wiki", name: "文档共建", icon: "📝", file: "wiki.xml" },
  { id: "welfare", name: "福利羊毛", icon: "🎁", file: "welfare.xml" },
  { id: "gossip", name: "搞七捻三", icon: "💬", file: "gossip.xml" },
  { id: "news", name: "前沿快讯", icon: "📰", file: "news.xml" },
  { id: "reading", name: "读书成诗", icon: "📖", file: "reading.xml" },
  { id: "job", name: "非我莫属", icon: "💼", file: "job.xml" },
  { id: "trade", name: "跳蚤市场", icon: "⚖️", file: "trade.xml" },
  { id: "feedback", name: "运营反馈", icon: "📊", file: "feedback.xml" },
];

// --- 缓存工具 ---

interface CacheOptions {
  ttl: number; // 缓存有效期（秒）
  cacheKey?: string; // 自定义缓存键（会被转换为有效URL）
  refresh?: boolean; // 是否强制刷新
}

/**
 * 将自定义缓存键转换为有效的 URL 格式
 * Cache API 要求 Request 必须是有效的 http/https URL
 */
function buildCacheUrl(key: string): string {
  // 如果已经是有效的 http/https URL，直接返回
  if (key.startsWith("http://") || key.startsWith("https://")) {
    return key;
  }
  // 否则构造一个虚拟的缓存 URL
  return `https://cache.local/${encodeURIComponent(key)}`;
}

async function fetchWithCache(
  url: string,
  options: CacheOptions,
  fetchOptions: RequestInit = {}
): Promise<Response> {
  const cache = await caches.open("linuxdo-reader-cache");
  const cacheKey = buildCacheUrl(options.cacheKey || url);
  const req = new Request(cacheKey);

  // 检查是否需要强制刷新
  if (!options.refresh) {
    const cached = await cache.match(req);
    if (cached) {
      // 检查缓存是否过期
      const cachedTime = cached.headers.get("x-cached-time");
      if (cachedTime) {
        const age = (Date.now() - parseInt(cachedTime)) / 1000;
        if (age < options.ttl) {
          console.log(`[缓存命中] ${options.cacheKey || url} (剩余 ${Math.round(options.ttl - age)}秒)`);
          return cached.clone();
        } else {
          console.log(`[缓存过期] ${options.cacheKey || url}`);
        }
      }
    }
  }

  console.log(`[发起请求] ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": "LinuxDOReader/13.0" },
    ...fetchOptions,
  });

  if (res.ok) {
    // 克隆响应并添加缓存时间戳
    const body = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("x-cached-time", Date.now().toString());

    const cachedResponse = new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });

    await cache.put(req, cachedResponse.clone());
    console.log(`[已缓存] ${options.cacheKey || url} (TTL: ${options.ttl}秒)`);
    return cachedResponse;
  }

  return res;
}

// --- 核心工具 ---

function proxifyImage(url: string, token: string, baseUrl: string): string {
  if (!token || !url) return url;
  const cleanBase = baseUrl.replace(/\/$/, "");

  const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(url);
  const isLinuxDoUpload = url.includes("linux.do/uploads");

  if (isImage || isLinuxDoUpload) {
    return `${cleanBase}/?token=${token}&url=${encodeURIComponent(url)}`;
  }
  return url;
}

function processHtmlImagesLazy(html: string, token: string, baseUrl: string): string {
  return html.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
    const realUrl = proxifyImage(src, token, baseUrl);
    return match
      .replace(src, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
      .replace("<img", `<img data-src="${realUrl}" class="lazy"`);
  });
}

function processMarkdownImagesLazy(md: string, token: string, baseUrl: string): string {
  return md.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
    const [cleanSrc, title] = src.split(/\s+"'/);
    const realUrl = proxifyImage(cleanSrc, token, baseUrl);
    const titleAttr = title ? ` title="${title}"` : "";
    return `<img alt="${alt}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${realUrl}" class="lazy"${titleAttr}>`;
  });
}

function unescapeHTML(str: string) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 将 UTC 时间转换为北京时间字符串
 * 格式: YYYY-MM-DD HH:mm:ss
 */
function formatToBeijingTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    // 北京时间 = UTC + 8 小时
    const beijingOffset = 8 * 60 * 60 * 1000;
    const beijingDate = new Date(date.getTime() + beijingOffset);

    const year = beijingDate.getUTCFullYear();
    const month = String(beijingDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(beijingDate.getUTCDate()).padStart(2, "0");
    const hours = String(beijingDate.getUTCHours()).padStart(2, "0");
    const minutes = String(beijingDate.getUTCMinutes()).padStart(2, "0");
    const seconds = String(beijingDate.getUTCSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return dateStr;
  }
}

interface RSSItem {
  title: string;
  link: string;
  topicId: string;
  descriptionHTML: string;
  pubDate: string;
  pubDateTimestamp: number;
  creator: string;
}

function parseRSS(xml: string, scrapeToken: string, scrapeBase: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemBlock = match[1];
    const extract = (tagName: string) => {
      const cdataRegex = new RegExp(
        `<${tagName}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`,
        "i"
      );
      const cdataMatch = itemBlock.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1];
      const normalRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
      const normalMatch = itemBlock.match(normalRegex);
      if (normalMatch) return unescapeHTML(normalMatch[1]);
      return "";
    };

    const link = extract("link").trim();
    const topicIdMatch = link.match(/\/topic\/(\d+)/);
    if (link && topicIdMatch) {
      let desc = extract("description");
      desc = processHtmlImagesLazy(desc, scrapeToken, scrapeBase);

      const pubDateStr = extract("pubDate");
      const pubDateTimestamp = new Date(pubDateStr).getTime() || 0;

      items.push({
        title: extract("title"),
        link: link,
        topicId: topicIdMatch[1],
        descriptionHTML: desc,
        pubDate: pubDateStr,
        pubDateTimestamp: pubDateTimestamp,
        creator: extract("dc:creator") || "Linux Do",
      });
    }
  }

  // 按时间降序排序（新的在前面）
  items.sort((a, b) => b.pubDateTimestamp - a.pubDateTimestamp);

  return items;
}

async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "LinuxDOReader/13.0", ...headers },
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(e);
    throw e;
  }
}

// --- CSS ---
const CSS = `
:root { --sidebar-width: 260px; --primary: #7c3aed; --primary-light: #8b5cf6; --bg: #f3f4f6; --card-bg: #fff; --text: #1f2937; --text-light: #6b7280; }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { width: var(--sidebar-width); background: #1e1e2e; color: #a6adc8; position: fixed; inset: 0 auto 0 0; z-index: 100; overflow-y: auto; transform: translateX(-100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.sidebar.open { transform: translateX(0); box-shadow: 0 0 50px rgba(0,0,0,0.5); }
.brand { padding: 1.5rem; color: #fff; font-weight: bold; font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px; }
.nav a { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; transition: all 0.2s; }
.nav a:hover { background: rgba(255,255,255,0.05); color: #fff; }
.nav a.active { background: rgba(124, 58, 237, 0.15); color: #fff; border-left: 3px solid var(--primary); }
.nav i { width: 24px; margin-right: 10px; text-align: center; opacity: 0.8; }

/* Main */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.3s; backdrop-filter: blur(3px); }
.overlay.show { opacity: 1; pointer-events: auto; }
.main { flex: 1; width: 100%; margin-left: 0; min-width: 0; }
.header { background: #fff; padding: 0.8rem 1.5rem; position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 2px rgba(0,0,0,0.03); display: flex; justify-content: space-between; align-items: center; }
.menu-btn { width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; color: var(--text); cursor: pointer; transition: all 0.2s; }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }

/* Grid & Card */
.grid {
  columns: 320px auto;
  column-gap: 1.5rem;
}
.card {
  background: var(--card-bg);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.02), 0 1px 0 rgba(0,0,0,0.02);
  border: 1px solid rgba(0,0,0,0.05);
  display: flex;
  flex-direction: column;
  position: relative;
  transition: all 0.2s ease;
  overflow: hidden;
  break-inside: avoid;
  margin-bottom: 1.5rem;
}
.card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px -5px rgba(0,0,0,0.1); border-color: rgba(124, 58, 237, 0.1); }

.card-title { 
    font-size: 1.15rem; 
    font-weight: 700; 
    margin-bottom: 0.8rem; 
    line-height: 1.4; 
    color: #111827; 
}
.card-title a {
    color: inherit;
    text-decoration: none;
    display: block;
}
.card-title a:hover { color: var(--primary); }

.card-body { 
    font-size: 0.95rem; 
    color: #4b5563; 
    line-height: 1.6; 
    margin-bottom: 1.2rem; 
    overflow-wrap: anywhere; 
    word-break: break-word;
    user-select: text; 
    -webkit-user-select: text;
    cursor: text;
}
.card-body * { max-width: 100% !important; box-sizing: border-box; }
.card-body img { 
    display: block; 
    height: auto; 
    border-radius: 8px; 
    margin: 12px 0; 
    background: #f3f4f6; 
    transition: opacity 0.3s; 
    pointer-events: auto;
    cursor: pointer;
}
.card-body pre, .card-body table { display: block; width: 100%; overflow-x: auto; background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9; margin: 10px 0; padding: 10px; }
.card-body small, .card-body a[href*="topic"] { display: none !important; }
.card-body br { display: block; content: ""; margin-bottom: 6px; }
.card-body a { pointer-events: auto; color: var(--text); text-decoration: none; cursor: text; }
img.lazy { opacity: 0.3; } img.loaded { opacity: 1; }

/* Meta Styling */
.card-meta { 
    margin-top: auto; 
    padding-top: 1rem; 
    border-top: 1px solid #f3f4f6; 
    font-size: 0.85rem; 
    color: var(--text-light); 
    display: flex; 
    justify-content: space-between; 
    align-items: center;
    margin-bottom: 1rem; 
}
.meta-item { display: flex; align-items: center; gap: 6px; }

/* Buttons */
.action-bar { display: flex; gap: 12px; position: relative; z-index: 10; }
.btn-action { 
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; 
    padding: 0.6rem; border-radius: 10px; text-decoration: none; font-size: 0.9rem; font-weight: 500;
    cursor: pointer; transition: all 0.2s; border: 1px solid #e5e7eb; background: white; color: var(--text); 
}
.btn-action.primary { background: #f5f3ff; color: var(--primary); border-color: #ddd6fe; }
.btn-action:hover { transform: translateY(-1px); filter: brightness(0.97); }

/* Reader & Settings */
.reader { background: #fff; padding: 2.5rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
.form-group { margin-bottom: 2rem; }
.form-label { display: block; margin-bottom: 0.6rem; font-weight: 600; font-size: 0.95rem; color: #374151; }
.form-input { width: 100%; padding: 0.8rem 1rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 1rem; transition: border-color 0.2s; }
.form-input:focus { border-color: var(--primary); outline: none; ring: 2px var(--primary-light); }
.form-hint { font-size: 0.85rem; color: #6b7280; margin-top: 0.5rem; line-height: 1.4; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.8rem; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 1rem; transition: background 0.2s; }
.btn:hover { background: var(--primary-light); }
.btn-outline { background: transparent; border: 1px solid #d1d5db; color: #4b5563; }

/* Cache Info */
.cache-info { font-size: 0.75rem; color: #9ca3af; text-align: center; margin-top: 1rem; padding: 0.5rem; background: #f9fafb; border-radius: 6px; }

@media (max-width: 768px) { .content { padding: 1rem; } .reader { padding: 1.5rem; } }
`;

const LAZY_LOAD_SCRIPT = `
<script>
function initLazyLoad() {
    const observer = new IntersectionObserver((entries, self) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                if (src) {
                    img.src = src;
                    img.onload = () => img.classList.add('loaded');
                    img.removeAttribute('data-src');
                    img.classList.remove('lazy');
                }
                self.unobserve(img);
            }
        });
    }, { rootMargin: "300px 0px" });
    document.querySelectorAll('img.lazy').forEach(img => observer.observe(img));
}
document.addEventListener('DOMContentLoaded', initLazyLoad);
</script>
`;

function render(body: string, activeId: string, title: string) {
  const nav = CATEGORIES.map(
    (c) =>
      `<a href="/category/${c.id}" class="${activeId === c.id ? "active" : ""}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`
  ).join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Linux DO</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>${CSS}</style></head><body><div class="overlay" onclick="toggle()"></div><nav class="sidebar" id="sb"><div class="brand"><i class="fab fa-linux"></i> Linux DO Reader</div><div class="nav"><a href="/" class="${activeId === "home" ? "active" : ""}"><i class="fas fa-home"></i> 首页广场</a>${nav}<div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div><a href="/browser" class="${activeId === "browser" ? "active" : ""}"><i class="fas fa-compass"></i> Jina 浏览器</a><a href="/settings" class="${activeId === "settings" ? "active" : ""}"><i class="fas fa-cog"></i> 系统设置</a></div></nav><div class="main"><div class="header"><button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button><h3>${title}</h3><div style="width:36px"></div></div><div class="content">${body}</div></div><script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script><script>function toggle(){document.getElementById('sb').classList.toggle('open');document.querySelector('.overlay').classList.toggle('show')}</script>${LAZY_LOAD_SCRIPT}</body></html>`;
}

function renderReaderScript(urlJS: string, backLink: string, backText: string) {
  return `
      <div class="reader">
        <div style="margin-bottom:1.5rem"><a href="${backLink}" style="color:var(--primary);text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-arrow-left"></i> ${backText}</a></div>
        <div id="load" style="text-align:center;padding:5rem"><i class="fas fa-circle-notch fa-spin fa-3x" style="color:#e5e7eb"></i><p style="margin-top:1rem;color:#9ca3af">正在渲染内容...</p></div>
        <div id="err" style="display:none;color:#b91c1c;padding:1.5rem;background:#fef2f2;border-radius:12px;border:1px solid #fecaca"></div>
        <div id="view" style="display:none">
          <h1 id="tt" style="margin-bottom:0.8rem;font-size:1.8rem;line-height:1.3;color:#111827"></h1>
          <div id="meta" style="color:#6b7280;margin-bottom:2rem;border-bottom:1px solid #e5e7eb;padding-bottom:1.5rem;display:flex;gap:15px;font-size:0.9rem"></div>
          <div id="md" class="markdown-body" style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif"></div>
        </div>
      </div>
      <script>
        (async () => {
          const h = {};
          const b = localStorage.getItem('r_base'), k = localStorage.getItem('r_key');
          const sb = localStorage.getItem('s_base'), sk = localStorage.getItem('s_key');
          if(b) h['x-base'] = b; if(k) h['x-key'] = k;
          if(sb) h['x-scrape-base'] = sb; if(sk) h['x-scrape-key'] = sk;
          try {
            const r = await fetch('/api/jina?url=' + encodeURIComponent(${urlJS}), {headers:h});
            const d = await r.json();
            if(d.error) throw new Error(d.error);
            document.getElementById('load').style.display='none';
            document.getElementById('view').style.display='block';
            document.getElementById('tt').innerText = d.title;
            document.getElementById('meta').innerHTML = '<span><i class="far fa-clock"></i> ' + (d.date||'未知时间') + '</span>' + ' <a href="'+d.url+'" target="_blank" style="color:inherit;text-decoration:none"><i class="fas fa-external-link-alt"></i> 查看原文</a>' + (d.cached ? ' <span style="color:#10b981"><i class="fas fa-bolt"></i> 已缓存</span>' : '');
            document.getElementById('md').innerHTML = marked.parse(d.markdown);
            initLazyLoad();
          } catch(e) {
            document.getElementById('load').style.display='none';
            document.getElementById('err').style.display='block';
            document.getElementById('err').innerHTML = '<strong>加载失败</strong><br>' + e.message;
          }
        })();
      </script>
    `;
}

// --- Handler ---

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Jina API 请求（带缓存）
  if (path === "/api/jina") {
    const target = url.searchParams.get("url");
    if (!target) return new Response("Miss URL", { status: 400 });

    const h: Record<string, string> = {};
    const key = req.headers.get("x-key") || DEFAULT_CONFIG.JINA_API_KEY;
    const base = req.headers.get("x-base") || DEFAULT_CONFIG.JINA_BASE_URL;
    const scrapeKey = req.headers.get("x-scrape-key") || DEFAULT_CONFIG.SCRAPE_TOKEN;
    const scrapeBase = req.headers.get("x-scrape-base") || DEFAULT_CONFIG.SCRAPE_BASE_URL;
    if (key) h["Authorization"] = `Bearer ${key}`;

    try {
      const apiUrl = target.startsWith("http")
        ? target.includes("jina.ai")
          ? target
          : `${base}/${target}`
        : `${base}/https://linux.do${target}`;

      // 使用缓存获取 Jina 结果
      const res = await fetchWithCache(
        apiUrl,
        { ttl: DEFAULT_CONFIG.JINA_CACHE_TTL, cacheKey: `jina-${encodeURIComponent(apiUrl)}` },
        { headers: h }
      );

      const text = await res.text();
      const cached = res.headers.has("x-cached-time");

      let md = text;
      const idx = text.indexOf("Markdown Content:");
      if (idx > -1) md = text.substring(idx + 17).trim();
      md = processMarkdownImagesLazy(md, scrapeKey, scrapeBase);

      const t = text.match(/Title: (.+)/),
        d = text.match(/Published Time: (.+)/),
        u = text.match(/URL Source: (.+)/);

      return new Response(
        JSON.stringify({
          title: t ? t[1] : "Reader",
          date: d ? formatToBeijingTime(d[1]) : "",
          url: u ? u[1] : target,
          markdown: md,
          cached: cached,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (path === "/settings") {
    const html = `
      <div class="reader">
        <h2 style="margin-bottom:2rem; font-size:1.5rem;"><i class="fas fa-sliders-h" style="color:var(--primary)"></i> 个性化设置</h2>
        
        <h3 style="border-bottom:1px solid #f3f4f6; padding-bottom:0.8rem; margin-bottom:1.5rem; font-size:1.1rem;">Jina AI (内容引擎)</h3>
        <div class="form-group">
            <label class="form-label">Jina Base URL</label>
            <input id="base" class="form-input" placeholder="${DEFAULT_CONFIG.JINA_BASE_URL}">
            <p class="form-hint">用于将网页转换为 Markdown 的服务地址。可以是官方 API 或自建代理。</p>
        </div>
        <div class="form-group">
            <label class="form-label">API Key (可选)</label>
            <input id="key" class="form-input" placeholder="例如: jina_xxx...">
            <p class="form-hint">如果你有 Jina Pro 账号，填入 Key 可获得更高额度。留空使用免费额度。</p>
        </div>

        <h3 style="border-bottom:1px solid #f3f4f6; padding-bottom:0.8rem; margin:2.5rem 0 1.5rem 0; font-size:1.1rem;">Scrape.do (图片加速)</h3>
        <div class="form-group">
            <label class="form-label">Scrape Base URL</label>
            <input id="s_base" class="form-input" placeholder="${DEFAULT_CONFIG.SCRAPE_BASE_URL}">
            <p class="form-hint">Scrape.do 的 API 接入点。</p>
        </div>
        <div class="form-group">
            <label class="form-label">Scrape Token</label>
            <input id="s_token" class="form-input" placeholder="例如: 4a2b...">
            <p class="form-hint"><strong>强烈推荐配置！</strong> 用于绕过 Cloudflare 盾，修复 RSS 列表和文章详情中的图片加载失败问题。</p>
        </div>

        <h3 style="border-bottom:1px solid #f3f4f6; padding-bottom:0.8rem; margin:2.5rem 0 1.5rem 0; font-size:1.1rem;">缓存配置 (服务端)</h3>
        <div class="form-group">
            <p class="form-hint">
              <i class="fas fa-info-circle"></i> 缓存由服务端管理，当前配置：<br>
              • RSS 数据缓存：<strong>${DEFAULT_CONFIG.RSS_CACHE_TTL}</strong> 秒 (${Math.round(DEFAULT_CONFIG.RSS_CACHE_TTL / 60)} 分钟)<br>
              • Jina 内容缓存：<strong>${DEFAULT_CONFIG.JINA_CACHE_TTL}</strong> 秒 (${Math.round(DEFAULT_CONFIG.JINA_CACHE_TTL / 86400)} 天)
            </p>
        </div>

        <div style="margin-top:3rem; display:flex; gap:15px;">
            <button class="btn" onclick="save()"><i class="fas fa-save"></i> 保存配置</button>
            <button class="btn btn-outline" onclick="reset()">恢复默认</button>
        </div>
      </div>
      <script>
        const $=id=>document.getElementById(id);
        $('base').value = localStorage.getItem('r_base') || '';
        $('key').value = localStorage.getItem('r_key') || '';
        $('s_base').value = localStorage.getItem('s_base') || '';
        $('s_token').value = localStorage.getItem('s_key') || '';

        function save(){
            localStorage.setItem('r_base', $('base').value.trim());
            localStorage.setItem('r_key', $('key').value.trim());
            localStorage.setItem('s_base', $('s_base').value.trim());
            localStorage.setItem('s_key', $('s_token').value.trim());
            alert('设置已保存！刷新首页即可生效。');
        }
        function reset(){ localStorage.clear(); location.reload(); }
      </script>
    `;
    return new Response(render(html, "settings", "设置"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (path === "/browser") {
    return new Response(
      render(
        `<div class="reader" style="text-align:center;padding-top:4rem"><h1>Jina Browser</h1><input id="u" class="form-input" style="max-width:600px;margin-top:1rem" placeholder="输入网址..."><button onclick="go()" class="btn" style="margin-top:1rem">开始阅读</button></div><script>function go(){const u=document.getElementById('u').value;if(u)location.href='/read?url='+encodeURIComponent(u)}</script>`,
        "browser",
        "Browser"
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (path === "/read") {
    return new Response(
      render(
        renderReaderScript(`'${url.searchParams.get("url")}'`, "/browser", "返回"),
        "browser",
        "浏览"
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (path.startsWith("/topic/")) {
    return new Response(
      render(
        renderReaderScript(
          `'/t/topic/${path.split("/")[2]}'`,
          "javascript:history.back()",
          "返回列表"
        ),
        "topic",
        "详情"
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  // 分类页面（首页和各分类）
  let catId = "latest",
    title = "最新话题";
  if (path.startsWith("/category/")) {
    catId = path.split("/")[2];
    const c = CATEGORIES.find((x) => x.id === catId);
    if (c) title = c.name;
  }

  try {
    const file = CATEGORIES.find((c) => c.id === catId)?.file || "latest.xml";
    const rssUrl = `${DEFAULT_CONFIG.RSS_BASE_URL}/${file}`;

    // 使用缓存获取 RSS（直接用 rssUrl 作为缓存键，它本身就是有效的 https URL）
    const res = await fetchWithCache(rssUrl, {
      ttl: DEFAULT_CONFIG.RSS_CACHE_TTL,
    });

    const xml = await res.text();
    const cached = res.headers.has("x-cached-time");
    const cachedTime = res.headers.get("x-cached-time");
    const cacheAge = cachedTime
      ? Math.round((Date.now() - parseInt(cachedTime)) / 1000)
      : 0;

    const scrapeKey = req.headers.get("x-scrape-key") || DEFAULT_CONFIG.SCRAPE_TOKEN;
    const scrapeBase = req.headers.get("x-scrape-base") || DEFAULT_CONFIG.SCRAPE_BASE_URL;
    const items = parseRSS(xml, scrapeKey, scrapeBase);

    const html = `
      <div class="grid">
        ${items
          .map(
            (item) => `
          <div class="card">
            <div class="card-title">
                <a href="${item.link}" target="_blank">${item.title}</a>
            </div>
            
            <div class="card-body">${item.descriptionHTML}</div>
            
            <div class="card-meta">
              <div class="meta-item">
                <i class="far fa-user-circle"></i>
                <span style="font-weight:500; color:#4b5563">${item.creator}</span>
              </div>
              <div class="meta-item">
                <i class="far fa-clock"></i>
                <span>${formatToBeijingTime(item.pubDate)}</span>
              </div>
            </div>

            <div class="action-bar">
                <a href="/topic/${item.topicId}" target="_blank" class="btn-action primary"><i class="fas fa-book-open"></i> Jina 浏览</a>
                <a href="${item.link}" target="_blank" class="btn-action"><i class="fas fa-external-link-alt"></i> 阅读原文</a>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
      <div class="cache-info">
        ${
          cached
            ? `<i class="fas fa-bolt" style="color:#10b981"></i> 数据已缓存 (${cacheAge}秒前更新，${Math.max(0, DEFAULT_CONFIG.RSS_CACHE_TTL - cacheAge)}秒后刷新)`
            : `<i class="fas fa-sync"></i> 数据已刷新`
        }
      </div>
      <script>
         document.addEventListener('DOMContentLoaded', () => {
            const token = localStorage.getItem('s_key');
            let base = localStorage.getItem('s_base');
            if(!base) base = '${DEFAULT_CONFIG.SCRAPE_BASE_URL}';

            if(token) {
                document.querySelectorAll('img.lazy').forEach(img => {
                    const o = img.getAttribute('data-src');
                    if(o && !o.includes(base)) {
                        const finalBase = base.endsWith('/') ? base : base + '/';
                        img.setAttribute('data-src', \`\${finalBase}?token=\${token}&url=\${encodeURIComponent(o)}\`);
                    }
                });
            }
            initLazyLoad();
         });
      </script>
    `;
    return new Response(render(html, catId, title), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e: any) {
    return new Response(
      render(`<div style="color:#dc2626">Error: ${e.message}</div>`, catId, "Error"),
      { headers: { "Content-Type": "text/html" } }
    );
  }
}

console.log("http://localhost:8000");
serve(handler, { port: 8000 });
