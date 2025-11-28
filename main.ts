import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置 ---
const DEFAULT_CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
  IMAGE_PROXY_URL: Deno.env.get("IMAGE_PROXY_URL") || "",
  IMAGE_URL_ENCODE: Deno.env.get("IMAGE_URL_ENCODE") === "true",
  RSS_CACHE_TTL: parseInt(Deno.env.get("RSS_CACHE_TTL") || "600"),
  JINA_CACHE_TTL: parseInt(Deno.env.get("JINA_CACHE_TTL") || "604800"),
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
  ttl: number;
  cacheKey?: string;
  refresh?: boolean;
}

function buildCacheUrl(key: string): string {
  if (key.startsWith("http://") || key.startsWith("https://")) {
    return key;
  }
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

  if (!options.refresh) {
    const cached = await cache.match(req);
    if (cached) {
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

function processHtmlImagesLazy(html: string): string {
  return html.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
    if (src.startsWith('data:')) return match;
    return match
      .replace(src, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
      .replace("<img", `<img data-src="${src}" data-original="${src}" class="lazy"`);
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

function formatToBeijingTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

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

function parseRSS(xml: string): RSSItem[] {
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
      desc = processHtmlImagesLazy(desc);

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

  items.sort((a, b) => b.pubDateTimestamp - a.pubDateTimestamp);

  return items;
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

/* Grid & Card - 使用Masonry布局 */
.grid {
  position: relative; /* Masonry需要 */
  margin: 0 auto; /* 居中 */
}

.card {
  width: 320px; /* 固定宽度 */
  margin-bottom: 1.5rem;
  float: left; /* 横向排列 */
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
}

.card:hover { transform: translateY(-4px); box-shadow: 0 12px 20px -5px rgba(0,0,0,0.1); border-color: rgba(124, 58, 237, 0.1); }

.card-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.8rem; line-height: 1.4; color: #111827; }
.card-title a { color: inherit; text-decoration: none; display: block; }
.card-title a:hover { color: var(--primary); }

.card-body { font-size: 0.95rem; color: #4b5563; line-height: 1.6; margin-bottom: 1.2rem; overflow-wrap: anywhere; word-break: break-word; user-select: text; -webkit-user-select: text; cursor: text; }
.card-body * { max-width: 100% !important; box-sizing: border-box; }
.card-body img { display: block; height: auto; border-radius: 8px; margin: 12px 0; background: #f3f4f6; transition: opacity 0.3s ease-in-out, filter 0.3s ease-in-out; pointer-events: auto; cursor: pointer; min-height: 50px; }
.card-body pre, .card-body table { display: block; width: 100%; overflow-x: auto; background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9; margin: 10px 0; padding: 10px; }
.card-body small, .card-body a[href*="topic"] { display: none !important; }
.card-body br { display: block; content: ""; margin-bottom: 6px; }
.card-body a { pointer-events: auto; color: var(--text); text-decoration: none; cursor: text; }

img.lazy { opacity: 0.5; filter: blur(5px); }
img.lazy.loading { opacity: 0.7; }
img.lazy.loaded, img.loaded { opacity: 1; filter: blur(0); }

.card-meta { margin-top: auto; padding-top: 1rem; border-top: 1px solid #f3f4f6; font-size: 0.85rem; color: var(--text-light); display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.meta-item { display: flex; align-items: center; gap: 6px; }

.action-bar { display: flex; gap: 12px; position: relative; z-index: 10; }
.btn-action { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0.6rem; border-radius: 10px; text-decoration: none; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: all 0.2s; border: 1px solid #e5e7eb; background: white; color: var(--text); }
.btn-action.primary { background: #f5f3ff; color: var(--primary); border-color: #ddd6fe; }
.btn-action:hover { transform: translateY(-1px); filter: brightness(0.97); }

.reader { background: #fff; padding: 2.5rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
.form-group { margin-bottom: 2rem; }
.form-label { display: block; margin-bottom: 0.6rem; font-weight: 600; font-size: 0.95rem; color: #374151; }
.form-input { width: 100%; padding: 0.8rem 1rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 1rem; transition: border-color 0.2s; }
.form-input:focus { border-color: var(--primary); outline: none; }
.form-hint { font-size: 0.85rem; color: #6b7280; margin-top: 0.5rem; line-height: 1.4; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.8rem; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 1rem; transition: background 0.2s; }
.btn:hover { background: var(--primary-light); }
.btn-outline { background: transparent; border: 1px solid #d1d5db; color: #4b5563; }

.toggle-wrapper { display: flex; align-items: center; gap: 12px; }
.toggle { position: relative; width: 50px; height: 26px; background: #e5e7eb; border-radius: 13px; cursor: pointer; transition: background 0.3s; }
.toggle.active { background: var(--primary); }
.toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; background: white; border-radius: 50%; transition: transform 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
.toggle.active::after { transform: translateX(24px); }
.toggle-label { font-size: 0.95rem; color: #4b5563; }

.cache-info { font-size: 0.75rem; color: #9ca3af; text-align: center; margin-top: 1rem; padding: 0.5rem; background: #f9fafb; border-radius: 6px; }

.markdown-body img { transition: opacity 0.3s ease-in-out, filter 0.3s ease-in-out; min-height: 50px; background: #f3f4f6; border-radius: 8px; cursor: pointer; }
.markdown-body img.lazy { opacity: 0.5; filter: blur(5px); }
.markdown-body img.loaded { opacity: 1; filter: blur(0); }

@media (max-width: 768px) { 
  .content { padding: 1rem; } 
  .reader { padding: 1.5rem; }
  .card { width: 100%; } /* 移动端全宽 */
}
`;

const IMAGE_PROXY_SCRIPT = `
<script>
(function() {
    function getProxyConfig() {
        return {
            template: localStorage.getItem('img_proxy_url') || '',
            urlEncode: localStorage.getItem('img_url_encode') === 'true'
        };
    }

    function isValidProxyTemplate(template) {
        if (!template || typeof template !== 'string') return false;
        template = template.trim();
        if (!template) return false;
        if (!template.includes('\${image}')) return false;
        if (!template.startsWith('http://') && !template.startsWith('https://')) return false;
        return true;
    }

    function isImageUrl(url) {
        if (!url || url.startsWith('data:')) return false;
        if (url.includes('linux.do/uploads')) return true;
        if (/\\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)/i.test(url)) return true;
        const imageHosts = [
            'imgur.com', 'i.imgur.com',
            'imgtu.com', 'i.imgtu.com',
            'sm.ms', 'i.sm.ms',
            'cdn.jsdelivr.net',
            'picsum.photos',
            'images.unsplash.com',
            'i.loli.net',
            'cdn.nlark.com',
            'img.shields.io'
        ];
        try {
            const urlObj = new URL(url);
            if (imageHosts.some(host => urlObj.hostname.includes(host))) return true;
        } catch {}
        return false;
    }

    function willUseProxy(url, config) {
        if (!isValidProxyTemplate(config.template)) return false;
        if (!isImageUrl(url)) return false;
        return true;
    }

    function applyProxy(url, config) {
        if (!willUseProxy(url, config)) {
            return url;
        }
        const imageUrl = config.urlEncode ? encodeURIComponent(url) : url;
        return config.template.replace('\${image}', imageUrl);
    }

    function bindImageClick(img, finalSrc) {
        img.onclick = null;
        img.style.cursor = 'pointer';
        img.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.open(finalSrc, '_blank');
        };
        img.setAttribute('data-final-src', finalSrc);
    }

    function initLazyLoad() {
        const config = getProxyConfig();
        
        const observer = new IntersectionObserver((entries, self) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    let originalSrc = img.getAttribute('data-src') || img.getAttribute('data-original');
                    
                    if (originalSrc && !originalSrc.startsWith('data:')) {
                        const finalSrc = applyProxy(originalSrc, config);
                        
                        if (config.template && willUseProxy(originalSrc, config)) {
                            console.log('[Image Proxy]', originalSrc, '->', finalSrc);
                        }
                        
                        img.classList.add('loading');
                        
                        const tempImg = new Image();
                        tempImg.onload = function() {
                            img.src = finalSrc;
                            img.classList.remove('lazy', 'loading');
                            img.classList.add('loaded');
                            bindImageClick(img, finalSrc);
                            // 触发Masonry重新布局
                            if (window.masonryInstance) {
                                window.masonryInstance.layout();
                            }
                        };
                        tempImg.onerror = function() {
                            console.warn('[Image Proxy] Failed:', finalSrc, 'Fallback to:', originalSrc);
                            img.src = originalSrc;
                            img.classList.remove('lazy', 'loading');
                            img.classList.add('loaded');
                            bindImageClick(img, originalSrc);
                            if (window.masonryInstance) {
                                window.masonryInstance.layout();
                            }
                        };
                        tempImg.src = finalSrc;
                        
                        img.removeAttribute('data-src');
                    }
                    self.unobserve(img);
                }
            });
        }, { 
            rootMargin: "200px 0px",
            threshold: 0.01 
        });

        document.querySelectorAll('img.lazy[data-src], img.lazy[data-original]').forEach(img => {
            observer.observe(img);
        });
    }

    window.initLazyLoad = initLazyLoad;
    window.getProxyConfig = getProxyConfig;
    window.applyProxy = applyProxy;
    window.isImageUrl = isImageUrl;
    window.isValidProxyTemplate = isValidProxyTemplate;
    window.willUseProxy = willUseProxy;
    window.bindImageClick = bindImageClick;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLazyLoad);
    } else {
        initLazyLoad();
    }
})();
</script>
`;

// --- Masonry初始化脚本 ---
const MASONRY_SCRIPT = `
<script src="https://unpkg.com/masonry-layout@4/dist/masonry.pkgd.min.js"></script>
<script>
  function initMasonry() {
    const grid = document.querySelector('.grid');
    if (!grid) return;
    
    // 销毁已存在的实例
    if (window.masonryInstance) {
      window.masonryInstance.destroy();
    }
    
    // 创建新实例
    window.masonryInstance = new Masonry(grid, {
      itemSelector: '.card',
      columnWidth: 320,
      gutter: 24,
      fitWidth: true,
      horizontalOrder: true, // 关键：强制从左到右排序
      transitionDuration: '0.2s'
    });
    
    // 图片加载完成后重新布局
    const handleImageLoad = () => {
      if (window.masonryInstance) {
        window.masonryInstance.layout();
      }
    };
    
    grid.addEventListener('load', handleImageLoad, true);
    
    // 延迟加载完成后也重新布局
    const originalInitLazyLoad = window.initLazyLoad;
    window.initLazyLoad = function() {
      originalInitLazyLoad();
      setTimeout(handleImageLoad, 300);
    };
    
    console.log('[Masonry] 初始化完成');
  }
  
  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMasonry);
  } else {
    initMasonry();
  }
  
  // 窗口调整大小时重新布局
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(initMasonry, 100);
  });
</script>
`;

function render(body: string, activeId: string, title: string) {
  const nav = CATEGORIES.map(
    (c) =>
      `<a href="/category/${c.id}" class="${activeId === c.id ? "active" : ""}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`
  ).join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Linux DO</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>${CSS}</style></head><body><div class="overlay" onclick="toggle()"></div><nav class="sidebar" id="sb"><div class="brand"><i class="fab fa-linux"></i> Linux DO Reader</div><div class="nav"><a href="/" class="${activeId === "home" ? "active" : ""}"><i class="fas fa-home"></i> 首页广场</a>${nav}<div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div><a href="/browser" class="${activeId === "browser" ? "active" : ""}"><i class="fas fa-compass"></i> Jina 浏览器</a><a href="/settings" class="${activeId === "settings" ? "active" : ""}"><i class="fas fa-cog"></i> 系统设置</a></div></nav><div class="main"><div class="header"><button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button><h3>${title}</h3><div style="width:36px"></div></div><div class="content">${body}</div></div><script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script><script>function toggle(){document.getElementById('sb').classList.toggle('open');document.querySelector('.overlay').classList.toggle('show')}</script>${IMAGE_PROXY_SCRIPT}${MASONRY_SCRIPT}</body></html>`;
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
          if(b) h['x-base'] = b; 
          if(k) h['x-key'] = k;
          
          try {
            const r = await fetch('/api/jina?url=' + encodeURIComponent(${urlJS}), {headers:h});
            const d = await r.json();
            if(d.error) throw new Error(d.error);
            document.getElementById('load').style.display='none';
            document.getElementById('view').style.display='block';
            document.getElementById('tt').innerText = d.title;
            document.getElementById('meta').innerHTML = '<span><i class="far fa-clock"></i> ' + (d.date||'未知时间') + '</span>' + ' <a href="'+d.url+'" target="_blank" style="color:inherit;text-decoration:none"><i class="fas fa-external-link-alt"></i> 查看原文</a>' + (d.cached ? ' <span style="color:#10b981"><i class="fas fa-bolt"></i> 已缓存</span>' : '');
            
            let html = marked.parse(d.markdown);
            
            html = html.replace(/<img\\s+([^>]*)src=["']([^"']+)["']([^>]*)>/gi, function(match, before, src, after) {
                if (src.startsWith('data:')) return match;
                return '<img ' + before + 'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="' + src + '" data-original="' + src + '" class="lazy"' + after + '>';
            });
            
            document.getElementById('md').innerHTML = html;
            
            if (typeof initLazyLoad === 'function') {
                initLazyLoad();
            }
          } catch(e) {
            document.getElementById('load').style.display='none';
            document.getElementById('err').style.display='block';
            document.getElementById('err').innerHTML = '<strong>加载失败</strong><br>' + e.message;
          }
        })();
      </script>
    `;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/jina") {
    const target = url.searchParams.get("url");
    if (!target) return new Response("Miss URL", { status: 400 });

    const h: Record<string, string> = {};
    const key = req.headers.get("x-key") || DEFAULT_CONFIG.JINA_API_KEY;
    const base = req.headers.get("x-base") || DEFAULT_CONFIG.JINA_BASE_URL;
    if (key) h["Authorization"] = `Bearer ${key}`;

    try {
      const apiUrl = target.startsWith("http")
        ? target.includes("jina.ai")
          ? target
          : `${base}/${target}`
        : `${base}/https://linux.do${target}`;

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
            <p class="form-hint">用于将网页转换为 Markdown 的服务地址。</p>
        </div>
        <div class="form-group">
            <label class="form-label">API Key (可选)</label>
            <input id="key" class="form-input" placeholder="例如: jina_xxx...">
            <p class="form-hint">Jina Pro 账号的 API Key。</p>
        </div>

        <h3 style="border-bottom:1px solid #f3f4f6; padding-bottom:0.8rem; margin:2.5rem 0 1.5rem 0; font-size:1.1rem;">图片代理 (Image Proxy)</h3>
        <div class="form-group">
            <label class="form-label">图片代理URL模板</label>
            <input id="img_proxy" class="form-input" placeholder="例如: https://proxy.example.com/?url=\${image}">
            <p class="form-hint">
              用于过CF盾代理图片，使用 <code>\${image}</code> 作为图片URL的占位符。<br>
              <strong>示例:</strong> <code>https://api.scrape.do/?token=TOKEN&url=\${image}</code><br>
              留空则不启用代理。必须以 http:// 或 https:// 开头，且包含 \${image} 占位符。
            </p>
        </div>
        <div class="form-group">
            <label class="form-label">URL 编码</label>
            <div class="toggle-wrapper">
                <div id="url_encode_toggle" class="toggle" onclick="toggleEncode()"></div>
                <span class="toggle-label" id="encode_label">关闭</span>
            </div>
            <p class="form-hint">开启后图片URL会进行 encodeURIComponent 编码。</p>
        </div>

        <h3 style="border-bottom:1px solid #f3f4f6; padding-bottom:0.8rem; margin:2.5rem 0 1.5rem 0; font-size:1.1rem;">缓存配置</h3>
        <div class="form-group">
            <p class="form-hint">
              • RSS 缓存：${Math.round(DEFAULT_CONFIG.RSS_CACHE_TTL / 60)} 分钟<br>
              • Jina 缓存：${Math.round(DEFAULT_CONFIG.JINA_CACHE_TTL / 86400)} 天
            </p>
        </div>

        <div style="margin-top:2rem; display:flex; gap:15px;">
            <button class="btn" onclick="save()"><i class="fas fa-save"></i> 保存</button>
            <button class="btn btn-outline" onclick="reset()">重置</button>
        </div>
        
        <div style="margin-top:2rem; padding-top:2rem; border-top:1px solid #e7eb;">
            <h4 style="margin-bottom:1rem;">测试代理</h4>
            <div style="display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-start;">
                <img id="test-img" class="lazy" 
                     src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                     data-src="https://linux.do/uploads/default/original/4X/d/1/4/d146c68151340881c884d95e0da4acdf369258c6.png"
                     data-original="https://linux.do/uploads/default/original/4X/d/1/4/d146c68151340881c884d95e0da4acdf369258c6.png"
                     style="max-width:150px; height:auto; border-radius:8px; border:1px solid #e7eb;">
                <div style="flex:1; min-width:200px; font-size:0.8rem;">
                    <p style="color:#6b7280; margin-bottom:0.3rem;">原始URL:</p>
                    <code style="word-break:break-all; display:block; padding:0.3rem; background:#f3f4f6; border-radius:4px; font-size:0.7rem;">https://linux.do/uploads/default/original/4X/d/1/4/d146c68151340881c884d95e0da4acdf369258c6.png</code>
                    <p style="color:#6b7280; margin:0.5rem 0 0.3rem;">代理后URL:</p>
                    <code id="proxied-url" style="word-break:break-all; color:var(--primary); display:block; padding:0.3rem; background:#f5f3ff; border-radius:4px; font-size:0.7rem;"></code>
                    <p style="color:#6b7280; margin:0.5rem 0 0.3rem;">代理模板有效:</p>
                    <code id="template-valid" style="display:block; padding:0.3rem; background:#f3f4f6; border-radius:4px; font-size:0.7rem;"></code>
                    <p style="color:#6b7280; margin:0.5rem 0 0.3rem;">是否使用代理:</p>
                    <code id="will-use-proxy" style="display:block; padding:0.3rem; background:#f3f4f6; border-radius:4px; font-size:0.7rem;"></code>
                </div>
            </div>
            <button class="btn btn-outline" style="margin-top:1rem;" onclick="testProxy()"><i class="fas fa-sync"></i> 测试</button>
        </div>
      </div>
      <script>
        const $=id=>document.getElementById(id);
        
        $('base').value = localStorage.getItem('r_base') || '';
        $('key').value = localStorage.getItem('r_key') || '';
        $('img_proxy').value = localStorage.getItem('img_proxy_url') || '';
        
        const urlEncodeEnabled = localStorage.getItem('img_url_encode') === 'true';
        updateEncodeToggle(urlEncodeEnabled);
        
        function updateEncodeToggle(enabled) {
            const toggle = $('url_encode_toggle');
            const label = $('encode_label');
            if(enabled) {
                toggle.classList.add('active');
                label.textContent = '开启';
            } else {
                toggle.classList.remove('active');
                label.textContent = '关闭';
            }
        }
        
        function toggleEncode() {
            const toggle = $('url_encode_toggle');
            updateEncodeToggle(!toggle.classList.contains('active'));
        }

        function save(){
            localStorage.setItem('r_base', $('base').value.trim());
            localStorage.setItem('r_key', $('key').value.trim());
            localStorage.setItem('img_proxy_url', $('img_proxy').value.trim());
            localStorage.setItem('img_url_encode', $('url_encode_toggle').classList.contains('active') ? 'true' : 'false');
            alert('已保存！');
            testProxy();
        }
        
        function reset(){ localStorage.clear(); location.reload(); }
        
        function testProxy() {
            const config = getProxyConfig();
            const testUrl = 'https://linux.do/uploads/default/original/4X/d/1/4/d146c68151340881c884d95e0da4acdf369258c6.png';
            
            // 检查代理模板是否有效
            const templateValid = isValidProxyTemplate(config.template);
            $('template-valid').textContent = templateValid ? 'true (有效)' : 'false (无效或未设置)';
            $('template-valid').style.color = templateValid ? '#10b981' : '#ef4444';
            
            // 检查是否会使用代理
            const useProxy = willUseProxy(testUrl, config);
            $('will-use-proxy').textContent = useProxy ? 'true (会代理)' : 'false (不代理)';
            $('will-use-proxy').style.color = useProxy ? '#10b981' : '#ef4444';
            
            // 显示代理后的URL
            const proxiedUrl = applyProxy(testUrl, config);
            $('proxied-url').textContent = useProxy ? proxiedUrl : '(不使用代理，直接加载原图)';
            
            // 重新加载测试图片
            const testImg = $('test-img');
            testImg.classList.remove('loaded');
            testImg.classList.add('lazy');
            testImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            testImg.setAttribute('data-src', testUrl);
            testImg.setAttribute('data-original', testUrl);
            testImg.removeAttribute('data-final-src');
            testImg.onclick = null;
            
            setTimeout(() => initLazyLoad(), 100);
        }
        
        setTimeout(testProxy, 300);
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

    const res = await fetchWithCache(rssUrl, { ttl: DEFAULT_CONFIG.RSS_CACHE_TTL });

    const xml = await res.text();
    const cached = res.headers.has("x-cached-time");
    const cachedTime = res.headers.get("x-cached-time");
    const cacheAge = cachedTime ? Math.round((Date.now() - parseInt(cachedTime)) / 1000) : 0;

    const items = parseRSS(xml);

    const html = `
      <div class="grid">
        ${items.map((item) => `
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
        `).join("")}
      </div>
      <div class="cache-info">
        ${cached
          ? `<i class="fas fa-bolt" style="color:#10b981"></i> 缓存 (${cacheAge}秒前，${Math.max(0, DEFAULT_CONFIG.RSS_CACHE_TTL - cacheAge)}秒后刷新)`
          : `<i class="fas fa-sync"></i> 已刷新`}
      </div>
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
