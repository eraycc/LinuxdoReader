// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { parse } from "https://deno.land/x/xml@2.1.1/mod.ts";

// ==================== 类型定义 ====================

interface Config {
  RSS_BASE_URL: string;
  JINA_BASE_URL: string;
  JINA_API_KEY: string;
  SCRAPE_BASE_URL: string;
  SCRAPE_TOKEN: string;
  RSS_CACHE_TTL: number; // 毫秒
  JINA_CACHE_TTL: number; // 毫秒
}

interface RSSItem {
  title: string;
  link: string;
  topicId: string;
  descriptionHTML: string;
  pubDate: string;
  creator: string;
}

interface JinaResult {
  title: string;
  date: string;
  url: string;
  markdown: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ==================== 配置管理 ====================

function getConfig(req?: Request): Config {
  return {
    RSS_BASE_URL: req?.headers.get("x-rss-base") ?? 
                  Deno.env.get("RSS_BASE_URL") ?? 
                  "https://linuxdorss.longpink.com",
    JINA_BASE_URL: req?.headers.get("x-jina-base") ?? 
                   Deno.env.get("JINA_BASE_URL") ?? 
                   "https://r.jina.ai",
    JINA_API_KEY: req?.headers.get("x-jina-key") ?? 
                  Deno.env.get("JINA_API_KEY") ?? "",
    SCRAPE_BASE_URL: req?.headers.get("x-scrape-base") ?? 
                     Deno.env.get("SCRAPE_BASE_URL") ?? 
                     "https://api.scrape.do",
    SCRAPE_TOKEN: req?.headers.get("x-scrape-token") ?? 
                  Deno.env.get("SCRAPE_TOKEN") ?? "",
    RSS_CACHE_TTL: parseInt(Deno.env.get("RSS_CACHE_TTL_MS") ?? "600000", 10),
    JINA_CACHE_TTL: parseInt(Deno.env.get("JINA_CACHE_TTL_MS") ?? "604800000", 10),
  };
}

// ==================== 缓存管理 ====================
// 使用 Deno Cache API + 内存缓存
class CacheManager {
  private static memoryCache = new Map<string, CacheEntry<any>>();
  private static cacheName = "linuxdo-reader-v1";

  static async get<T>(key: string, ttl: number): Promise<T | null> {
    // 1. 检查内存缓存
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && Date.now() - memoryEntry.timestamp < ttl) {
      console.log(`[Memory Cache Hit] ${key}`);
      return memoryEntry.data;
    }

    // 2. 检查 Cache API
    try {
      const cache = await caches.open(this.cacheName);
      const request = new Request(key);
      const cachedResponse = await cache.match(request);
      
      if (cachedResponse) {
        const age = Date.now() - new Date(cachedResponse.headers.get("date") || "").getTime();
        if (age < ttl) {
          console.log(`[Cache API Hit] ${key}`);
          const data = await cachedResponse.json();
          // 同步到内存缓存
          this.memoryCache.set(key, { data, timestamp: Date.now() });
          return data;
        } else {
          await cache.delete(request);
        }
      }
    } catch (e) {
      console.warn("[Cache API Error]", e);
    }

    return null;
  }

  static async set<T>(key: string, data: T): Promise<void> {
    // 内存缓存
    this.memoryCache.set(key, { data, timestamp: Date.now() });
    
    // Cache API
    try {
      const cache = await caches.open(this.cacheName);
      const response = new Response(JSON.stringify(data), {
        headers: {
          "Content-Type": "application/json",
          "date": new Date().toISOString(),
        },
      });
      await cache.put(new Request(key), response);
    } catch (e) {
      console.warn("[Cache API Set Error]", e);
    }
  }

  static clearMemory(): void {
    this.memoryCache.clear();
  }
}

// ==================== XML解析器（带降级） ====================

function unescapeHTML(str: string): string {
  if (!str) return "";
  return str.replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, "&");
}

function parseRSSWithRegex(xml: string, scrapeToken: string, scrapeBase: string): RSSItem[] {
  console.warn("[RSS Parser] 使用正则降级模式");
  const items: RSSItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemBlock = match[1];
    const extract = (tagName: string): string => {
      const cdataRegex = new RegExp(`<${tagName}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, "i");
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

      items.push({
        title: extract("title"),
        link,
        topicId: topicIdMatch[1],
        descriptionHTML: desc,
        pubDate: extract("pubDate"),
        creator: extract("dc:creator") || "Linux Do",
      });
    }
  }
  return items;
}

function parseRSS(xml: string, scrapeToken: string, scrapeBase: string): RSSItem[] {
  try {
    const doc = parse(xml);
    const channel = doc?.rss?.channel;
    if (!channel) throw new Error("Invalid RSS structure");
    
    const items: RSSItem[] = [];
    const entries = Array.isArray(channel.item) ? channel.item : [channel.item];
    
    for (const entry of entries) {
      if (!entry) continue;
      
      const link = extractXMLValue(entry.link) || "";
      const topicIdMatch = link.match(/\/topic\/(\d+)/);
      
      if (link && topicIdMatch) {
        let desc = extractXMLValue(entry.description) || "";
        desc = processHtmlImagesLazy(desc, scrapeToken, scrapeBase);

        items.push({
          title: extractXMLValue(entry.title) || "无标题",
          link,
          topicId: topicIdMatch[1],
          descriptionHTML: desc,
          pubDate: extractXMLValue(entry.pubDate) || "",
          creator: extractXMLValue(entry["dc:creator"]) || "Linux Do",
        });
      }
    }
    
    return items;
  } catch (e) {
    console.error("[RSS Parser Error]", e);
    return parseRSSWithRegex(xml, scrapeToken, scrapeBase);
  }
}

function extractXMLValue(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node["#text"]) return node["#text"];
  return String(node);
}

// ==================== 图片处理 ====================

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function proxifyImage(url: string, token: string, baseUrl: string): string {
  if (!token || !url) return url;
  
  const cleanUrl = normalizeBaseUrl(baseUrl);
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(url);
  const isLinuxDoUpload = url.includes("linux.do/uploads");
  
  if (isImage || isLinuxDoUpload) {
    const params = new URLSearchParams({
      token,
      url,
      format: "webp",
      quality: "85",
    });
    return `${cleanUrl}/?${params.toString()}`;
  }
  return url;
}

function processHtmlImagesLazy(html: string, token: string, baseUrl: string): string {
  return html.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
    const realUrl = proxifyImage(src, token, baseUrl);
    return match.replace(src, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
                .replace("<img", `<img data-src="${realUrl}" class="lazy" loading="lazy"`);
  });
}

function processMarkdownImagesLazy(md: string, token: string, baseUrl: string): string {
  return md.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
    const parts = src.split(/\s+['"](.*)['"]?/);
    const cleanSrc = parts[0];
    const title = parts[1];
    const realUrl = proxifyImage(cleanSrc, token, baseUrl);
    const titleAttr = title ? ` title="${title}"` : "";
    return `<img alt="${alt}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${realUrl}" class="lazy" loading="lazy"${titleAttr}>`;
  });
}

// ==================== 请求代理 ====================

async function proxyRequest(url: string, headers: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "LinuxDOReader/2.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...headers,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    if (!res.headers.get("content-type")?.includes("text")) {
      throw new Error("Non-text response");
    }
    
    return await res.text();
  } catch (e) {
    clearTimeout(timeoutId);
    console.error(`[Proxy Error] ${url}:`, e);
    throw e;
  }
}

// ==================== 渲染器 ====================

const CSS = `
:root {
  --sidebar-width: 260px;
  --primary: #7c3aed;
  --primary-light: #8b5cf6;
  --bg: #f3f4f6;
  --card-bg: #fff;
  --text: #1f2937;
  --text-light: #6b7280;
  --border: rgba(0,0,0,0.05);
  --shadow: rgba(0,0,0,0.1);
}

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
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
.card { background: var(--card-bg); border-radius: 16px; padding: 1.5rem; box-shadow: 0 2px 4px var(--shadow), 0 1px 0 var(--border); border: 1px solid var(--border); display: flex; flex-direction: column; position: relative; transition: all 0.2s ease; overflow: hidden; }
.card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px -5px var(--shadow); border-color: rgba(124, 58, 237, 0.1); }

.card-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.8rem; line-height: 1.4; color: #111827; }
.card-title a { color: inherit; text-decoration: none; display: block; }
.card-title a:hover { color: var(--primary); }

.card-body { font-size: 0.95rem; color: #4b5563; line-height: 1.6; margin-bottom: 1.2rem; overflow-wrap: anywhere; word-break: break-word; user-select: text; -webkit-user-select: text; cursor: text; }
.card-body * { max-width: 100% !important; box-sizing: border-box; }
.card-body img { display: block; height: auto; border-radius: 8px; margin: 12px 0; background: #f3f4f6; transition: opacity 0.3s; pointer-events: auto; cursor: pointer; }
.card-body a { pointer-events: auto; color: var(--text); text-decoration: none; cursor: text; }
.card-body pre, .card-body table { display: block; width: 100%; overflow-x: auto; background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9; margin: 10px 0; padding: 10px; }
.card-body small, .card-body a[href*="topic"] { display: none !important; }
.card-body br { display: block; content: ""; margin-bottom: 6px; }

/* Lazy Load */
img.lazy { opacity: 0.3; transition: opacity 0.5s; }
img.loaded { opacity: 1; }
img[data-src] { min-height: 100px; background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: loading 1.5s infinite; }
@keyframes loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* Meta */
.card-meta { margin-top: auto; padding-top: 1rem; border-top: 1px solid #f3f4f6; font-size: 0.85rem; color: var(--text-light); display: flex; justify-content: space-between; align-items: center; }
.meta-item { display: flex; align-items: center; gap: 6px; }

/* Buttons */
.action-bar { display: flex; gap: 12px; position: relative; z-index: 10; }
.btn-action { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0.6rem; border-radius: 10px; text-decoration: none; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: all 0.2s; border: 1px solid #e5e7eb; background: white; color: var(--text); }
.btn-action.primary { background: #f5f3ff; color: var(--primary); border-color: #ddd6fe; }
.btn-action:hover { transform: translateY(-1px); filter: brightness(0.97); }

/* Reader & Settings */
.reader { background: #fff; padding: 2.5rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
.form-group { margin-bottom: 2rem; }
.form-label { display: block; margin-bottom: 0.6rem; font-weight: 600; font-size: 0.95rem; color: #374151; }
.form-input { width: 100%; padding: 0.8rem 1rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 1rem; transition: border-color 0.2s, box-shadow 0.2s; }
.form-input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1); }
.form-hint { font-size: 0.85rem; color: #6b7280; margin-top: 0.5rem; line-height: 1.4; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.8rem; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 1rem; transition: background 0.2s; }
.btn:hover { background: var(--primary-light); }
.btn-outline { background: transparent; border: 1px solid #d1d5db; color: #4b5563; }

/* Skeleton */
.skeleton { animation: pulse 2s infinite; background: #f0f0f0; }
@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.7; } 100% { opacity: 1; } }

@media (max-width: 768px) { 
  .content { padding: 1rem; } 
  .reader { padding: 1.5rem; }
  .grid { grid-template-columns: 1fr; }
}
@media (min-width: 1200px) { 
  .grid { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
}
`;

const LAZY_LOAD_SCRIPT = `
<script>
function initLazyLoad() {
  // 浏览器原生懒加载
  const images = document.querySelectorAll('img.lazy[data-src]');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
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
          observer.unobserve(img);
        }
      });
    }, { rootMargin: "300px 0px" });
    images.forEach(img => observer.observe(img));
  } else {
    // 降级
    images.forEach(img => {
      img.src = img.getAttribute('data-src') || '';
      img.classList.add('loaded');
      img.classList.remove('lazy');
    });
  }
}
document.addEventListener('DOMContentLoaded', initLazyLoad);
</script>
`;

function render(body: string, activeId: string, title: string): string {
  const nav = CATEGORIES.map(c => 
    `<a href="/category/${c.id}" class="${activeId===c.id?'active':''}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`
  ).join('');
  
  return `<!DOCTYPE html><html lang="zh-CN"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="Linux DO 阅读器 - 优雅的 RSS 阅读体验">
    <meta name="theme-color" content="#7c3aed">
    <title>${escapeHtml(title)} - Linux DO</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>${CSS}</style>
  </head><body>
    <div class="overlay" onclick="toggle()"></div>
    <nav class="sidebar" id="sb">
      <div class="brand"><i class="fab fa-linux"></i> Linux DO Reader v2</div>
      <div class="nav">
        <a href="/" class="${activeId==='home'?'active':''}"><i class="fas fa-home"></i> 首页广场</a>
        ${nav}
        <div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div>
        <a href="/browser" class="${activeId==='browser'?'active':''}"><i class="fas fa-compass"></i> Jina 浏览器</a>
        <a href="/settings" class="${activeId==='settings'?'active':''}"><i class="fas fa-cog"></i> 系统设置</a>
      </div>
    </nav>
    <div class="main">
      <div class="header">
        <button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button>
        <h3>${escapeHtml(title)}</h3>
        <div style="width:36px"></div>
      </div>
      <div class="content">${body}</div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
    <script>
      function toggle(){document.getElementById('sb').classList.toggle('open');document.querySelector('.overlay').classList.toggle('show')}
      window.toggle = toggle;
    </script>
    ${LAZY_LOAD_SCRIPT}
  </body></html>`;
}

function renderReaderScript(urlJS: string, backLink: string, backText: string): string {
  return `
    <div class="reader">
      <div style="margin-bottom:1.5rem"><a href="${backLink}" style="color:var(--primary);text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:5px"><i class="fas fa-arrow-left"></i> ${backText}</a></div>
      <div id="load" style="text-align:center;padding:5rem"><i class="fas fa-circle-notch fa-spin fa-3x" style="color:#e5e7eb"></i><p style="margin-top:1rem;color:#9ca3af">正在渲染内容...</p></div>
      <div id="err" style="display:none;color:#b91c1c;padding:1.5rem;background:#fef2f2;border-radius:12px;border:1px solid #fecaca"></div>
      <div id="view" style="display:none">
        <h1 id="tt" style="margin-bottom:0.8rem;font-size:1.8rem;line-height:1.3;color:#111827"></h1>
        <div id="meta" style="color:#6b7280;margin-bottom:2rem;border-bottom:1px solid #e5e7eb;padding-bottom:1.5rem;display:flex;gap:15px;font-size:0.9rem;flex-wrap:wrap"></div>
        <div id="md" class="markdown-body" style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif"></div>
      </div>
    </div>
    <script>
      (async () => {
        const headers = {};
        const b = localStorage.getItem('jina_base'), k = localStorage.getItem('jina_key');
        const sb = localStorage.getItem('scrape_base'), sk = localStorage.getItem('scrape_token');
        if(b) headers['x-jina-base'] = b; if(k) headers['x-jina-key'] = k;
        if(sb) headers['x-scrape-base'] = sb; if(sk) headers['x-scrape-token'] = sk;
        
        try {
          const r = await fetch('/api/jina?url=' + encodeURIComponent(${urlJS}), {headers});
          const d = await r.json();
          if(d.error) throw new Error(d.error);
          document.getElementById('load').style.display='none';
          document.getElementById('view').style.display='block';
          document.getElementById('tt').innerText = d.title;
          document.getElementById('meta').innerHTML = 
            '<span><i class="far fa-clock"></i> ' + (d.date||'未知时间') + '</span>' + 
            ' <a href="'+d.url+'" target="_blank" style="color:inherit;text-decoration:none"><i class="fas fa-external-link-alt"></i> 查看原文</a>';
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

// ==================== 工具函数 ====================

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

function sanitizeURL(url: string): boolean {
  try {
    const obj = new URL(url);
    return obj.protocol === "http:" || obj.protocol === "https:";
  } catch {
    return false;
  }
}

// ==================== 数据获取 ====================

async function fetchRSS(category: string, config: Config): Promise<RSSItem[]> {
  const cacheKey = `rss:${category}`;
  const cached = await CacheManager.get<RSSItem[]>(cacheKey, config.RSS_CACHE_TTL);
  if (cached) return cached;

  const categoryConfig = CATEGORIES.find(c => c.id === category) || CATEGORIES[0];
  const rssUrl = `${config.RSS_BASE_URL}/${categoryConfig.file}`;
  
  console.log(`[RSS] Fetching: ${rssUrl}`);
  const xml = await proxyRequest(rssUrl);
  const items = parseRSS(xml, config.SCRAPE_TOKEN, config.SCRAPE_BASE_URL);
  
  await CacheManager.set(cacheKey, items);
  return items;
}

async function fetchJinaContent(targetUrl: string, config: Config): Promise<JinaResult> {
  const cacheKey = `jina:${targetUrl}`;
  const cached = await CacheManager.get<JinaResult>(cacheKey, config.JINA_CACHE_TTL);
  if (cached) return cached;

  const headers: Record<string, string> = {};
  if (config.JINA_API_KEY) headers["Authorization"] = `Bearer ${config.JINA_API_KEY}`;
  
  const apiUrl = targetUrl.startsWith("http") 
    ? (targetUrl.includes("jina.ai") ? targetUrl : `${config.JINA_BASE_URL}/${targetUrl}`)
    : `${config.JINA_BASE_URL}/https://linux.do${targetUrl}`;
  
  console.log(`[Jina] Fetching: ${apiUrl}`);
  const text = await proxyRequest(apiUrl, headers);
  
  // 解析 Jina AI 响应
  let md = text;
  const idx = text.indexOf("Markdown Content:");
  if (idx > -1) md = text.substring(idx + 17).trim();
  
  // 处理图片
  md = processMarkdownImagesLazy(md, config.SCRAPE_TOKEN, config.SCRAPE_BASE_URL);
  
  // 提取元数据
  const t = text.match(/Title: (.+)/);
  const d = text.match(/Published Time: (.+)/);
  const u = text.match(/URL Source: (.+)/);
  
  const result: JinaResult = {
    title: t?.[1] || "无标题",
    date: d?.[1] || "",
    url: u?.[1] || targetUrl,
    markdown: md,
  };
  
  await CacheManager.set(cacheKey, result);
  return result;
}

// ==================== 路由处理器 ====================

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

// API 路由
async function handleAPIJina(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  
  if (!target || !sanitizeURL(target)) {
    return new Response(JSON.stringify({ error: "Invalid URL" }), { 
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  
  try {
    const config = getConfig(req);
    const result = await fetchJinaContent(target, config);
    return new Response(JSON.stringify(result), {
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e: any) {
    console.error("[API Jina Error]", e);
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// 设置页
function handleSettings(): Response {
  const config = getConfig();
  const html = `
    <div class="reader">
      <h2 style="margin-bottom:2rem; font-size:1.5rem;"><i class="fas fa-sliders-h" style="color:var(--primary)"></i> 个性化设置</h2>
      
      <h3 style="border-bottom:1px solid #f3f4f6; padding-bottom:0.8rem; margin-bottom:1.5rem; font-size:1.1rem;">Jina AI (内容引擎)</h3>
      <div class="form-group">
          <label class="form-label">Jina Base URL</label>
          <input id="jina_base" class="form-input" placeholder="${config.JINA_BASE_URL}">
          <p class="form-hint">用于将网页转换为 Markdown 的服务地址。可以是官方 API 或自建代理。</p>
      </div>
      <div class="form-group">
          <label class="form-label">API Key (可选)</label>
          <input id="jina_key" class="form-input" placeholder="例如: jina_xxx...">
          <p class="form-hint">如果你有 Jina Pro 账号，填入 Key 可获得更高额度。留空使用免费额度。</p>
      </div>

      <h3 style="border-bottom:1px solid #f3f4f6; padding-bottom:0.8rem; margin:2.5rem 0 1.5rem 0; font-size:1.1rem;">Scrape.do (图片加速)</h3>
      <div class="form-group">
          <label class="form-label">Scrape Base URL</label>
          <input id="scrape_base" class="form-input" placeholder="${config.SCRAPE_BASE_URL}">
          <p class="form-hint">Scrape.do 的 API 接入点。</p>
      </div>
      <div class="form-group">
          <label class="form-label">Scrape Token</label>
          <input id="scrape_token" class="form-input" placeholder="例如: 4a2b...">
          <p class="form-hint"><strong>强烈推荐配置！</strong> 用于绕过 Cloudflare 盾，修复 RSS 列表和文章详情中的图片加载失败问题。</p>
      </div>

      <div style="margin-top:3rem; display:flex; gap:15px;">
          <button class="btn" onclick="save()"><i class="fas fa-save"></i> 保存配置</button>
          <button class="btn btn-outline" onclick="reset()">恢复默认</button>
      </div>
    </div>
    <script>
      const STORAGE_KEYS = {
        jina_base: 'jina_base',
        jina_key: 'jina_key',
        scrape_base: 'scrape_base',
        scrape_token: 'scrape_token',
      };
      
      // 加载存储的值
      Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
        document.getElementById(key).value = localStorage.getItem(storageKey) || '';
      });
      
      function save() {
        Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
          const el = document.getElementById(key);
          if (el) localStorage.setItem(storageKey, el.value.trim());
        });
        alert('设置已保存！刷新页面即可生效。');
      }
      
      function reset() {
        if (confirm('确定要清除所有设置吗？')) {
          Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
          location.reload();
        }
      }
    </script>
  `;
  
  return new Response(render(html, "settings", "系统设置"), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

// 分类列表页
async function handleCategory(req: Request, categoryId: string): Promise<Response> {
  const config = getConfig(req);
  const category = CATEGORIES.find(c => c.id === categoryId) || CATEGORIES[0];
  
  try {
    const items = await fetchRSS(category.id, config);
    
    const html = `
      <div class="grid">
        ${items.map(item => `
          <div class="card">
            <div class="card-title"><a href="/topic/${item.topicId}">${escapeHtml(item.title)}</a></div>
            <div class="card-body">${item.descriptionHTML}</div>
            <div class="card-meta">
              <div class="meta-item"><i class="far fa-user-circle"></i><span style="font-weight:500; color:#4b5563">${escapeHtml(item.creator)}</span></div>
              <div class="meta-item"><i class="far fa-clock"></i><span>${new Date(item.pubDate).toLocaleDateString('zh-CN', {month:'short', day:'numeric'})}</span></div>
            </div>
            <div class="action-bar">
              <a href="/topic/${item.topicId}" class="btn-action primary"><i class="fas fa-book-open"></i> Jina 浏览</a>
              <a href="${item.link}" target="_blank" class="btn-action"><i class="fas fa-external-link-alt"></i> 阅读原文</a>
            </div>
          </div>
        `).join('')}
      </div>
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          const token = localStorage.getItem('scrape_token');
          const base = localStorage.getItem('scrape_base') || '${config.SCRAPE_BASE_URL}';
          
          if(token) {
            document.querySelectorAll('img.lazy').forEach(img => {
              const o = img.getAttribute('data-src');
              if(o && !o.includes(base)) {
                const finalBase = base.endsWith('/') ? base : base + '/';
                img.setAttribute('data-src', \`\${finalBase}?token=\${token}&format=webp&url=\${encodeURIComponent(o)}\`);
              }
            });
          }
          initLazyLoad();
        });
      </script>
    `;
    
    return new Response(render(html, category.id, category.name), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": `public, max-age=${Math.floor(config.RSS_CACHE_TTL / 1000)}`,
      },
    });
  } catch (e: any) {
    console.error(`[Category Error] ${categoryId}:`, e);
    return new Response(render(`<div style="color:#dc2626">加载失败: ${e.message}</div>`, category.id, "错误"), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}

// 主处理器
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // API 路由
  if (path === "/api/jina") {
    return handleAPIJina(req);
  }

  // 页面路由
  switch (path) {
    case "/":
      return handleCategory(req, "latest");
    
    case "/settings":
      return handleSettings();
    
    case "/browser":
      return new Response(render(`
        <div class="reader" style="text-align:center;padding-top:4rem">
          <h1>Jina Browser</h1>
          <input id="u" class="form-input" style="max-width:600px;margin-top:1rem" placeholder="输入网址...">
          <button onclick="go()" class="btn" style="margin-top:1rem">开始阅读</button>
        </div>
        <script>
          function go() {
            const u = document.getElementById('u').value.trim();
            if(u && u.startsWith('http')) location.href = '/read?url=' + encodeURIComponent(u);
            else alert('请输入有效的URL');
          }
        </script>
      `, "browser", "Jina 浏览器"), { 
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    
    case "/read":
      const readUrl = url.searchParams.get("url");
      if (!readUrl || !sanitizeURL(readUrl)) {
        return new Response("Invalid URL", { status: 400 });
      }
      return new Response(render(renderReaderScript(`'${readUrl}'`, '/browser', '返回'), "browser", "阅读"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    
    case "/clear-cache":
      // 内部管理接口
      if (Deno.env.get("ADMIN_TOKEN") === url.searchParams.get("token")) {
        CacheManager.clearMemory();
        const cache = await caches.open(CacheManager["cacheName"]);
        await cache.keys().then(keys => Promise.all(keys.map(k => cache.delete(k))));
        return new Response("Cache cleared", { headers: { "Content-Type": "text/plain" }});
      }
      return new Response("Unauthorized", { status: 401 });
  }

  // 话题详情页
  if (path.startsWith("/topic/")) {
    const topicId = path.split("/")[2];
    if (!/^\d+$/.test(topicId)) {
      return new Response("Invalid Topic ID", { status: 400 });
    }
    return new Response(render(renderReaderScript(`'/t/topic/${topicId}'`, 'javascript:history.back()', '返回列表'), "topic", "话题详情"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // 分类页
  if (path.startsWith("/category/")) {
    const categoryId = path.split("/")[2];
    const isValidCategory = CATEGORIES.some(c => c.id === categoryId);
    if (!isValidCategory) {
      return new Response("Category not found", { status: 404 });
    }
    return handleCategory(req, categoryId);
  }

  // 404
  return new Response(render(`
    <div class="reader" style="text-align:center;padding:4rem 2rem">
      <h1 style="font-size:4rem; margin-bottom:1rem">404</h1>
      <p>页面未找到 <i class="fas fa-ghost"></i></p>
      <a href="/" style="display:inline-block;margin-top:2rem" class="btn">返回首页</a>
    </div>
  `, "404", "未找到"), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" }});
}

// ==================== 启动 ====================

console.log(`🚀 Linux DO Reader 启动中...`);
console.log(`📡 RSS 缓存时间: ${Math.floor(getConfig().RSS_CACHE_TTL / 60000)} 分钟`);
console.log(`📝 Jina 缓存时间: ${Math.floor(getConfig().JINA_CACHE_TTL / 86400000)} 天`);
console.log(`🔗 http://localhost:8000`);

serve(handler, { port: 8000 });
