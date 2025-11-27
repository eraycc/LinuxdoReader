import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置与常量 ---
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

// --- 核心工具函数 ---

// 1. 图片代理处理 (Scrape.do)
function proxifyImage(url: string, token: string, baseUrl: string): string {
  if (!token || !url) return url;

  const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(url);
  const isLinuxDoUpload = url.includes("linux.do/uploads");

  if (isImage || isLinuxDoUpload) {
    // 构造 Scrape URL: https://api.scrape.do/?token=TOKEN&url=ENCODED_URL
    // 注意: scrape.do 建议 url 参数放在最后
    const finalBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${finalBase}?token=${token}&url=${encodeURIComponent(url)}`;
  }
  return url;
}

// 2. HTML 图片链接替换 (用于 RSS Description)
function processHtmlImages(html: string, token: string, baseUrl: string): string {
  if (!token) return html;
  // 匹配 <img src="...">
  return html.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
    const newSrc = proxifyImage(src, token, baseUrl);
    return match.replace(src, newSrc);
  });
}

// 3. Markdown 图片链接替换 (用于 Jina 详情)
function processMarkdownImages(md: string, token: string, baseUrl: string): string {
  if (!token) return md;
  // 匹配 ![alt](url)
  return md.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
    // 过滤掉可能的 title 部分 ![alt](url "title")
    const [cleanSrc, title] = src.split(/\s+"'/);
    const newSrc = proxifyImage(cleanSrc, token, baseUrl);
    return `![${alt}](${newSrc}${title ? ` "${title}"` : ''})`;
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
      // 提取 Description 并进行图片代理替换
      let desc = extract("description");
      if (scrapeToken) {
        desc = processHtmlImages(desc, scrapeToken, scrapeBase);
      }

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
    const res = await fetch(url, { headers: { "User-Agent": "LinuxDOReader/10.0", ...headers } });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(e); throw e;
  }
}

// --- CSS ---
const CSS = `
:root { --sidebar-width: 260px; --primary: #7c3aed; --primary-bg: #f3e8ff; --bg: #f3f4f6; --card-bg: #fff; --text: #374151; }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }
.sidebar { width: var(--sidebar-width); background: #1e1e2e; color: #a6adc8; position: fixed; inset: 0 auto 0 0; z-index: 100; overflow-y: auto; transform: translateX(-100%); transition: transform 0.3s; }
.sidebar.open { transform: translateX(0); box-shadow: 0 0 50px rgba(0,0,0,0.5); }
.brand { padding: 1.5rem; color: #fff; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; gap: 10px; align-items: center; }
.nav a { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; }
.nav a:hover, .nav a.active { background: rgba(255,255,255,0.1); color: #fff; }
.nav a.active { border-left: 3px solid var(--primary); background: rgba(124, 58, 237, 0.1); }
.nav i { width: 24px; margin-right: 8px; text-align: center; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.3s; backdrop-filter: blur(2px); }
.overlay.show { opacity: 1; pointer-events: auto; }
.main { flex: 1; width: 100%; margin-left: 0; min-width: 0; }
.header { background: #fff; padding: 0.8rem 1.5rem; position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; }
.menu-btn { width: 40px; height: 40px; display: flex; justify-content: center; align-items: center; background: transparent; border: 1px solid #e5e7eb; border-radius: 8px; color: var(--text); cursor: pointer; }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; align-items: start; }
.card { background: var(--card-bg); border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; position: relative; transition: transform 0.2s; overflow: hidden; }
.card:hover { transform: translateY(-3px); box-shadow: 0 10px 15px rgba(0,0,0,0.1); }
.card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; line-height: 1.4; }
.card-body { font-size: 0.95rem; color: #4b5563; line-height: 1.6; margin-bottom: 1rem; overflow-wrap: anywhere; word-break: break-word; }
.card-body * { max-width: 100% !important; box-sizing: border-box; }
.card-body img { display: block; height: auto; border-radius: 6px; margin: 10px 0; background: #f3f4f6; }
.card-body pre, .card-body table { display: block; width: 100%; overflow-x: auto; background: #f8fafc; border-radius: 6px; border: 1px solid #eee; margin: 10px 0; }
.card-body pre { padding: 10px; }
.card-body table { border-collapse: collapse; }
.card-body th, .card-body td { border: 1px solid #ddd; padding: 6px; white-space: nowrap; }
.card-body small, .card-body a[href*="topic"] { display: none !important; }
.card-body br { display: block; content: ""; margin-bottom: 6px; }
.card-body a { pointer-events: none; color: inherit; text-decoration: none; }
.card-meta { margin-top: auto; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.85rem; color: #6b7280; display: flex; justify-content: space-between; margin-bottom: 1rem; }
.action-bar { display: flex; gap: 10px; position: relative; z-index: 10; }
.btn-action { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0.7rem; border-radius: 8px; text-decoration: none; font-size: 0.9rem; cursor: pointer; transition: all 0.2s; border: 1px solid #e5e7eb; background: white; color: var(--text); }
.btn-action.primary { background: var(--primary-bg); color: var(--primary); border-color: transparent; font-weight: 500; }
.card-link { position: absolute; inset: 0; z-index: 1; }
.reader { background: #fff; padding: 2rem; border-radius: 12px; min-height: 60vh; }
.form-group { margin-bottom: 1.5rem; }
.form-label { display: block; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.95rem; }
.form-hint { font-size: 0.85rem; color: #666; margin-top: 0.3rem; }
.form-input { width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 8px; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; cursor: pointer; }
@media (max-width: 768px) { .content { padding: 1rem; } }
`;

function render(body: string, activeId: string, title: string) {
  const nav = CATEGORIES.map(c => `<a href="/category/${c.id}" class="${activeId===c.id?'active':''}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Linux DO</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"><style>${CSS}</style></head><body><div class="overlay" onclick="toggle()"></div><nav class="sidebar" id="sb"><div class="brand"><i class="fab fa-linux"></i> Linux DO Reader</div><div class="nav"><a href="/" class="${activeId==='home'?'active':''}"><i class="fas fa-home"></i> 首页广场</a>${nav}<div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div><a href="/browser" class="${activeId==='browser'?'active':''}"><i class="fas fa-compass"></i> Jina 浏览器</a><a href="/settings" class="${activeId==='settings'?'active':''}"><i class="fas fa-cog"></i> 系统设置</a></div></nav><div class="main"><div class="header"><button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button><h3>${title}</h3><div style="width:40px"></div></div><div class="content">${body}</div></div><script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script><script>function toggle(){document.getElementById('sb').classList.toggle('open');document.querySelector('.overlay').classList.toggle('show')}</script></body></html>`;
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
          if(sb) h['x-scrape-base'] = sb; if(sk) h['x-scrape-key'] = sk; // 传递 scrape 配置
          
          try {
            const r = await fetch('/api/jina?url=' + encodeURIComponent(${urlJS}), {headers:h});
            const d = await r.json();
            if(d.error) throw new Error(d.error);
            document.getElementById('load').style.display='none';
            document.getElementById('view').style.display='block';
            document.getElementById('tt').innerText = d.title;
            document.getElementById('meta').innerHTML = (d.date||'') + ' • <a href="'+d.url+'" target="_blank">原文</a>';
            document.getElementById('md').innerHTML = marked.parse(d.markdown);
            document.querySelectorAll('.markdown-body img').forEach(i => i.loading = 'lazy');
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
      
      // --- 图片替换逻辑 (Markdown) ---
      if (scrapeKey) {
        md = processMarkdownImages(md, scrapeKey, scrapeBase);
      }

      const t = text.match(/Title: (.+)/), d = text.match(/Published Time: (.+)/), u = text.match(/URL Source: (.+)/);
      return new Response(JSON.stringify({ title: t?t[1]:"Reader", date: d?d[1]:"", url: u?u[1]:target, markdown: md }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (path === "/browser") {
    const html = `
        <div class="reader" style="text-align:center; padding-top:4rem;">
            <i class="fas fa-compass" style="font-size:4rem; color:var(--primary); margin-bottom:2rem;"></i>
            <h1>Jina 浏览器</h1>
            <div style="max-width:600px; margin:2rem auto;"><input type="url" id="u" class="form-input" placeholder="https://..."><button onclick="go()" class="btn" style="width:100%">阅读</button></div>
        </div>
        <script>function go(){const u=document.getElementById('u').value.trim();if(u)window.location.href='/read?url='+encodeURIComponent(u)}document.getElementById('u').addEventListener('keypress',e=>{if(e.key==='Enter')go()})</script>
      `;
    return new Response(render(html, "browser", "Jina 浏览器"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  if (path === "/read") {
    const target = url.searchParams.get("url") || "";
    return new Response(render(renderReaderScript(`'${target}'`, '/browser', '返回'), "browser", "阅读"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  if (path === "/settings") {
    const html = `
      <div class="reader settings">
        <h2 style="margin-bottom:1.5rem">系统设置</h2>
        
        <h3 style="border-bottom:1px solid #eee; padding-bottom:0.5rem; margin-bottom:1rem;">Jina AI (内容获取)</h3>
        <div class="form-group">
            <label class="form-label">Jina Base URL</label>
            <input id="base" class="form-input" placeholder="${DEFAULT_CONFIG.JINA_BASE_URL}">
        </div>
        <div class="form-group">
            <label class="form-label">API Key (Optional)</label>
            <input id="key" class="form-input" placeholder="********">
        </div>

        <h3 style="border-bottom:1px solid #eee; padding-bottom:0.5rem; margin:2rem 0 1rem 0;">Scrape.do (图片代理)</h3>
        <div class="form-group">
            <label class="form-label">Scrape Base URL</label>
            <input id="s_base" class="form-input" placeholder="${DEFAULT_CONFIG.SCRAPE_BASE_URL}">
        </div>
        <div class="form-group">
            <label class="form-label">Scrape Token</label>
            <input id="s_key" class="form-input" placeholder="Token 用于绕过 CF 加载图片">
            <p class="form-hint">配置后，RSS 列表和文章详情中的图片将自动使用 scrape.do 代理加载。</p>
        </div>

        <div style="margin-top:2rem">
            <button class="btn" onclick="save()">保存配置</button>
            <button class="btn" onclick="reset()" style="background:#ccc;margin-left:1rem">恢复默认</button>
        </div>
      </div>
      <script>
        const $ = id => document.getElementById(id);
        $('base').value = localStorage.getItem('r_base') || '';
        $('key').value = localStorage.getItem('r_key') || '';
        $('s_base').value = localStorage.getItem('s_base') || '';
        $('s_key').value = localStorage.getItem('s_key') || '';

        function save() {
          const b=$('base').value.trim(), k=$('key').value.trim();
          const sb=$('s_base').value.trim(), sk=$('s_key').value.trim();
          
          b ? localStorage.setItem('r_base', b) : localStorage.removeItem('r_base');
          k ? localStorage.setItem('r_key', k) : localStorage.removeItem('r_key');
          sb ? localStorage.setItem('s_base', sb) : localStorage.removeItem('s_base');
          sk ? localStorage.setItem('s_key', sk) : localStorage.removeItem('s_key');
          
          alert('设置已保存');
        }
        function reset() { localStorage.clear(); location.reload(); }
      </script>
    `;
    return new Response(render(html, "settings", "设置"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  if (path.startsWith("/topic/")) {
    const id = path.split("/")[2];
    return new Response(render(renderReaderScript(`'/t/topic/${id}'`, 'javascript:history.back()', '返回'), "topic", "详情"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  let catId = "latest", title = "最新话题";
  if (path.startsWith("/category/")) {
    catId = path.split("/")[2];
    const c = CATEGORIES.find(x => x.id === catId);
    if (c) title = c.name;
  }

  try {
    const file = CATEGORIES.find(c => c.id === catId)?.file || "latest.xml";
    const xml = await proxyRequest(`${DEFAULT_CONFIG.RSS_BASE_URL}/${file}`);
    
    // 读取请求头中的 scrape 配置 (用户手动设置的优先级最高)
    const scrapeKey = req.headers.get("x-scrape-key") || DEFAULT_CONFIG.SCRAPE_TOKEN;
    const scrapeBase = req.headers.get("x-scrape-base") || DEFAULT_CONFIG.SCRAPE_BASE_URL;
    
    // 解析时传入 Scrape 配置，进行 HTML 图片替换
    const items = parseRSS(xml, scrapeKey, scrapeBase);
    
    const html = `
      <div class="grid">
        ${items.map(item => `
          <div class="card">
            <div class="card-title">${item.title}</div>
            <div class="card-body">${item.descriptionHTML}</div>
            <div class="card-meta">
              <span>${item.creator}</span>
              <span>${new Date(item.pubDate).toLocaleDateString()}</span>
            </div>
            <div class="action-bar">
                <a href="/topic/${item.topicId}" class="btn-action primary"><i class="fas fa-book-open"></i> Jina 浏览</a>
                <a href="${item.link}" target="_blank" class="btn-action" onclick="event.stopPropagation()"><i class="fas fa-external-link-alt"></i> 阅读原文</a>
            </div>
            <a href="/topic/${item.topicId}" class="card-link"></a>
          </div>
        `).join('')}
      </div>
      <!-- 用于列表页：客户端脚本读取 Scrape 设置并重新请求当前页? -->
      <!-- 实际上 SSR 阶段无法直接读取 localStorage，所以列表页的 scrape 只能靠环境变量默认值，或者通过 URL 参数，或者 Client-Side Replace -->
      <!-- 修正：为了让列表页支持 localStorage 的设置，我们需要在客户端执行一次图片替换 -->
      <script>
         document.addEventListener('DOMContentLoaded', () => {
            const token = localStorage.getItem('s_key');
            const base = localStorage.getItem('s_base') || '${DEFAULT_CONFIG.SCRAPE_BASE_URL}';
            if(token) {
                // 客户端二次增强：替换 RSS 列表中的图片
                document.querySelectorAll('.card-body img').forEach(img => {
                    const src = img.src;
                    const isImg = /\\.(jpg|jpeg|png|gif|webp|svg)$/i.test(src);
                    const isLinux = src.includes('linux.do/uploads');
                    // 避免重复替换
                    if(!src.includes(base) && (isImg || isLinux)) {
                        const finalBase = base.endsWith('/') ? base : base + '/';
                        img.src = \`\${finalBase}?token=\${token}&url=\${encodeURIComponent(src)}\`;
                    }
                });
            }
         });
      </script>
    `;
    return new Response(render(html, catId, title), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  } catch (e: any) {
    return new Response(render(`<div style="color:red">Error: ${e.message}</div>`, catId, "Error"), { headers: { "Content-Type": "text/html" }});
  }
}

console.log("Service running on http://localhost:8000");
serve(handler, { port: 8000 });
