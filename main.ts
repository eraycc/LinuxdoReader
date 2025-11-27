// main.ts - Linux DO RSS Reader (HTML Rendering Fix)
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

// 1. 代理请求工具
async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinuxDOReader/4.0)",
        ...headers,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    console.error(`Proxy Error [${url}]:`, error);
    throw error;
  }
}

// 2. 解析 RSS XML
// 注意：我们不再这里做复杂的字符串清洗，而是保留 HTML 结构，交给浏览器渲染和 CSS 控制
function parseRSS(xml: string) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];
    
    // 辅助函数：提取 CDATA 或普通内容
    const getTag = (tag: string) => {
      const regex = new RegExp(`<${tag}>(?:<\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, 'i');
      const m = itemContent.match(regex);
      return m ? m[1].trim() : "";
    };

    const link = getTag("link");
    const topicIdMatch = link.match(/\/topic\/(\d+)/);
    const topicId = topicIdMatch ? topicIdMatch[1] : null;
    
    // 获取原始 HTML 描述
    let rawDesc = getTag("description");

    if (link && topicId) {
      items.push({
        title: getTag("title"),
        link: link,
        topicId: topicId,
        // 直接传递原始 HTML，不做转义
        descriptionHTML: rawDesc, 
        pubDate: getTag("pubDate"),
        creator: getTag("dc:creator"),
        category: getTag("category"),
      });
    }
  }
  return items;
}

// 3. 解析 Jina 响应
function parseJinaResponse(content: string) {
  const titleMatch = content.match(/Title: (.+)/);
  const urlMatch = content.match(/URL Source: (.+)/);
  const dateMatch = content.match(/Published Time: (.+)/);
  
  let markdown = content;
  const marker = "Markdown Content:";
  const markerIndex = content.indexOf(marker);
  
  if (markerIndex !== -1) {
    markdown = content.substring(markerIndex + marker.length).trim();
  } else {
    markdown = markdown.replace(/^Title:.*\n/gm, '').replace(/^URL Source:.*\n/gm, '').replace(/^Published Time:.*\n/gm, '').trim();
  }

  return {
    title: titleMatch ? titleMatch[1].trim() : "话题详情",
    url: urlMatch ? urlMatch[1].trim() : "",
    date: dateMatch ? dateMatch[1].trim() : "",
    markdown: markdown,
  };
}

// --- UI 样式与模板 ---

const STYLES = `
:root {
    --sidebar-width: 260px;
    --primary: #7c3aed;
    --bg-body: #f3f4f6;
    --bg-sidebar: #1e1e2e;
    --text-sidebar: #a6adc8;
    --bg-card: #ffffff;
    --text-main: #1f2937;
    --border: #e5e7eb;
}

* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg-body); color: var(--text-main); display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { width: var(--sidebar-width); background: var(--bg-sidebar); color: var(--text-sidebar); position: fixed; height: 100vh; left: 0; top: 0; z-index: 50; overflow-y: auto; transition: transform 0.3s ease; }
.logo-area { padding: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); color: white; font-weight: bold; font-size: 1.2rem; }
.nav-links { padding: 1rem 0; }
.nav-item { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; border-left: 3px solid transparent; transition: all 0.2s; }
.nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
.nav-item.active { background: rgba(255,255,255,0.1); color: white; border-left-color: var(--primary); }
.nav-item i { width: 24px; margin-right: 10px; text-align: center; }

/* Main Content */
.main-wrapper { margin-left: var(--sidebar-width); flex: 1; width: calc(100% - var(--sidebar-width)); transition: margin-left 0.3s; }
.top-bar { background: white; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.menu-toggle { display: none; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-main); }
.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }

/* Cards & RSS Content CSS Reset */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
.card { background: var(--bg-card); border-radius: 12px; padding: 1.5rem; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; overflow: hidden; position: relative; transition: transform 0.2s; }
.card:hover { transform: translateY(-3px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }

.rss-title { font-size: 1.1rem; margin-bottom: 1rem; line-height: 1.4; font-weight: 600; z-index: 2; position: relative; }
.rss-title a { color: var(--text-main); text-decoration: none; }
.rss-title a:hover { color: var(--primary); }

/* --- 核心：RSS 描述内容的 CSS 约束 --- */
.rss-desc-html {
    font-size: 0.9rem;
    color: #4b5563;
    line-height: 1.6;
    margin-bottom: 1rem;
    position: relative;
    z-index: 1;
    
    /* 限制显示高度/行数 */
    max-height: 200px; /* 限制最大高度，防止长文撑爆 */
    overflow: hidden;
    /* 渐变遮罩提示内容未完 */
    mask-image: linear-gradient(180deg, #000 60%, transparent);
    -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent);
}

/* 强制图片适应卡片 */
.rss-desc-html img {
    max-width: 100% !important;
    height: auto !important;
    max-height: 200px !important; /* 限制图片最大高度 */
    object-fit: cover; /* 裁剪图片 */
    border-radius: 6px;
    display: block;
    margin: 0.5rem 0;
}

/* 隐藏掉 RSS 中不想要的特定元素 */
.rss-desc-html small { display: none !important; } /* 隐藏统计信息 1 post... */
.rss-desc-html a[href*="topic"] { display: none !important; } /* 隐藏 Read full topic 链接 */
.rss-desc-html .lightbox-wrapper { display: block !important; } /* 确保图片容器显示 */
.rss-desc-html .meta { display: none !important; }

/* 移除所有链接样式，防止误触 */
.rss-desc-html a { 
    color: inherit !important; 
    text-decoration: none !important; 
    pointer-events: none; 
}

.rss-meta { margin-top: auto; padding-top: 0.8rem; border-top: 1px solid var(--border); font-size: 0.8rem; color: #9ca3af; display: flex; justify-content: space-between; z-index: 2; position: relative; }

/* Settings & Reader */
.settings-card { background: white; padding: 2rem; border-radius: 12px; border: 1px solid var(--border); }
.form-group { margin-bottom: 1.5rem; }
.form-control { width: 100%; padding: 0.8rem; border: 1px solid var(--border); border-radius: 8px; margin-top: 0.5rem; }
.btn { background: var(--primary); color: white; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; cursor: pointer; }
.reader-container { background: white; border-radius: 16px; padding: 2rem; min-height: 60vh; }
.markdown-body img { max-width: 100%; }

@media (max-width: 768px) {
    :root { --sidebar-width: 0px; }
    .sidebar { width: 260px; transform: translateX(-100%); }
    .sidebar.open { transform: translateX(0); box-shadow: 5px 0 15px rgba(0,0,0,0.2); }
    .main-wrapper { margin-left: 0; width: 100%; }
    .menu-toggle { display: block; }
    .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 45; display: none; }
    .sidebar-overlay.show { display: block; }
    .content { padding: 1rem; }
}
`;

function renderLayout(content: string, activeId: string, title: string) {
  const nav = CATEGORIES.map(c => 
    `<a href="/category/${c.id}" class="nav-item ${activeId===c.id?'active':''}"><i style="font-style:normal">${c.icon}</i> ${c.name}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
    <title>${title} - Linux DO Reader</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>${STYLES}</style>
</head>
<body>
    <div class="sidebar-overlay" onclick="toggleSidebar()"></div>
    <nav class="sidebar" id="sidebar">
        <div class="logo-area"><i class="fab fa-linux"></i> Linux DO Reader</div>
        <div class="nav-links">
            <a href="/" class="nav-item ${activeId==='home'?'active':''}"><i class="fas fa-home"></i> 首页广场</a>
            ${nav}
            <div style="height:1px; background:rgba(255,255,255,0.1); margin:1rem 0;"></div>
            <a href="/settings" class="nav-item ${activeId==='settings'?'active':''}"><i class="fas fa-cog"></i> 设置</a>
        </div>
    </nav>
    <div class="main-wrapper">
        <div class="top-bar">
            <button class="menu-toggle" onclick="toggleSidebar()"><i class="fas fa-bars"></i></button>
            <h3>${title}</h3>
            <div style="width:24px"></div>
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

  // API: Jina 代理 (带设置)
  if (path === "/api/jina") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response(JSON.stringify({ error: "Missing URL" }), { status: 400 });

    const clientJinaBase = request.headers.get("x-custom-jina-base");
    const clientJinaKey = request.headers.get("x-custom-jina-key");
    const jinaBase = clientJinaBase || DEFAULT_CONFIG.JINA_BASE_URL;
    const jinaKey = clientJinaKey || DEFAULT_CONFIG.JINA_API_KEY;

    try {
        let requestUrl = "";
        if (targetUrl.startsWith("http")) {
            if (targetUrl.includes("jina.ai")) requestUrl = targetUrl;
            else requestUrl = `${jinaBase}/${targetUrl}`;
        } else {
            requestUrl = `${jinaBase}/https://linux.do${targetUrl}`;
        }
        
        const headers: Record<string, string> = {};
        if (jinaKey) headers["Authorization"] = `Bearer ${jinaKey}`;

        const text = await proxyRequest(requestUrl, headers);
        return new Response(JSON.stringify(parseJinaResponse(text)), { headers: { "Content-Type": "application/json" }});
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // 页面: 设置 (真·设置)
  if (path === "/settings") {
      const html = `
        <div class="settings-card">
            <h2 style="margin-bottom:1.5rem;"><i class="fas fa-sliders-h"></i> 设置</h2>
            <div class="form-group">
                <label>Jina.ai Base URL</label>
                <input type="url" id="cfg_base" class="form-control" placeholder="默认: ${DEFAULT_CONFIG.JINA_BASE_URL}">
            </div>
            <div class="form-group">
                <label>Jina API Key</label>
                <input type="text" id="cfg_key" class="form-control" placeholder="默认: ${DEFAULT_CONFIG.JINA_API_KEY ? '******' : '未设置'}">
            </div>
            <button onclick="save()" class="btn">保存</button>
            <button onclick="reset()" class="btn" style="background:#9ca3af; margin-left:1rem;">重置</button>
        </div>
        <script>
            document.addEventListener('DOMContentLoaded', () => {
                const b = localStorage.getItem('r_base'), k = localStorage.getItem('r_key');
                if(b) document.getElementById('cfg_base').value = b;
                if(k) document.getElementById('cfg_key').value = k;
            });
            function save() {
                const b = document.getElementById('cfg_base').value.trim();
                const k = document.getElementById('cfg_key').value.trim();
                if(b) localStorage.setItem('r_base', b); else localStorage.removeItem('r_base');
                if(k) localStorage.setItem('r_key', k); else localStorage.removeItem('r_key');
                alert('保存成功');
            }
            function reset() {
                localStorage.removeItem('r_base');
                localStorage.removeItem('r_key');
                location.reload();
            }
        </script>
      `;
      return new Response(renderLayout(html, "settings", "设置"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // 页面: 话题详情
  if (path.startsWith("/topic/")) {
      const topicId = path.split("/")[2];
      const html = `
        <div class="reader-container">
            <div style="margin-bottom:1.5rem;"><a href="javascript:history.back()" style="color:var(--primary); text-decoration:none;"><i class="fas fa-arrow-left"></i> 返回</a></div>
            <div id="loading" style="text-align:center; padding:3rem;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>
            <div id="error" style="display:none; background:#fee2e2; color:red; padding:1rem;"></div>
            <div id="article" style="display:none;">
                <h1 id="t" style="margin-bottom:0.5rem;"></h1>
                <p id="d" style="color:#888; margin-bottom:2rem;"></p>
                <div id="m" class="markdown-body"></div>
            </div>
        </div>
        <script>
            async function load() {
                const h = {};
                const b = localStorage.getItem('r_base'), k = localStorage.getItem('r_key');
                if(b) h['x-custom-jina-base'] = b;
                if(k) h['x-custom-jina-key'] = k;
                
                try {
                    const res = await fetch('/api/jina?url=' + encodeURIComponent('/t/topic/${topicId}'), { headers: h });
                    const d = await res.json();
                    if(d.error) throw new Error(d.error);
                    
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('article').style.display = 'block';
                    document.getElementById('t').innerText = d.title;
                    document.getElementById('d').innerHTML = d.date + ' • <a href="'+d.url+'" target="_blank">原文</a>';
                    document.getElementById('m').innerHTML = marked.parse(d.markdown);
                } catch(e) {
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('error').style.display = 'block';
                    document.getElementById('error').innerText = e.message;
                }
            }
            load();
        </script>
      `;
      return new Response(renderLayout(html, "topic", "话题详情"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // 页面: RSS 列表 (首页/分类)
  let categoryId = "latest";
  let title = "最新话题";
  if (path.startsWith("/category/")) {
      categoryId = path.split("/")[2];
      const c = CATEGORIES.find(i => i.id === categoryId);
      if (c) title = c.name;
  }

  try {
      const rssUrl = `${DEFAULT_CONFIG.RSS_BASE_URL}/${CATEGORIES.find(c => c.id === categoryId)?.file || 'latest.xml'}`;
      const xml = await proxyRequest(rssUrl);
      const items = parseRSS(xml);
      
      const html = `
        <div class="card-grid">
            ${items.map(item => `
                <div class="card">
                    <div class="rss-title">
                        <a href="/topic/${item.topicId}">${item.title}</a>
                    </div>
                    <!-- 直接渲染 HTML -->
                    <div class="rss-desc-html">
                        ${item.descriptionHTML}
                    </div>
                    <div class="rss-meta">
                        <span><i class="far fa-user"></i> ${item.creator || 'User'}</span>
                        <span>${new Date(item.pubDate).toLocaleDateString()}</span>
                    </div>
                    <!-- 全卡片点击覆盖层 -->
                    <a href="/topic/${item.topicId}" style="position:absolute; inset:0; z-index:3;"></a>
                </div>
            `).join('')}
        </div>
      `;
      return new Response(renderLayout(html, categoryId, title), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  } catch (e) {
      return new Response(renderLayout(`<div style="text-align:center; color:red;">RSS Error: ${e.message}</div>`, categoryId, "Error"), { headers: { "Content-Type": "text/html" }});
  }
}

console.log("Service running on http://localhost:8000");
serve(handler, { port: 8000 });
