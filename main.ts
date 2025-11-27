import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置 ---
const DEFAULT_CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
  SCRAPE_BASE_URL: Deno.env.get("SCRAPE_BASE_URL") || "https://api.scrape.do",
  SCRAPE_TOKEN: Deno.env.get("SCRAPE_TOKEN") || "",
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

// --- 核心工具 ---

// 生成代理 URL
function proxifyImage(url: string, token: string, baseUrl: string): string {
  if (!token || !url) return url;
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(url);
  const isLinuxDoUpload = url.includes("linux.do/uploads");
  if (isImage || isLinuxDoUpload) {
    const finalBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${finalBase}?token=${token}&url=${encodeURIComponent(url)}`;
  }
  return url;
}

// HTML 懒加载处理: src -> data-src
function processHtmlImagesLazy(html: string, token: string, baseUrl: string): string {
  // 匹配 <img ... src="..." ...>
  return html.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, p1, src, p2) => {
    const realUrl = proxifyImage(src, token, baseUrl);
    // 构造新的 img 标签：
    // 1. src 使用透明像素或 loading 占位
    // 2. 真实地址放入 data-src
    // 3. 添加 class="lazy"
    return `<img ${p1} src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${realUrl}" class="lazy" ${p2}>`;
  });
}

// Markdown 懒加载处理 (替换后 Markdown 渲染出的 img 标签需要被前端 JS 捕获，或者我们在这里直接把 markdown 的 img 语法替换成 HTML img 标签?)
// 更好的做法：保持 Markdown 原样，但在前端 marked 渲染后，通过 JS 统一处理 src -> data-src。
// 或者：在后端把 ![alt](url) 替换为 HTML <img class="lazy" data-src="url" ...>
function processMarkdownImagesLazy(md: string, token: string, baseUrl: string): string {
  // 替换 Markdown 图片语法为 HTML Lazy Image
  return md.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
    const [cleanSrc, title] = src.split(/\s+"'/);
    const realUrl = proxifyImage(cleanSrc, token, baseUrl);
    const titleAttr = title ? ` title="${title}"` : "";
    return `<img alt="${alt}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${realUrl}" class="lazy"${titleAttr}>`;
  });
}

function unescapeHTML(str: string) {
  if (!str) return "";
  return str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&");
}

function parseRSS(xml: string, scrapeToken: string, scrapeBase: string) {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemBlock = match[1];
    const extract = (tagName: string) => {
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
      // 处理 HTML 图片为懒加载格式
      let desc = extract("description");
      // 注意：即使没有 Token，我们也做懒加载处理 (data-src)，只是不走代理
      desc = processHtmlImagesLazy(desc, scrapeToken, scrapeBase);

      items.push({
        title: extract("title"),
        link: link,
        topicId: topicIdMatch[1],
        descriptionHTML: desc,
        pubDate: extract("pubDate"),
        creator: extract("dc:creator") || "Linux Do",
      });
    }
  }
  return items;
}

async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "LinuxDOReader/11.0", ...headers } });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.text();
  } catch (e) { console.error(e); throw e; }
}

// --- CSS ---
const CSS = `
:root { --sidebar-width: 260px; --primary: #7c3aed; --bg: #f3f4f6; --card-bg: #fff; --text: #374151; }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }
.sidebar { width: var(--sidebar-width); background: #1e1e2e; color: #a6adc8; position: fixed; inset: 0 auto 0 0; z-index: 100; overflow-y: auto; transform: translateX(-100%); transition: transform 0.3s; }
.sidebar.open { transform: translateX(0); box-shadow: 0 0 50px rgba(0,0,0,0.5); }
.brand { padding: 1.5rem; color: #fff; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); }
.nav a { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; }
.nav a:hover, .nav a.active { background: rgba(255,255,255,0.1); color: #fff; }
.nav a.active { border-left: 3px solid var(--primary); background: rgba(124, 58, 237, 0.1); }
.nav i { width: 24px; margin-right: 8px; text-align: center; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
.overlay.show { opacity: 1; pointer-events: auto; }
.main { flex: 1; width: 100%; margin-left: 0; min-width: 0; }
.header { background: #fff; padding: 0.8rem 1.5rem; position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; }
.menu-btn { width: 40px; height: 40px; display: flex; justify-content: center; align-items: center; background: transparent; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; align-items: start; }
.card { background: var(--card-bg); border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; position: relative; overflow: hidden; }
.card-body { font-size: 0.95rem; color: #4b5563; line-height: 1.6; margin-bottom: 1rem; overflow-wrap: anywhere; word-break: break-word; }
.card-body * { max-width: 100% !important; box-sizing: border-box; }

/* --- Lazy Load Image Styles --- */
.card-body img, .markdown-body img {
    display: block;
    height: auto; /* 保持比例 */
    min-height: 50px; /* 避免高度塌陷 */
    border-radius: 6px;
    margin: 10px 0;
    background: #f3f4f6; /* 占位背景色 */
    transition: opacity 0.3s ease-in;
}
img.lazy { opacity: 0.5; } /* 加载前透明度降低 */
img.loaded { opacity: 1; }   /* 加载后完全显示 */

.card-body pre { overflow-x: auto; background: #f8fafc; padding: 10px; border-radius: 6px; }
.card-body small, .card-body a[href*="topic"] { display: none !important; }
.card-body a { pointer-events: none; color: inherit; text-decoration: none; }
.action-bar { display: flex; gap: 10px; position: relative; z-index: 10; }
.btn-action { flex: 1; padding: 0.7rem; border-radius: 8px; text-decoration: none; font-size: 0.9rem; text-align: center; border: 1px solid #e5e7eb; color: var(--text); }
.btn-action.primary { background: #f3e8ff; color: var(--primary); border-color: transparent; }
.card-link { position: absolute; inset: 0; z-index: 1; }
.reader { background: #fff; padding: 2rem; border-radius: 12px; }
.form-input { width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1rem; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; cursor: pointer; }
@media (max-width: 768px) { .content { padding: 1rem; } }
`;

// --- 通用懒加载脚本 ---
const LAZY_LOAD_SCRIPT = `
<script>
// 通用懒加载观察器
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
    }, { rootMargin: "200px 0px" }); // 提前200px开始加载

    document.querySelectorAll('img.lazy').forEach(img => observer.observe(img));
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initLazyLoad);
</script>
`;

function render(body: string, activeId: string, title: string) {
  const nav = CATEGORIES.map(c => `<a href="/category/${c.id}" class="${activeId===c.id?'active':''}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Linux DO</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>${CSS}</style></head><body><div class="overlay" onclick="toggle()"></div><nav class="sidebar" id="sb"><div class="brand"><i class="fab fa-linux"></i> Linux DO Reader</div><div class="nav"><a href="/" class="${activeId==='home'?'active':''}"><i class="fas fa-home"></i> 首页广场</a>${nav}<div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div><a href="/browser" class="${activeId==='browser'?'active':''}"><i class="fas fa-compass"></i> Jina 浏览器</a><a href="/settings" class="${activeId==='settings'?'active':''}"><i class="fas fa-cog"></i> 系统设置</a></div></nav><div class="main"><div class="header"><button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button><h3>${title}</h3><div style="width:40px"></div></div><div class="content">${body}</div></div><script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script><script>function toggle(){document.getElementById('sb').classList.toggle('open');document.querySelector('.overlay').classList.toggle('show')}</script>${LAZY_LOAD_SCRIPT}</body></html>`;
}

function renderReaderScript(urlJS: string, backLink: string, backText: string) {
    return `
      <div class="reader">
        <div style="margin-bottom:1rem"><a href="${backLink}" style="color:var(--primary);text-decoration:none"><i class="fas fa-arrow-left"></i> ${backText}</a></div>
        <div id="load" style="text-align:center;padding:4rem"><i class="fas fa-spinner fa-spin fa-3x" style="color:#ddd"></i></div>
        <div id="err" style="display:none;color:#dc2626;padding:1rem;background:#fee2e2;border-radius:8px"></div>
        <div id="view" style="display:none">
          <h1 id="tt" style="margin-bottom:0.5rem"></h1>
          <div id="meta" style="color:#888;margin-bottom:2rem;border-bottom:1px solid #eee;padding-bottom:1rem"></div>
          <div id="md" class="markdown-body"></div>
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
            document.getElementById('meta').innerHTML = (d.date||'') + ' • <a href="'+d.url+'" target="_blank">原文</a>';
            // 渲染内容 (后端已经转换成了 <img class="lazy" data-src="..."> 格式)
            document.getElementById('md').innerHTML = marked.parse(d.markdown);
            
            // 手动触发一次懒加载初始化，因为内容是异步插入的
            initLazyLoad();
          } catch(e) {
            document.getElementById('load').style.display='none';
            document.getElementById('err').style.display='block';
            document.getElementById('err').innerText = 'Error: ' + e.message;
          }
        })();
      </script>
    `;
}

// --- Handler ---

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // API: Jina Proxy (Returns JSON with Markdown)
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
      const apiUrl = target.startsWith("http") ? (target.includes("jina.ai") ? target : `${base}/${target}`) : `${base}/https://linux.do${target}`;
      const text = await proxyRequest(apiUrl, h);
      let md = text;
      const idx = text.indexOf("Markdown Content:");
      if (idx > -1) md = text.substring(idx + 17).trim();
      
      // 后端预处理：将 Markdown 图片语法替换为 HTML 懒加载标签
      // 注意：即使用户没配 Token，也替换为 Lazy 标签，只是 URL 不变
      md = processMarkdownImagesLazy(md, scrapeKey, scrapeBase);

      const t = text.match(/Title: (.+)/), d = text.match(/Published Time: (.+)/), u = text.match(/URL Source: (.+)/);
      return new Response(JSON.stringify({ title: t?t[1]:"Reader", date: d?d[1]:"", url: u?u[1]:target, markdown: md }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) { return new Response(JSON.stringify({ error: e.message }), { status: 500 }); }
  }

  // ... (Settings, Browser, Read logic remains same, simplified here) ...
  if (path === "/settings") {
      const html = `
        <div class="reader settings"><h2>设置</h2><label>Jina Base</label><input id="base" class="form-input"><label>Jina Key</label><input id="key" class="form-input"><label>Scrape Base</label><input id="sb" class="form-input"><label>Scrape Token</label><input id="sk" class="form-input"><button onclick="save()" class="btn">保存</button></div>
        <script>const $=id=>document.getElementById(id);$('base').value=localStorage.getItem('r_base')||'';$('key').value=localStorage.getItem('r_key')||'';$('sb').value=localStorage.getItem('s_base')||'';$('sk').value=localStorage.getItem('s_key')||'';function save(){localStorage.setItem('r_base',$('base').value);localStorage.setItem('r_key',$('key').value);localStorage.setItem('s_base',$('sb').value);localStorage.setItem('s_key',$('sk').value);alert('Saved')}</script>
      `;
      return new Response(render(html, "settings", "设置"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }
  if (path === "/browser") { return new Response(render(`<div class="reader" style="text-align:center;padding-top:4rem"><h1>Jina Browser</h1><input id="u" class="form-input" style="max-width:600px"><button onclick="go()" class="btn">Go</button></div><script>function go(){location.href='/read?url='+encodeURIComponent(document.getElementById('u').value)}</script>`, "browser", "Browser"), { headers: { "Content-Type": "text/html; charset=utf-8" }}); }
  if (path === "/read") { return new Response(render(renderReaderScript(`'${url.searchParams.get("url")}'`, '/browser', 'Back'), "browser", "Read"), { headers: { "Content-Type": "text/html; charset=utf-8" }}); }
  if (path.startsWith("/topic/")) { return new Response(render(renderReaderScript(`'/t/topic/${path.split("/")[2]}'`, 'javascript:history.back()', 'Back'), "topic", "Detail"), { headers: { "Content-Type": "text/html; charset=utf-8" }}); }

  // RSS List
  let catId = "latest", title = "最新话题";
  if (path.startsWith("/category/")) { catId = path.split("/")[2]; const c = CATEGORIES.find(x => x.id === catId); if(c) title = c.name; }

  try {
    const file = CATEGORIES.find(c => c.id === catId)?.file || "latest.xml";
    const xml = await proxyRequest(`${DEFAULT_CONFIG.RSS_BASE_URL}/${file}`);
    const scrapeKey = req.headers.get("x-scrape-key") || DEFAULT_CONFIG.SCRAPE_TOKEN;
    const scrapeBase = req.headers.get("x-scrape-base") || DEFAULT_CONFIG.SCRAPE_BASE_URL;
    
    // 后端 SSR 生成懒加载 HTML
    const items = parseRSS(xml, scrapeKey, scrapeBase);
    
    const html = `
      <div class="grid">
        ${items.map(item => `
          <div class="card">
            <div class="card-title">${item.title}</div>
            <div class="card-body">${item.descriptionHTML}</div>
            <div class="card-meta"><span>${item.creator}</span><span>${new Date(item.pubDate).toLocaleDateString()}</span></div>
            <div class="action-bar">
                <a href="/topic/${item.topicId}" class="btn-action primary"><i class="fas fa-book-open"></i> Jina</a>
                <a href="${item.link}" target="_blank" class="btn-action" onclick="event.stopPropagation()"><i class="fas fa-external-link-alt"></i> 原文</a>
            </div>
            <a href="/topic/${item.topicId}" class="card-link"></a>
          </div>
        `).join('')}
      </div>
      <script>
         // 客户端增强：如果 LocalStorage 有 Token，进行二次替换并初始化 LazyLoad
         document.addEventListener('DOMContentLoaded', () => {
            const token = localStorage.getItem('s_key');
            const base = localStorage.getItem('s_base') || '${DEFAULT_CONFIG.SCRAPE_BASE_URL}';
            if(token) {
                // 这里需要更新 data-src，因为 DOM 已经是 lazy 状态了
                document.querySelectorAll('img.lazy').forEach(img => {
                    const original = img.getAttribute('data-src');
                    // 避免重复替换
                    if(original && !original.includes(base)) {
                        const finalBase = base.endsWith('/') ? base : base + '/';
                        const newSrc = \`\${finalBase}?token=\${token}&url=\${encodeURIComponent(original)}\`;
                        img.setAttribute('data-src', newSrc);
                    }
                });
            }
            // 重新初始化监听器，确保新的 data-src 被使用
            initLazyLoad();
         });
      </script>
    `;
    return new Response(render(html, catId, title), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  } catch (e: any) { return new Response(render(`<div style="color:red">Error: ${e.message}</div>`, catId, "Error"), { headers: { "Content-Type": "text/html" }}); }
}

console.log("Service running on http://localhost:8000");
serve(handler, { port: 8000 });
