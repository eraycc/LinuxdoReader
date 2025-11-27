// main.ts - Linux DO RSS Reader (Fixed HTML Rendering)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 环境变量默认配置 ---
const DEFAULT_CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
};

// RSS 分类定义
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

// --- 核心逻辑函数 ---

async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "LinuxDOReader/5.0", ...headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    console.error(`Fetch Error: ${url}`, error);
    throw error;
  }
}

// 解析 RSS (保留原始内容，不转义)
function parseRSS(xml: string) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];
    
    // 简单提取标签内容的函数
    const getTag = (tag: string) => {
      const regex = new RegExp(`<${tag}>(?:<\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, 'i');
      const m = itemContent.match(regex);
      return m ? m[1].trim() : "";
    };

    const link = getTag("link");
    const topicIdMatch = link.match(/\/topic\/(\d+)/);
    
    if (link && topicIdMatch) {
      // 获取原始 HTML 描述，不做任何处理，保留 CDATA 内的完整 HTML
      let rawDesc = getTag("description");
      
      items.push({
        title: getTag("title"),
        topicId: topicIdMatch[1],
        descriptionHTML: rawDesc, // 这里存储的是纯 HTML 字符串
        pubDate: getTag("pubDate"),
        creator: getTag("dc:creator")
      });
    }
  }
  return items;
}

function parseJinaResponse(content: string) {
  const titleMatch = content.match(/Title: (.+)/);
  const urlMatch = content.match(/URL Source: (.+)/);
  const dateMatch = content.match(/Published Time: (.+)/);
  let markdown = content;
  const marker = "Markdown Content:";
  const idx = content.indexOf(marker);
  
  if (idx !== -1) markdown = content.substring(idx + marker.length).trim();
  else markdown = markdown.replace(/^(Title|URL Source|Published Time):.*\n/gm, '').trim();

  return {
    title: titleMatch ? titleMatch[1].trim() : "话题详情",
    url: urlMatch ? urlMatch[1].trim() : "",
    date: dateMatch ? dateMatch[1].trim() : "",
    markdown: markdown,
  };
}

// --- UI 样式 ---

const STYLES = `
:root {
    --sidebar-width: 260px;
    --primary: #7c3aed;
    --bg-body: #f3f4f6;
    --bg-sidebar: #1e1e2e;
    --text-sidebar: #a6adc8;
    --bg-card: #ffffff;
    --text-main: #1f2937;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: sans-serif; background: var(--bg-body); color: var(--text-main); display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { width: var(--sidebar-width); background: var(--bg-sidebar); position: fixed; height: 100vh; left: 0; top: 0; z-index: 50; overflow-y: auto; transition: transform 0.3s; }
.nav-links { padding: 1rem 0; }
.nav-item { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: var(--text-sidebar); text-decoration: none; }
.nav-item:hover { color: white; background: rgba(255,255,255,0.05); }
.nav-item.active { color: white; background: rgba(255,255,255,0.1); border-left: 3px solid var(--primary); }
.nav-item i { width: 24px; margin-right: 10px; }

/* Main */
.main-wrapper { margin-left: var(--sidebar-width); flex: 1; transition: margin-left 0.3s; }
.top-bar { background: white; padding: 1rem 2rem; position: sticky; top: 0; z-index: 40; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }
.menu-toggle { display: none; background: none; border: none; font-size: 1.2rem; }

/* RSS Card Styling */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
.card { 
    background: var(--bg-card); 
    border-radius: 12px; 
    padding: 1.5rem; 
    box-shadow: 0 1px 3px rgba(0,0,0,0.05); 
    display: flex; 
    flex-direction: column; 
    position: relative; /* For full-card click */
    overflow: hidden;
    transition: transform 0.2s;
}
.card:hover { transform: translateY(-2px); box-shadow: 0 8px 12px rgba(0,0,0,0.1); }

.rss-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; line-height: 1.4; }
.rss-title a { color: var(--text-main); text-decoration: none; }

/* --- 关键：强制约束 RSS HTML 内容 --- */
.rss-html-content {
    font-size: 0.95rem;
    color: #4b5563;
    line-height: 1.6;
    margin-bottom: 1rem;
    
    /* 限制高度，防止长文刷屏 */
    max-height: 300px; 
    overflow: hidden;
    position: relative;
    
    /* 底部渐变遮罩 */
    -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
    mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
}

/* 约束图片：宽度自适应，高度限制，裁切 */
.rss-html-content img {
    display: block;
    max-width: 100%;
    height: auto;
    max-height: 200px; /* 限制图片高度 */
    object-fit: cover; /* 裁切 */
    border-radius: 8px;
    margin: 0.5rem 0;
}

/* 隐藏不需要的元素 */
.rss-html-content small,  /* 隐藏 "1 post - 1 participant" */
.rss-html-content a[href*="topic"] { /* 隐藏 "Read full topic" 链接 */
    display: none !important;
}

/* 移除所有链接的交互（防止在列表页误触）和样式 */
.rss-html-content a {
    pointer-events: none;
    text-decoration: none;
    color: inherit;
}

.rss-meta { 
    margin-top: auto; 
    padding-top: 0.8rem; 
    border-top: 1px solid #e5e7eb; 
    font-size: 0.85rem; 
    color: #9ca3af; 
    display: flex; 
    justify-content: space-between; 
}

/* Setting & Reader */
.settings-card { background: white; padding: 2rem; border-radius: 12px; }
.form-control { width: 100%; padding: 0.8rem; border: 1px solid #e5e7eb; border-radius: 8px; margin: 0.5rem 0 1.5rem 0; }
.btn { background: var(--primary); color: white; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; cursor: pointer; }
.reader-container { background: white; padding: 2rem; border-radius: 12px; min-height: 60vh; }
.markdown-body img { max-width: 100%; }

@media (max-width: 768px) {
    :root { --sidebar-width: 0px; }
    .sidebar { transform: translateX(-100%); width: 260px; }
    .sidebar.open { transform: translateX(0); box-shadow: 5px 0 15px rgba(0,0,0,0.2); }
    .main-wrapper { margin-left: 0; }
    .menu-toggle { display: block; }
    .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 45; display: none; }
    .sidebar-overlay.show { display: block; }
    .content { padding: 1rem; }
}
`;

// 布局渲染
function renderLayout(content: string, activeId: string, title: string) {
  const nav = CATEGORIES.map(c => 
    `<a href="/category/${c.id}" class="nav-item ${activeId===c.id?'active':''}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>${STYLES}</style>
</head>
<body>
    <div class="sidebar-overlay" onclick="toggleSidebar()"></div>
    <nav class="sidebar" id="sidebar">
        <div style="padding:1.5rem; color:white; font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.1);">Linux DO Reader</div>
        <div class="nav-links">
            <a href="/" class="nav-item ${activeId==='home'?'active':''}"><i class="fas fa-home"></i> 首页</a>
            ${nav}
            <div style="margin:1rem 0; border-top:1px solid rgba(255,255,255,0.1);"></div>
            <a href="/settings" class="nav-item ${activeId==='settings'?'active':''}"><i class="fas fa-cog"></i> 设置</a>
        </div>
    </nav>
    <div class="main-wrapper">
        <div class="top-bar">
            <button class="menu-toggle" onclick="toggleSidebar()"><i class="fas fa-bars"></i></button>
            <h3>${title}</h3>
            <div></div>
        </div>
        <div class="content">${content}</div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
    <script>
        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('open');
            document.querySelector('.sidebar-overlay').classList.toggle('show');
        }
    </script>
</body>
</html>`;
}

// --- 请求处理 ---

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // API
  if (path === "/api/jina") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response(JSON.stringify({ error: "URL required" }), { status: 400 });

    const headers: Record<string, string> = {};
    const jinaBase = request.headers.get("x-custom-jina-base") || DEFAULT_CONFIG.JINA_BASE_URL;
    const jinaKey = request.headers.get("x-custom-jina-key") || DEFAULT_CONFIG.JINA_API_KEY;
    if (jinaKey) headers["Authorization"] = `Bearer ${jinaKey}`;

    try {
        let reqUrl = targetUrl.startsWith("http") 
            ? (targetUrl.includes("jina.ai") ? targetUrl : `${jinaBase}/${targetUrl}`)
            : `${jinaBase}/https://linux.do${targetUrl}`;
            
        const text = await proxyRequest(reqUrl, headers);
        return new Response(JSON.stringify(parseJinaResponse(text)), { headers: { "Content-Type": "application/json" }});
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Page: Settings
  if (path === "/settings") {
      const html = `
        <div class="settings-card">
            <h2>设置</h2>
            <label>Jina Base URL</label>
            <input id="base" class="form-control" placeholder="${DEFAULT_CONFIG.JINA_BASE_URL}">
            <label>Jina API Key</label>
            <input id="key" class="form-control" placeholder="Optional">
            <button onclick="save()" class="btn">保存</button>
            <button onclick="reset()" class="btn" style="background:#ccc; margin-left:1rem;">重置</button>
        </div>
        <script>
            document.addEventListener('DOMContentLoaded', () => {
                const b = localStorage.getItem('r_base'), k = localStorage.getItem('r_key');
                if(b) document.getElementById('base').value = b;
                if(k) document.getElementById('key').value = k;
            });
            function save() {
                const b = document.getElementById('base').value.trim();
                const k = document.getElementById('key').value.trim();
                b ? localStorage.setItem('r_base', b) : localStorage.removeItem('r_base');
                k ? localStorage.setItem('r_key', k) : localStorage.removeItem('r_key');
                alert('Saved');
            }
            function reset() { localStorage.clear(); location.reload(); }
        </script>
      `;
      return new Response(renderLayout(html, "settings", "设置"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // Page: Topic Detail
  if (path.startsWith("/topic/")) {
      const id = path.split("/")[2];
      const html = `
        <div class="reader-container">
            <div style="margin-bottom:1rem;"><a href="javascript:history.back()" style="color:var(--primary); text-decoration:none;">&larr; 返回</a></div>
            <div id="loader" style="text-align:center; padding:2rem;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>
            <div id="error" style="display:none; color:red;"></div>
            <div id="view" style="display:none;">
                <h1 id="tt"></h1>
                <div id="meta" style="color:#888; margin-bottom:1rem;"></div>
                <div id="md" class="markdown-body"></div>
            </div>
        </div>
        <script>
            (async () => {
                const h = {};
                const b = localStorage.getItem('r_base'), k = localStorage.getItem('r_key');
                if(b) h['x-custom-jina-base'] = b;
                if(k) h['x-custom-jina-key'] = k;
                try {
                    const r = await fetch('/api/jina?url=' + encodeURIComponent('/t/topic/${id}'), { headers: h });
                    const d = await r.json();
                    if(d.error) throw new Error(d.error);
                    document.getElementById('loader').style.display='none';
                    document.getElementById('view').style.display='block';
                    document.getElementById('tt').innerText=d.title;
                    document.getElementById('meta').innerHTML=d.date + ' • <a href="'+d.url+'" target="_blank">原文</a>';
                    document.getElementById('md').innerHTML=marked.parse(d.markdown);
                } catch(e) {
                    document.getElementById('loader').style.display='none';
                    document.getElementById('error').style.display='block';
                    document.getElementById('error').innerText = e.message;
                }
            })();
        </script>
      `;
      return new Response(renderLayout(html, "topic", "详情"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // Page: RSS List
  let catId = "latest", pageTitle = "最新话题";
  if (path.startsWith("/category/")) {
      catId = path.split("/")[2];
      const c = CATEGORIES.find(i => i.id === catId);
      if (c) pageTitle = c.name;
  }

  try {
      const rssUrl = `${DEFAULT_CONFIG.RSS_BASE_URL}/${CATEGORIES.find(c => c.id === catId)?.file || 'latest.xml'}`;
      const xml = await proxyRequest(rssUrl);
      const items = parseRSS(xml);

      const html = `
        <div class="card-grid">
            ${items.map(item => `
                <div class="card">
                    <div class="rss-title">
                        <a href="/topic/${item.topicId}">${item.title}</a>
                    </div>
                    
                    <!-- 
                       重点：这里没有任何 escape 逻辑
                       直接将 descriptionHTML 插入到 div 中
                       CSS 类 .rss-html-content 会处理样式和隐藏不必要的元素
                    -->
                    <div class="rss-html-content">
                        ${item.descriptionHTML}
                    </div>
                    
                    <div class="rss-meta">
                        <span>${item.creator || 'Unknown'}</span>
                        <span>${new Date(item.pubDate).toLocaleDateString()}</span>
                    </div>
                    <a href="/topic/${item.topicId}" style="position:absolute; inset:0; z-index:2;"></a>
                </div>
            `).join('')}
        </div>
      `;
      return new Response(renderLayout(html, catId, pageTitle), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  } catch (e) {
      return new Response(renderLayout(`<p style="color:red">RSS Error: ${e.message}</p>`, catId, "Error"), { headers: { "Content-Type": "text/html" }});
  }
}

console.log("Service on http://localhost:8000");
serve(handler, { port: 8000 });
