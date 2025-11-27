import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置与常量 ---
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

// --- 核心工具函数 ---

// 1. HTML 反转义工具 (核心修复点)
// 能够将 &lt;p&gt; 变回 <p>，确保浏览器渲染而不是显示源码
function unescapeHTML(str: string) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

// 2. RSS 解析器 (重构版)
function parseRSS(xml: string) {
  const items: any[] = [];
  // 使用非贪婪匹配捕获 item
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemBlock = match[1];

    // 提取函数：优先处理 CDATA，如果没有则处理普通文本，最后必须反转义
    const extract = (tagName: string) => {
      // 尝试匹配 <tag><![CDATA[content]]></tag>
      const cdataRegex = new RegExp(`<${tagName}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, "i");
      const cdataMatch = itemBlock.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1]; // CDATA 内容通常已经是 Raw HTML

      // 尝试匹配 <tag>content</tag>
      const normalRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
      const normalMatch = itemBlock.match(normalRegex);
      if (normalMatch) return unescapeHTML(normalMatch[1]); // 普通内容可能是转义过的，需要反转义

      return "";
    };

    const link = extract("link").trim();
    // 提取 Topic ID
    const topicIdMatch = link.match(/\/topic\/(\d+)/);

    if (link && topicIdMatch) {
      items.push({
        title: extract("title"),
        link: link,
        topicId: topicIdMatch[1],
        // 这里的 descriptionHTML 现在绝对是 <p>...</p> 格式的真 HTML
        descriptionHTML: extract("description"), 
        pubDate: extract("pubDate"),
        creator: extract("dc:creator") || "Linux Do",
      });
    }
  }
  return items;
}

// 3. 网络请求封装
async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "LinuxDOReader/6.0", ...headers } });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error("Fetch error:", e);
    throw e;
  }
}

// --- 页面样式 (CSS) ---

const CSS = `
:root {
  --sidebar-width: 260px;
  --primary: #7c3aed;
  --bg: #f3f4f6;
  --card-bg: #fff;
  --text: #374151;
  --gray: #9ca3af;
}
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }

/* 侧边栏 */
.sidebar { width: var(--sidebar-width); background: #1e1e2e; color: #a6adc8; position: fixed; inset: 0 auto 0 0; z-index: 50; overflow-y: auto; transition: transform 0.3s; }
.brand { padding: 1.5rem; color: #fff; font-weight: bold; font-size: 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
.nav a { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; }
.nav a:hover, .nav a.active { background: rgba(255,255,255,0.1); color: #fff; }
.nav a.active { border-left: 3px solid var(--primary); }
.nav i { width: 24px; margin-right: 8px; }

/* 主区域 */
.main { margin-left: var(--sidebar-width); flex: 1; width: 100%; transition: margin-left 0.3s; }
.header { background: #fff; padding: 1rem 2rem; position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center; }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }
.menu-btn { display: none; background: none; border: none; font-size: 1.2rem; cursor: pointer; }

/* 卡片布局 */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
.card { background: var(--card-bg); border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; position: relative; overflow: hidden; transition: transform 0.2s; }
.card:hover { transform: translateY(-3px); box-shadow: 0 10px 15px rgba(0,0,0,0.1); }

.card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; line-height: 1.4; }
.card-title a { color: var(--text); text-decoration: none; }

/* --- 核心：Description HTML 渲染修正 --- */
.card-body {
  font-size: 0.95rem;
  color: #4b5563;
  line-height: 1.6;
  margin-bottom: 1rem;
  max-height: 260px; /* 防止过长 */
  overflow: hidden;
  position: relative;
  /* 底部遮罩 */
  -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent);
  mask-image: linear-gradient(180deg, #000 70%, transparent);
}

/* 强制控制 RSS 内部 HTML 元素的样式 */
.card-body p { margin-bottom: 0.5rem; }
.card-body img { 
  display: block; 
  max-width: 100%; 
  height: auto; 
  max-height: 180px; /* 限制图片高度 */
  object-fit: cover; 
  border-radius: 6px; 
  margin: 0.5rem 0; 
}
/* 隐藏不需要的元素 */
.card-body small, 
.card-body a[href*="topic"] { display: none !important; }
.card-body br { display: none; }

/* 禁止卡片内链接点击，全卡片响应 */
.card-body a { pointer-events: none; text-decoration: none; color: inherit; }

.card-meta { margin-top: auto; padding-top: 0.8rem; border-top: 1px solid #e5e7eb; font-size: 0.85rem; color: var(--gray); display: flex; justify-content: space-between; }
.card-link { position: absolute; inset: 0; z-index: 10; }

/* 其他页面 */
.reader { background: #fff; padding: 2rem; border-radius: 12px; min-height: 60vh; }
.settings input { width: 100%; padding: 0.8rem; margin: 0.5rem 0 1.5rem; border: 1px solid #ddd; border-radius: 6px; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.5rem; border-radius: 6px; cursor: pointer; }

/* 移动端适配 */
@media (max-width: 768px) {
  :root { --sidebar-width: 0px; }
  .sidebar { transform: translateX(-100%); width: 260px; }
  .sidebar.open { transform: translateX(0); box-shadow: 5px 0 15px rgba(0,0,0,0.3); }
  .main { margin-left: 0; }
  .menu-btn { display: block; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 45; display: none; }
  .overlay.show { display: block; }
  .content { padding: 1rem; }
}
`;

// --- 页面渲染 ---

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
      <a href="/" class="${activeId==='home'?'active':''}"><i class="fas fa-home"></i> 首页</a>
      ${navItems}
      <div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1)"></div>
      <a href="/settings" class="${activeId==='settings'?'active':''}"><i class="fas fa-cog"></i> 设置</a>
    </div>
  </nav>
  <div class="main">
    <div class="header">
      <button class="menu-btn" onclick="toggle()"><i class="fas fa-bars"></i></button>
      <h3>${title}</h3>
      <div></div>
    </div>
    <div class="content">${bodyContent}</div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
  <script>
    function toggle() {
      document.getElementById('sb').classList.toggle('open');
      document.querySelector('.overlay').classList.toggle('show');
    }
  </script>
</body></html>`;
}

// --- 主处理逻辑 ---

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // API: Jina 代理
  if (path === "/api/jina") {
    const target = url.searchParams.get("url");
    if (!target) return new Response("Miss URL", { status: 400 });
    
    const h: Record<string, string> = {};
    const key = req.headers.get("x-key") || DEFAULT_CONFIG.JINA_API_KEY;
    const base = req.headers.get("x-base") || DEFAULT_CONFIG.JINA_BASE_URL;
    if (key) h["Authorization"] = `Bearer ${key}`;

    try {
      const apiUrl = target.startsWith("http") 
        ? (target.includes("jina.ai") ? target : `${base}/${target}`)
        : `${base}/https://linux.do${target}`;
      
      const text = await proxyRequest(apiUrl, h);
      
      // 简单解析 Markdown
      let md = text;
      const idx = text.indexOf("Markdown Content:");
      if (idx > -1) md = text.substring(idx + 17).trim();
      
      const titleM = text.match(/Title: (.+)/);
      const dateM = text.match(/Published Time: (.+)/);
      const urlM = text.match(/URL Source: (.+)/);

      return new Response(JSON.stringify({
        title: titleM ? titleM[1] : "详情",
        date: dateM ? dateM[1] : "",
        url: urlM ? urlM[1] : "",
        markdown: md
      }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Page: Settings
  if (path === "/settings") {
    const html = `
      <div class="reader settings">
        <h2>设置</h2>
        <label>Jina Base URL</label>
        <input id="base" placeholder="${DEFAULT_CONFIG.JINA_BASE_URL}">
        <label>API Key</label>
        <input id="key" placeholder="Optional">
        <button class="btn" onclick="save()">保存配置</button>
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
          alert('已保存');
        }
        function reset() { localStorage.clear(); location.reload(); }
      </script>
    `;
    return new Response(render(html, "settings", "设置"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // Page: Topic Detail
  if (path.startsWith("/topic/")) {
    const id = path.split("/")[2];
    const html = `
      <div class="reader">
        <div style="margin-bottom:1rem"><a href="javascript:history.back()" style="color:var(--primary);text-decoration:none">&larr; 返回列表</a></div>
        <div id="load" style="text-align:center;padding:3rem"><i class="fas fa-spinner fa-spin fa-2x"></i></div>
        <div id="err" style="display:none;color:red;padding:1rem"></div>
        <div id="view" style="display:none">
          <h1 id="tt" style="margin-bottom:0.5rem"></h1>
          <div id="meta" style="color:#888;margin-bottom:2rem;font-size:0.9rem"></div>
          <div id="md" class="markdown-body"></div>
        </div>
      </div>
      <script>
        (async () => {
          const h = {};
          const b = localStorage.getItem('r_base'), k = localStorage.getItem('r_key');
          if(b) h['x-base'] = b; if(k) h['x-key'] = k;
          try {
            const r = await fetch('/api/jina?url=' + encodeURIComponent('/t/topic/${id}'), {headers:h});
            const d = await r.json();
            if(d.error) throw new Error(d.error);
            document.getElementById('load').style.display='none';
            document.getElementById('view').style.display='block';
            document.getElementById('tt').innerText = d.title;
            document.getElementById('meta').innerHTML = (d.date||'') + ' <a href="'+d.url+'" target="_blank">[原文]</a>';
            document.getElementById('md').innerHTML = marked.parse(d.markdown);
          } catch(e) {
            document.getElementById('load').style.display='none';
            document.getElementById('err').style.display='block';
            document.getElementById('err').innerText = '加载失败: ' + e.message;
          }
        })();
      </script>
    `;
    return new Response(render(html, "topic", "详情"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // Page: List (RSS)
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
            <!-- 核心：直接输出反转义后的 HTML -->
            <div class="card-body">
              ${item.descriptionHTML}
            </div>
            <div class="card-meta">
              <span>${item.creator}</span>
              <span>${new Date(item.pubDate).toLocaleDateString()}</span>
            </div>
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
