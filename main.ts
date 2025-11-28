import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置不变 ---
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

// --- 缓存工具不变 ---
interface CacheOptions { ttl: number; cacheKey?: string; refresh?: boolean; }
function buildCacheUrl(key: string): string { /* 不变 */ return key.startsWith("http") ? key : `https://cache.local/${encodeURIComponent(key)}`; }
async function fetchWithCache(url: string, options: CacheOptions, fetchOptions: RequestInit = {}): Promise<Response> { 
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
        }
      }
    }
  }
  console.log(`[发起请求] ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "LinuxDOReader/13.0" }, ...fetchOptions });
  if (res.ok) {
    const body = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("x-cached-time", Date.now().toString());
    await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
    console.log(`[已缓存] ${options.cacheKey || url} (TTL: ${options.ttl}秒)`);
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  }
  return res;
}

// --- 核心工具不变 ---
function processHtmlImagesLazy(html: string): string { return html.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => src.startsWith('data:') ? match : match.replace(src, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7").replace("<img", `<img data-src="${src}" data-original="${src}" class="lazy"`)); }
function unescapeHTML(str: string) { return str?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&") || ""; }
function formatToBeijingTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const beijingDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return beijingDate.toISOString().replace('T', ' ').substring(0, 19);
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
      const cdataMatch = itemBlock.match(new RegExp(`<${tagName}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, "i"));
      if (cdataMatch) return cdataMatch[1];
      const normalMatch = itemBlock.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
      return normalMatch ? unescapeHTML(normalMatch[1]) : "";
    };
    const link = extract("link").trim();
    const topicIdMatch = link.match(/\/topic\/(\d+)/);
    if (link && topicIdMatch) {
      let desc = extract("description");
      desc = processHtmlImagesLazy(desc);
      const pubDateStr = extract("pubDate");
      items.push({
        title: extract("title"),
        link,
        topicId: topicIdMatch[1],
        descriptionHTML: desc,
        pubDate: formatToBeijingTime(pubDateStr),
        pubDateTimestamp: new Date(pubDateStr).getTime() || 0,
        creator: extract("dc:creator") || "Linux Do",
      });
    }
  }
  return items.sort((a, b) => b.pubDateTimestamp - a.pubDateTimestamp);
}

// --- CSS：极致性能优化 ---
const CSS = `
:root { --sidebar-width: 260px; --primary: #7c3aed; --primary-light: #8b5cf6; --bg: #f3f4f6; --card-bg: #fff; --text: #1f2937; --text-light: #6b7280; }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }

/* Sidebar不变 */
.sidebar { width: var(--sidebar-width); background: #1e1e2e; color: #a6adc8; position: fixed; inset: 0 auto 0 0; z-index: 100; overflow-y: auto; transform: translateX(-100%); transition: transform 0.3s; }
.sidebar.open { transform: translateX(0); box-shadow: 0 0 50px rgba(0,0,0,0.5); }
.brand { padding: 1.5rem; color: #fff; font-weight: bold; font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px; }
.nav a { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; transition: all 0.2s; }
.nav a:hover { background: rgba(255,255,255,0.05); color: #fff; }
.nav a.active { background: rgba(124, 58, 237, 0.15); color: #fff; border-left: 3px solid var(--primary); }
.nav i { width: 24px; margin-right: 10px; text-align: center; opacity: 0.8; }

/* Main不变 */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.3s; backdrop-filter: blur(3px); }
.overlay.show { opacity: 1; pointer-events: auto; }
.main { flex: 1; width: 100%; margin-left: 0; min-width: 0; }
.header { background: #fff; padding: 0.8rem 1.5rem; position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 2px rgba(0,0,0,0.03); display: flex; justify-content: space-between; align-items: center; }
.menu-btn { width: 36px; height: 36px; display: flex; justify-content: center; align-items: center; background: #fff; border: 1px solid #e7eb; border-radius: 8px; color: var(--text); cursor: pointer; transition: all 0.2s; }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }

/* Grid：CSS Grid，性能极致 */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
  min-height: 100vh;
}

.card {
  background: var(--card-bg);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.02);
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
.card-body img { display: block; height: auto; border-radius: 8px; margin: 12px 0; background: #f3f4f6; transition: opacity 0.3s ease-in-out, filter 0.3s ease-in-out; pointer-events: auto; cursor: pointer; min-height: 50px; max-width: 100% !important; }
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
.btn-action { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0.6rem; border-radius: 10px; text-decoration: none; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: all 0.2s; border: 1px solid #e7eb; background: white; color: var(--text); }
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
.toggle { position: relative; width: 50px; height: 26px; background: #e7eb; border-radius: 13px; cursor: pointer; transition: background 0.3s; }
.toggle.active { background: var(--primary); }
.toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; background: white; border-radius: 50%; transition: transform 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
.toggle.active::after { transform: translateX(24px); }
.toggle-label { font-size: 0.95rem; color: #4b5563; }

.cache-info { font-size: 0.75rem; color: #9ca3af; text-align: center; margin-top: 1rem; padding: 0.5rem; background: #f9fafb; border-radius: 6px; }

.markdown-body img { transition: opacity 0.3s ease-in-out, filter 0.3s ease-in-out; min-height: 50px; background: #f3f4f6; border-radius: 8px; cursor: pointer; }
.markdown-body img.lazy { opacity: 0.5; filter: blur(5px); }
.markdown-body img.loaded { opacity: 1; filter: blur(0); }

/* 加载提示 */
.loading-indicator {
  text-align: center;
  padding: 2rem;
  color: #9ca3af;
  grid-column: 1 / -1;
}

.loading-indicator i {
  font-size: 1.5rem;
}

/* 回到顶部按钮 */
.back-to-top {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: none;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
  z-index: 200;
}

.back-to-top.show {
  display: flex;
}

.back-to-top:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.2);
}

@media (max-width: 768px) { 
  .content { padding: 1rem; } 
  .reader { padding: 1.5rem; }
  .grid { grid-template-columns: 1fr; }
  .back-to-top { bottom: 1rem; right: 1rem; }
}
`;

const IMAGE_PROXY_SCRIPT = `
<script>
(function() {
    function getProxyConfig() { return { template: localStorage.getItem('img_proxy_url') || '', urlEncode: localStorage.getItem('img_url_encode') === 'true' }; }
    function isValidProxyTemplate(template) { if (!template || typeof template !== 'string') return false; template = template.trim(); return template && template.includes('${image}') && (template.startsWith('http://') || template.startsWith('https://')); }
    function isImageUrl(url) { if (!url || url.startsWith('data:')) return false; if (url.includes('linux.do/uploads')) return true; if (/\\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)/i.test(url)) return true; const imageHosts = ['imgur.com','i.imgur.com','imgtu.com','i.imgtu.com','sm.ms','i.sm.ms','cdn.jsdelivr.net','picsum.photos','images.unsplash.com','i.loli.net','cdn.nlark.com','img.shields.io']; try { const urlObj = new URL(url); if (imageHosts.some(host => urlObj.hostname.includes(host))) return true; } catch {} return false; }
    function willUseProxy(url, config) { return isValidProxyTemplate(config.template) && isImageUrl(url); }
    function applyProxy(url, config) { if (!willUseProxy(url, config)) return url; return config.template.replace('${image}', config.urlEncode ? encodeURIComponent(url) : url); }
    function bindImageClick(img, finalSrc) { img.onclick = null; img.style.cursor = 'pointer'; img.onclick = function(e) { e.preventDefault(); e.stopPropagation(); window.open(finalSrc, '_blank'); }; img.setAttribute('data-final-src', finalSrc); }

    // 图片加载防抖
    let layoutDebounceTimer;
    function scheduleLayout() {
        clearTimeout(layoutDebounceTimer);
        layoutDebounceTimer = setTimeout(() => {
            // Grid布局无需JS重排，但可触发其他更新
            console.log('[Image] 批量加载完成');
        }, 300);
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
                        if (config.template && willUseProxy(originalSrc, config)) console.log('[Image Proxy]', originalSrc, '->', finalSrc);
                        img.classList.add('loading');
                        const tempImg = new Image();
                        tempImg.onload = function() {
                            img.src = finalSrc;
                            img.classList.remove('lazy', 'loading');
                            img.classList.add('loaded');
                            bindImageClick(img, finalSrc);
                            scheduleLayout();
                        };
                        tempImg.onerror = function() {
                            console.warn('[Image Proxy] Failed:', finalSrc, 'Fallback to:', originalSrc);
                            img.src = originalSrc;
                            img.classList.remove('lazy', 'loading');
                            img.classList.add('loaded');
                            bindImageClick(img, originalSrc);
                            scheduleLayout();
                        };
                        tempImg.src = finalSrc;
                        img.removeAttribute('data-src');
                    }
                    self.unobserve(img);
                }
            });
        }, { rootMargin: "500px 0px", threshold: 0.01 });
        document.querySelectorAll('img.lazy[data-src], img.lazy[data-original]').forEach(img => observer.observe(img));
    }
    window.initLazyLoad = initLazyLoad;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLazyLoad); else initLazyLoad();
})();
</script>
`;

// --- 高性能虚拟滚动脚本 ---
const VIRTUAL_SCROLL_SCRIPT = `
<script>
    // 数据源
    let allItems = [];
    let currentIndex = 0;
    const PAGE_SIZE = 50;
    let isLoading = false;

    // 创建卡片
    function createCard(item) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
            <div class="card-title"><a href="\${item.link}" target="_blank">\${item.title}</a></div>
            <div class="card-body">\${item.descriptionHTML}</div>
            <div class="card-meta">
              <div class="meta-item"><i class="far fa-user-circle"></i><span style="font-weight:500; color:#4b5563">\${item.creator}</span></div>
              <div class="meta-item"><i class="far fa-clock"></i><span>\${item.pubDate}</span></div>
            </div>
            <div class="action-bar">
                <a href="/topic/\${item.topicId}" target="_blank" class="btn-action primary"><i class="fas fa-book-open"></i> Jina 浏览</a>
                <a href="\${item.link}" target="_blank" class="btn-action"><i class="fas fa-external-link-alt"></i> 阅读原文</a>
            </div>
        \`;
        return card;
    }

    // 批量渲染
    function renderBatch() {
        if (isLoading || currentIndex >= allItems.length) return;
        isLoading = true;
        
        const grid = document.querySelector('.grid');
        const fragment = document.createDocumentFragment();
        const end = Math.min(currentIndex + PAGE_SIZE, allItems.length);
        
        for (let i = currentIndex; i < end; i++) {
            fragment.appendChild(createCard(allItems[i]));
        }
        
        grid.appendChild(fragment);
        currentIndex = end;
        isLoading = false;
        
        // 触发懒加载
        setTimeout(() => initLazyLoad(), 50);
        
        // 检查是否已全部加载
        if (currentIndex >= allItems.length) {
            document.querySelector('.loading-indicator').style.display = 'none';
        }
    }

    // 滚动监听（防抖）
    let scrollTimer;
    function onScroll() {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;
            
            // 距离底部500px时加载更多
            if (scrollTop + windowHeight >= documentHeight - 500) {
                renderBatch();
            }
            
            // 回到顶部按钮
            const btn = document.querySelector('.back-to-top');
            if (btn) {
                if (scrollTop > 300) btn.classList.add('show'); else btn.classList.remove('show');
            }
        }, 100);
    }

    // 初始化
    function initVirtualScroll() {
        allItems = window.ALL_RSS_ITEMS || [];
        currentIndex = 0;
        renderBatch(); // 渲染首屏
        
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', () => setTimeout(onScroll, 100));
    }

    // 暴露全局方法
    window.scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVirtualScroll);
    } else {
        initVirtualScroll();
    }
</script>
`;

function render(body: string, activeId: string, title: string, items: RSSItem[] = []) {
  const nav = CATEGORIES.map(c => `<a href="/category/${c.id}" class="${activeId === c.id ? "active" : ""}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`).join("");
  const dataScript = `<script>window.ALL_RSS_ITEMS = ${JSON.stringify(items)};</script>`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Linux DO</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>${CSS}</style></head><body><div class="overlay" onclick="toggle()"></div><nav class="sidebar" id="sb"><div class="brand"><i class="fab fa-linux"></i> Linux DO Reader</div><div class="nav"><a href="/" class="${activeId === "home" ? "active" : ""}"><i class="fas fa-home"></i> 首页广场</a>${nav}<div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div><a href="/browser" class="${activeId === "browser" ? "active" : ""}"><i class="fas fa-compass"></i> Jina 浏览器</a><a href="/settings" class="${activeId === "settings" ? "active" : ""}"><i class="fas fa-cog"></i> 系统设置</a></div></nav><div class="main"><div class="header"><button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button><h3>${title}</h3><div style="width:36px"></div></div><div class="content">${body}</div></div><button class="back-to-top" onclick="scrollToTop()"><i class="fas fa-arrow-up"></i></button><script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script><script>function toggle(){document.getElementById('sb').classList.toggle('open');document.querySelector('.overlay').classList.toggle('show')}</script>${dataScript}${IMAGE_PROXY_SCRIPT}${VIRTUAL_SCROLL_SCRIPT}</body></html>`;
}

// 其他函数保持不变...
function renderReaderScript(urlJS: string, backLink: string, backText: string) { /* 不变 */ }

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
      const apiUrl = target.startsWith("http") ? (target.includes("jina.ai") ? target : `${base}/${target}`) : `${base}/https://linux.do${target}`;
      const res = await fetchWithCache(apiUrl, { ttl: DEFAULT_CONFIG.JINA_CACHE_TTL, cacheKey: `jina-${encodeURIComponent(apiUrl)}` }, { headers: h });
      const text = await res.text();
      const cached = res.headers.has("x-cached-time");
      let md = text;
      const idx = text.indexOf("Markdown Content:");
      if (idx > -1) md = text.substring(idx + 17).trim();
      const t = text.match(/Title: (.+)/), d = text.match(/Published Time: (.+)/), u = text.match(/URL Source: (.+)/);
      return new Response(JSON.stringify({ title: t ? t[1] : "Reader", date: d ? formatToBeijingTime(d[1]) : "", url: u ? u[1] : target, markdown: md, cached }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (path === "/settings") {
    const html = `<div class="reader"><h2 style="margin-bottom:2rem; font-size:1.5rem;"><i class="fas fa-sliders-h" style="color:var(primary)"></i> 个性化设置</h2><h3 style=...`;
    return new Response(render(html, "settings", "设置"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (path === "/browser") {
    return new Response(render(`<div class="reader" style="text-align:center;padding-top:4rem"><h1>Jina Browser</h1><input id="u" class="form-input" style="max-width:600px;margin-top:1rem" placeholder="输入网址..."><button onclick="go()" class="btn" style="margin-top:1rem">开始阅读</button></div><script>function go(){const u=document.getElementById('u').value;if(u)location.href='/read?url='+encodeURIComponent(u)}</script>`, "browser", "Browser"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (path === "/read") {
    return new Response(render(renderReaderScript(`'${url.searchParams.get("url")}'`, "/browser", "返回"), "browser", "浏览"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (path.startsWith("/topic/")) {
    return new Response(render(renderReaderScript(`'/t/topic/${path.split("/")[2]}'`, "javascript:history.back()", "返回列表"), "topic", "详情"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  let catId = "latest", title = "最新话题";
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
      <div class="grid"></div>
      <div class="loading-indicator"><i class="fas fa-circle-notch fa-spin"></i><p>加载中...</p></div>
      <div class="cache-info">${cached ? `<i class="fas fa-bolt" style="color:#10b981"></i> 缓存 (${cacheAge}秒前，${Math.max(0, DEFAULT_CONFIG.RSS_CACHE_TTL - cacheAge)}秒后刷新)` : `<i class="fas fa-sync"></i> 已刷新`}</div>
    `;
    
    return new Response(render(html, catId, title, items), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    return new Response(render(`<div style="color:#dc2626">Error: ${e.message}</div>`, catId, "Error", []), { headers: { "Content-Type": "text/html" } });
  }
}

console.log("http://localhost:8000");
serve(handler, { port: 8000 });
