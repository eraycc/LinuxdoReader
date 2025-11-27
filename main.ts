import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置 ---
const DEFAULT_CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
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

// --- 工具函数 ---

// 反转义 HTML 实体 (防止源码泄露)
function unescapeHTML(str: string) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

// RSS 解析 (只提取 HTML，不转换 Markdown)
function parseRSS(xml: string) {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemBlock = match[1];
    const extract = (tagName: string) => {
      // 1. 尝试 CDATA (Raw HTML)
      const cdataRegex = new RegExp(`<${tagName}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, "i");
      const cdataMatch = itemBlock.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1];

      // 2. 尝试普通内容 (需反转义)
      const normalRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
      const normalMatch = itemBlock.match(normalRegex);
      if (normalMatch) return unescapeHTML(normalMatch[1]); 

      return "";
    };

    const link = extract("link").trim();
    const topicIdMatch = link.match(/\/topic\/(\d+)/);

    if (link && topicIdMatch) {
      items.push({
        title: extract("title"),
        link: link,
        topicId: topicIdMatch[1],
        descriptionHTML: extract("description"), // 直接使用 HTML
        pubDate: extract("pubDate"),
        creator: extract("dc:creator") || "Linux Do",
      });
    }
  }
  return items;
}

async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "LinuxDOReader/9.0", ...headers } });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(e); throw e;
  }
}

// --- CSS (核心防御布局) ---

const CSS = `
:root {
  --sidebar-width: 260px;
  --primary: #7c3aed;
  --primary-bg: #f3e8ff;
  --bg: #f3f4f6;
  --card-bg: #fff;
  --text: #374151;
  --gray: #6b7280;
}
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { 
    width: var(--sidebar-width); background: #1e1e2e; color: #a6adc8; 
    position: fixed; inset: 0 auto 0 0; z-index: 100; overflow-y: auto; 
    transform: translateX(-100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.sidebar.open { transform: translateX(0); box-shadow: 0 0 50px rgba(0,0,0,0.5); }
.brand { padding: 1.5rem; color: #fff; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; gap: 10px; align-items: center; }
.nav a { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; }
.nav a:hover, .nav a.active { background: rgba(255,255,255,0.1); color: #fff; }
.nav a.active { border-left: 3px solid var(--primary); background: rgba(124, 58, 237, 0.1); }
.nav i { width: 24px; margin-right: 8px; text-align: center; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 0.3s; backdrop-filter: blur(2px); }
.overlay.show { opacity: 1; pointer-events: auto; }

/* Main */
.main { flex: 1; width: 100%; margin-left: 0; min-width: 0; }
.header { background: #fff; padding: 0.8rem 1.5rem; position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; }
.menu-btn { width: 40px; height: 40px; display: flex; justify-content: center; align-items: center; background: transparent; border: 1px solid #e5e7eb; border-radius: 8px; color: var(--text); cursor: pointer; }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }

/* Grid & Card */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; align-items: start; }
.card { 
    background: var(--card-bg); border-radius: 12px; padding: 1.5rem; 
    box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; 
    position: relative; transition: transform 0.2s; overflow: hidden; /* 防止圆角溢出 */
}
.card:hover { transform: translateY(-3px); box-shadow: 0 10px 15px rgba(0,0,0,0.1); }
.card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; line-height: 1.4; }

/* --- 核心：Card Body 防御性 CSS --- */
.card-body {
    font-size: 0.95rem;
    color: #4b5563;
    line-height: 1.6;
    margin-bottom: 1rem;
    /* 强制文字换行，防止长串撑开 */
    overflow-wrap: anywhere;
    word-break: break-word;
}

/* 1. 限制所有子元素宽度 */
.card-body * {
    max-width: 100% !important;
    box-sizing: border-box;
}

/* 2. 图片自适应 */
.card-body img {
    display: block;
    height: auto;
    border-radius: 6px;
    margin: 10px 0;
    background: #f3f4f6; /* 图片加载前的占位色 */
}

/* 3. 代码块与表格：允许内部横向滚动，但不撑开卡片 */
.card-body pre, 
.card-body table {
    display: block;
    width: 100%;
    overflow-x: auto; /* 关键：内部滚动 */
    background: #f8fafc;
    border-radius: 6px;
    border: 1px solid #eee;
    margin: 10px 0;
}
.card-body pre { padding: 10px; }
.card-body table { border-collapse: collapse; }
.card-body th, .card-body td { border: 1px solid #ddd; padding: 6px; white-space: nowrap; }

/* 4. 隐藏不需要的元数据 */
.card-body small, .card-body a[href*="topic"] { display: none !important; }
.card-body br { display: block; content: ""; margin-bottom: 6px; }

/* 5. 禁止正文链接交互 (防止误点) */
.card-body a { pointer-events: none; color: inherit; text-decoration: none; }


/* Meta Info */
.card-meta { margin-top: auto; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.85rem; color: var(--gray); display: flex; justify-content: space-between; margin-bottom: 1rem; }

/* Action Buttons */
.action-bar { display: flex; gap: 10px; position: relative; z-index: 10; }
.btn-action {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 0.7rem; border-radius: 8px; text-decoration: none; font-size: 0.9rem; cursor: pointer; transition: all 0.2s;
    border: 1px solid #e5e7eb; background: white; color: var(--text);
}
.btn-action.primary { background: var(--primary-bg); color: var(--primary); border-color: transparent; font-weight: 500; }
.btn-action:hover { filter: brightness(0.95); transform: translateY(-1px); }

/* 全卡片点击覆盖层 (z-index:1，低于按钮的10) */
.card-link { position: absolute; inset: 0; z-index: 1; }

/* Reader & Forms */
.reader { background: #fff; padding: 2rem; border-radius: 12px; min-height: 60vh; }
.form-input { width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1rem; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; cursor: pointer; }
@media (max-width: 768px) { .content { padding: 1rem; } }
`;

// --- 模板渲染 ---

function render(bodyContent: string, activeId: string, title: string) {
  const navItems = CATEGORIES.map(c => 
    `<a href="/category/${c.id}" class="${activeId===c.id?'active':''}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} - Linux DO</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>${CSS}</style>
</head>
<body>
  <div class="overlay" onclick="toggle()"></div>
  <nav class="sidebar" id="sb">
    <div class="brand"><i class="fab fa-linux"></i> Linux DO Reader</div>
    <div class="nav">
      <a href="/" class="${activeId==='home'?'active':''}"><i class="fas fa-home"></i> 首页广场</a>
      ${navItems}
      <div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div>
      <a href="/browser" class="${activeId==='browser'?'active':''}"><i class="fas fa-compass"></i> Jina 浏览器</a>
      <a href="/settings" class="${activeId==='settings'?'active':''}"><i class="fas fa-cog"></i> 系统设置</a>
    </div>
  </nav>
  <div class="main">
    <div class="header">
      <button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button>
      <h3>${title}</h3>
      <div style="width:40px"></div>
    </div>
    <div class="content">${bodyContent}</div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
  <script>
    function toggle() { document.getElementById('sb').classList.toggle('open'); document.querySelector('.overlay').classList.toggle('show'); }
  </script>
</body></html>`;
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
          if(b) h['x-base'] = b; if(k) h['x-key'] = k;
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

// --- Main Handler ---

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
      const text = await proxyRequest(apiUrl, h);
      let md = text;
      const idx = text.indexOf("Markdown Content:");
      if (idx > -1) md = text.substring(idx + 17).trim();
      
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
            <div style="max-width:600px; margin:2rem auto;">
                <input type="url" id="u" class="form-input" placeholder="https://...">
                <button onclick="go()" class="btn" style="width:100%">阅读</button>
            </div>
        </div>
        <script>
            function go() { const u = document.getElementById('u').value.trim(); if(u) window.location.href = '/read?url=' + encodeURIComponent(u); }
            document.getElementById('u').addEventListener('keypress', e => { if(e.key==='Enter') go() });
        </script>
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
        <h2>设置</h2>
        <input id="base" class="form-input" placeholder="${DEFAULT_CONFIG.JINA_BASE_URL}">
        <input id="key" class="form-input" placeholder="API Key">
        <button class="btn" onclick="save()">保存</button>
        <button class="btn" onclick="reset()" style="background:#ccc;margin-left:1rem">重置</button>
      </div>
      <script>
        const $ = id => document.getElementById(id);
        $('base').value = localStorage.getItem('r_base') || '';
        $('key').value = localStorage.getItem('r_key') || '';
        function save() {
          const b = $('base').value.trim(), k = $('key').value.trim();
          b ? localStorage.setItem('r_base', b) : localStorage.removeItem('r_base');
          k ? localStorage.setItem('r_key', k) : localStorage.removeItem('r_key');
          alert('Saved');
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
    const items = parseRSS(xml);
    
    const html = `
      <div class="grid">
        ${items.map(item => `
          <div class="card">
            <div class="card-title">${item.title}</div>
            <!-- 1. 直接输出 Raw HTML -->
            <div class="card-body">
              ${item.descriptionHTML}
            </div>
            <div class="card-meta">
              <span>${item.creator}</span>
              <span>${new Date(item.pubDate).toLocaleDateString()}</span>
            </div>
            <!-- 2. 新增操作栏 -->
            <div class="action-bar">
                <a href="/topic/${item.topicId}" class="btn-action primary">
                    <i class="fas fa-book-open"></i> Jina 浏览
                </a>
                <a href="${item.link}" target="_blank" class="btn-action" onclick="event.stopPropagation()">
                    <i class="fas fa-external-link-alt"></i> 阅读原文
                </a>
            </div>
            <!-- 3. 覆盖层 (不挡按钮) -->
            <a href="/topic/${item.topicId}" class="card-link"></a>
          </div>
        `).join('')}
      </div>
    `;
    return new Response(render(html, catId, title), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  } catch (e: any) {
    return new Response(render(`<div style="color:red">RSS Error: ${e.message}</div>`, catId, "Error"), { headers: { "Content-Type": "text/html" }});
  }
}

console.log("Service running on http://localhost:8000");
serve(handler, { port: 8000 });
