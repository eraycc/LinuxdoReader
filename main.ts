// main.ts - Linux DO RSS Reader Ultimate
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 环境变量默认配置 (作为兜底) ---
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
        "User-Agent": "Mozilla/5.0 (compatible; LinuxDOReader/3.0)",
        ...headers,
      },
    });
    
    if (!response.ok) {
      const err: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
      err.status = response.status;
      throw err;
    }
    return await response.text();
  } catch (error) {
    console.error(`Proxy Error [${url}]:`, error);
    throw error;
  }
}

// 2. 强力清洗 RSS Description
function cleanRSSDescription(html: string): string {
  if (!html) return "";
  
  let clean = html;
  
  // 1. 移除统计信息 (例如: <small>1 post - 1 participant</small>)
  // 这里的正则要兼容有/无外层 <p> 的情况
  clean = clean.replace(/<p>\s*<small>[\s\S]*?<\/small>\s*<\/p>/gi, "");
  clean = clean.replace(/<small>[\s\S]*?<\/small>/gi, "");

  // 2. 移除 "Read full topic" 链接
  clean = clean.replace(/<p>\s*<a href="[^"]+">Read full topic<\/a>\s*<\/p>/gi, "");
  clean = clean.replace(/<a href="[^"]+">Read full topic<\/a>/gi, "");

  // 3. 移除 "前文：" 或 "如题" 等开头常见的无意义词（可选，这里只处理明显的空行）
  clean = clean.replace(/<p>\s*<\/p>/gi, "");
  
  // 4. 处理图片：为了列表美观，我们可以选择保留图片但限制大小，或者只保留文字
  // 这里我们保留图片，但通过CSS限制
  
  return clean.trim();
}

// 3. 解析 RSS XML
function parseRSS(xml: string) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];
    // 辅助函数：提取标签内容，支持 CDATA
    const getTag = (tag: string) => {
      const regex = new RegExp(`<${tag}>(?:<\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, 'i');
      const m = itemContent.match(regex);
      return m ? m[1].trim() : "";
    };

    const link = getTag("link");
    const topicIdMatch = link.match(/\/topic\/(\d+)/);
    const topicId = topicIdMatch ? topicIdMatch[1] : null;

    if (link && topicId) {
      items.push({
        title: getTag("title"),
        link: link,
        topicId: topicId,
        description: cleanRSSDescription(getTag("description")),
        pubDate: getTag("pubDate"),
        creator: getTag("dc:creator"),
        category: getTag("category"),
      });
    }
  }
  return items;
}

// 4. 解析 Jina 响应
function parseJinaResponse(content: string) {
  // 尝试提取元数据
  const titleMatch = content.match(/Title: (.+)/);
  const urlMatch = content.match(/URL Source: (.+)/);
  const dateMatch = content.match(/Published Time: (.+)/);
  
  let markdown = content;
  const marker = "Markdown Content:";
  const markerIndex = content.indexOf(marker);
  
  if (markerIndex !== -1) {
    markdown = content.substring(markerIndex + marker.length).trim();
  } else {
    // 兜底清理：移除头部常见的元数据行
    markdown = markdown.replace(/^Title:.*\n/gm, '')
                       .replace(/^URL Source:.*\n/gm, '')
                       .replace(/^Published Time:.*\n/gm, '')
                       .trim();
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

/* Sidebar & Nav */
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

/* RSS Cards (Fixing overflow issues) */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
.card { background: var(--bg-card); border-radius: 12px; padding: 1.5rem; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; height: 100%; }
.card:hover { transform: translateY(-2px); box-shadow: 0 8px 15px rgba(0,0,0,0.1); transition: all 0.3s; }

.rss-title { font-size: 1.1rem; margin-bottom: 0.8rem; line-height: 1.4; }
.rss-title a { color: var(--text-main); text-decoration: none; font-weight: 600; }
.rss-title a:hover { color: var(--primary); }

/* RSS Description: The Fix */
.rss-content-box {
    font-size: 0.9rem;
    color: #4b5563;
    line-height: 1.6;
    margin-bottom: 1rem;
    flex: 1; /* Push footer down */
    
    /* Clamp lines to prevent overflow */
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 4; /* Show max 4 lines */
    -webkit-box-orient: vertical;
    text-overflow: ellipsis;
}

/* Reset styles inside description to prevent breaking layout */
.rss-content-box p { margin-bottom: 0.5rem; }
.rss-content-box img { display: none; /* Hide images in list view for cleaner look, or remove this line to show */ } 
/* Remove underlines from links inside description */
.rss-content-box a { text-decoration: none; color: var(--primary); pointer-events: none; /* Disable clicks in preview */ }

.rss-meta { margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.8rem; color: #9ca3af; display: flex; justify-content: space-between; }

/* Settings Form */
.settings-card { background: white; padding: 2rem; border-radius: 12px; border: 1px solid var(--border); }
.form-group { margin-bottom: 1.5rem; }
.form-group label { display: block; margin-bottom: 0.5rem; font-weight: 500; }
.form-control { width: 100%; padding: 0.8rem; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; }
.btn-primary { background: var(--primary); color: white; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 1rem; }
.btn-primary:hover { opacity: 0.9; }
.hint { font-size: 0.85rem; color: #6b7280; margin-top: 0.3rem; }

/* Skeleton & Article */
.reader-container { background: white; border-radius: 16px; padding: 2rem; min-height: 60vh; }
.markdown-body { font-size: 1rem; line-height: 1.7; }
.markdown-body img { max-width: 100%; border-radius: 8px; }

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

  // API: Jina 代理 (支持客户端传入设置)
  if (path === "/api/jina") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response(JSON.stringify({ error: "Missing URL" }), { status: 400 });

    // 优先使用请求头中的配置，其次使用环境变量
    const clientJinaBase = request.headers.get("x-custom-jina-base");
    const clientJinaKey = request.headers.get("x-custom-jina-key");
    
    const jinaBase = clientJinaBase || DEFAULT_CONFIG.JINA_BASE_URL;
    const jinaKey = clientJinaKey || DEFAULT_CONFIG.JINA_API_KEY;

    try {
        // 构造完整 Jina URL
        let requestUrl = "";
        if (targetUrl.startsWith("http")) {
            if (targetUrl.includes("jina.ai")) requestUrl = targetUrl; // 已经是完整链接
            else requestUrl = `${jinaBase}/${targetUrl}`;
        } else {
            // 只是路径 /t/topic/xxx
            requestUrl = `${jinaBase}/https://linux.do${targetUrl}`;
        }

        const headers: Record<string, string> = {};
        if (jinaKey) headers["Authorization"] = `Bearer ${jinaKey}`;

        const text = await proxyRequest(requestUrl, headers);
        const data = parseJinaResponse(text);
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" }});
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // 页面: 设置 (真·设置)
  if (path === "/settings") {
      const html = `
        <div class="settings-card">
            <h2 style="margin-bottom:1.5rem;"><i class="fas fa-sliders-h"></i> 个性化设置</h2>
            
            <div class="form-group">
                <label>Jina.ai Base URL (代理地址)</label>
                <input type="url" id="cfg_jina_base" class="form-control" placeholder="默认: ${DEFAULT_CONFIG.JINA_BASE_URL}">
                <p class="hint">例如: https://r.jina.ai 或者你的自建代理</p>
            </div>

            <div class="form-group">
                <label>Jina API Key (可选)</label>
                <input type="text" id="cfg_jina_key" class="form-control" placeholder="默认: ${DEFAULT_CONFIG.JINA_API_KEY ? '******' : '未设置'}">
                <p class="hint">如果你有 Jina 的 Pro Key，可以在此填入以获得更高额度</p>
            </div>

            <div class="form-group">
                <label>RSS Base URL (仅展示)</label>
                <input type="text" class="form-control" value="${DEFAULT_CONFIG.RSS_BASE_URL}" disabled style="background:#f9fafb; color:#888;">
                <p class="hint">RSS 源地址由服务器环境变量控制，暂不支持前端修改。</p>
            </div>

            <button onclick="saveSettings()" class="btn-primary"><i class="fas fa-save"></i> 保存设置</button>
            <button onclick="clearSettings()" style="margin-left:1rem; background:none; border:1px solid #ddd; padding:0.8rem; border-radius:8px; cursor:pointer;">恢复默认</button>
        </div>

        <script>
            // 加载设置
            document.addEventListener('DOMContentLoaded', () => {
                const base = localStorage.getItem('reader_jina_base');
                const key = localStorage.getItem('reader_jina_key');
                if(base) document.getElementById('cfg_jina_base').value = base;
                if(key) document.getElementById('cfg_jina_key').value = key;
            });

            // 保存设置
            function saveSettings() {
                const base = document.getElementById('cfg_jina_base').value.trim();
                const key = document.getElementById('cfg_jina_key').value.trim();
                
                if(base) localStorage.setItem('reader_jina_base', base);
                else localStorage.removeItem('reader_jina_base');
                
                if(key) localStorage.setItem('reader_jina_key', key);
                else localStorage.removeItem('reader_jina_key');
                
                alert('设置已保存！阅读文章时将生效。');
            }

            function clearSettings() {
                localStorage.removeItem('reader_jina_base');
                localStorage.removeItem('reader_jina_key');
                location.reload();
            }
        </script>
      `;
      return new Response(renderLayout(html, "settings", "系统设置"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // 页面: 话题详情 (动态加载，带设置)
  if (path.startsWith("/topic/")) {
      const topicId = path.split("/")[2];
      const html = `
        <div class="reader-container">
            <div style="margin-bottom:1.5rem;">
                <a href="javascript:history.back()" style="color:var(--primary); text-decoration:none; font-weight:500;"><i class="fas fa-arrow-left"></i> 返回列表</a>
            </div>
            <div id="loading" style="text-align:center; padding:3rem; color:#888;">
                <i class="fas fa-spinner fa-spin fa-2x"></i><br><br>正在通过 Jina 加载内容...
            </div>
            <div id="error" style="display:none; background:#fee2e2; color:#dc2626; padding:1.5rem; border-radius:8px;"></div>
            <div id="article" style="display:none;">
                <h1 id="art-title" style="margin-bottom:0.5rem;"></h1>
                <div style="color:#888; font-size:0.9rem; margin-bottom:2rem;">
                    <span id="art-date"></span> • <a id="art-link" href="#" target="_blank" style="color:inherit;">原文链接</a>
                </div>
                <div id="art-body" class="markdown-body"></div>
            </div>
        </div>
        <script>
            async function load() {
                // 1. 读取本地设置
                const jinaBase = localStorage.getItem('reader_jina_base') || '';
                const jinaKey = localStorage.getItem('reader_jina_key') || '';
                
                // 2. 构建请求头
                const headers = {};
                if(jinaBase) headers['x-custom-jina-base'] = jinaBase;
                if(jinaKey) headers['x-custom-jina-key'] = jinaKey;
                
                const targetPath = '/t/topic/${topicId}';
                
                try {
                    const res = await fetch('/api/jina?url=' + encodeURIComponent(targetPath), { headers });
                    const data = await res.json();
                    
                    if(data.error) throw new Error(data.error);
                    
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('article').style.display = 'block';
                    document.getElementById('art-title').innerText = data.title;
                    document.getElementById('art-date').innerText = data.date || '刚刚';
                    document.getElementById('art-link').href = data.url;
                    document.getElementById('art-body').innerHTML = marked.parse(data.markdown);
                } catch(e) {
                    document.getElementById('loading').style.display = 'none';
                    const errEl = document.getElementById('error');
                    errEl.style.display = 'block';
                    errEl.innerHTML = '<b>加载失败</b><br>' + e.message + '<br><br><button onclick="location.reload()" style="padding:5px 10px;">重试</button>';
                }
            }
            load();
        </script>
      `;
      return new Response(renderLayout(html, "topic", "话题详情"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // 页面: RSS 列表 (默认首页或分类)
  let categoryId = "latest";
  let title = "最新话题";
  
  if (path.startsWith("/category/")) {
      categoryId = path.split("/")[2];
      const cat = CATEGORIES.find(c => c.id === categoryId);
      if (cat) title = cat.name;
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
                    <!-- 使用 html 渲染，通过 class 控制溢出和样式 -->
                    <div class="rss-content-box">
                        ${item.description}
                    </div>
                    <div class="rss-meta">
                        <span><i class="far fa-user"></i> ${item.creator || 'Unknown'}</span>
                        <span>${new Date(item.pubDate).toLocaleDateString()}</span>
                    </div>
                    <a href="/topic/${item.topicId}" style="position:absolute; width:100%; height:100%; top:0; left:0; z-index:1;"></a>
                </div>
            `).join('')}
        </div>
        <!-- 覆盖 card 的点击区域，让整个卡片可点，但保留内部文本的选择能力(如果z-index调整的话) -->
        <style>.card { position: relative; } .rss-content-box { z-index: 0; }</style>
      `;
      return new Response(renderLayout(html, categoryId, title), { headers: { "Content-Type": "text/html; charset=utf-8" }});
      
  } catch (e) {
      return new Response(renderLayout(`<div style="text-align:center; padding:3rem; color:red;">RSS 加载失败: ${e.message}</div>`, categoryId, "Error"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }
}

console.log("Listening on http://localhost:8000");
serve(handler, { port: 8000 });
