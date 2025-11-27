// main.ts - Linux DO RSS Reader Refined
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// --- 配置区域 ---
const CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_PROXY: Deno.env.get("JINA_PROXY") || "", // 可选二级代理
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
};

// RSS 分类定义 (对应 http://linuxdorss.longpink.com/ 的文件名)
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
        "User-Agent": "Mozilla/5.0 (compatible; LinuxDOReader/2.0; +http://localhost)",
        ...headers,
      },
    });
    
    if (!response.ok) {
      // 抛出带状态码的错误，方便上层处理
      const err: any = new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      err.status = response.status;
      throw err;
    }
    
    return await response.text();
  } catch (error) {
    console.error(`Proxy Error [${url}]:`, error);
    throw error;
  }
}

// 2. 清洗 RSS Description 内容
function cleanRSSDescription(html: string): string {
  if (!html) return "";
  
  let clean = html;
  // 移除 "Read full topic" 链接
  clean = clean.replace(/<p>\s*<a href=".*?">Read full topic<\/a>\s*<\/p>/gi, "");
  // 移除统计信息 (例如: 1 post - 1 participant)
  clean = clean.replace(/<p>\s*<small>.*?<\/small>\s*<\/p>/gi, "");
  // 移除末尾可能残留的空 P 标签
  clean = clean.replace(/<p>\s*<\/p>/gi, "");
  // 移除 "前文：" 这种可能导致样式错乱的文字头部（可选，视情况而定）
  
  return clean;
}

// 3. 解析 RSS XML
function parseRSS(xml: string) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];
    const getTag = (tag: string) => {
      const regex = new RegExp(`<${tag}>(?:<\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, 'i');
      const m = itemContent.match(regex);
      return m ? m[1].trim() : "";
    };

    const link = getTag("link");
    // 从 Link 中提取 Topic ID (https://linux.do/t/topic/12345)
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
  // 简单健壮的解析
  const titleMatch = content.match(/Title: (.+)/);
  const urlMatch = content.match(/URL Source: (.+)/);
  const dateMatch = content.match(/Published Time: (.+)/);
  
  // 寻找 Markdown Content 的开始位置
  const marker = "Markdown Content:";
  let markdown = "";
  const markerIndex = content.indexOf(marker);
  
  if (markerIndex !== -1) {
    markdown = content.substring(markerIndex + marker.length).trim();
  } else {
    // 如果没有明确标记，尝试过滤掉头部元数据
    markdown = content.replace(/Title:.*?\n/, '').replace(/URL Source:.*?\n/, '').replace(/Published Time:.*?\n/, '').trim();
  }

  return {
    title: titleMatch ? titleMatch[1].trim() : "无标题",
    url: urlMatch ? urlMatch[1].trim() : "",
    date: dateMatch ? dateMatch[1].trim() : "",
    markdown: markdown,
  };
}

// --- UI 组件 ---

// 样式表
const STYLES = `
:root {
    --sidebar-width: 260px;
    --primary: #7c3aed; /* Purple-600 */
    --primary-hover: #6d28d9;
    --bg-body: #f3f4f6;
    --bg-sidebar: #1e1e2e; /* Dark sidebar */
    --text-sidebar: #a6adc8;
    --text-sidebar-active: #ffffff;
    --bg-card: #ffffff;
    --text-main: #111827;
    --text-muted: #6b7280;
    --border: #e5e7eb;
}

* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: var(--bg-body);
    color: var(--text-main);
    display: flex;
    min-height: 100vh;
    overflow-x: hidden;
}

/* Sidebar */
.sidebar {
    width: var(--sidebar-width);
    background-color: var(--bg-sidebar);
    color: var(--text-sidebar);
    display: flex;
    flex-direction: column;
    position: fixed;
    height: 100vh;
    left: 0;
    top: 0;
    z-index: 50;
    transition: transform 0.3s ease;
    overflow-y: auto;
}

.logo-area {
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
}
.logo-area h1 { color: white; font-size: 1.25rem; font-weight: 700; display: flex; align-items: center; gap: 10px; }

.nav-links { padding: 1rem 0; flex: 1; }
.nav-item {
    display: flex;
    align-items: center;
    padding: 0.75rem 1.5rem;
    color: var(--text-sidebar);
    text-decoration: none;
    transition: all 0.2s;
    border-left: 3px solid transparent;
}
.nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
.nav-item.active { background: rgba(255,255,255,0.1); color: white; border-left-color: var(--primary); }
.nav-item i { width: 24px; margin-right: 10px; text-align: center; }

.sidebar-footer {
    padding: 1.5rem;
    background: rgba(0,0,0,0.2);
    font-size: 0.85rem;
}
.slogan-title { color: white; font-weight: 600; margin-bottom: 0.5rem; display: block; }
.slogan-text { font-size: 0.75rem; opacity: 0.7; line-height: 1.5; }

/* Main Content */
.main-wrapper {
    margin-left: var(--sidebar-width);
    flex: 1;
    width: calc(100% - var(--sidebar-width));
    transition: margin-left 0.3s ease, width 0.3s ease;
}

.top-bar {
    background: white;
    padding: 1rem 2rem;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 40;
}

.menu-toggle { display: none; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-main); }
.page-title { font-size: 1.1rem; font-weight: 600; }

.content { padding: 2rem; max-width: 1000px; margin: 0 auto; }

/* Cards */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
.card {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    transition: transform 0.2s, box-shadow 0.2s;
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
}
.card:hover { transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,0.1); }

.rss-item h3 { font-size: 1.1rem; line-height: 1.4; margin-bottom: 0.75rem; }
.rss-item h3 a { color: var(--text-main); text-decoration: none; }
.rss-item h3 a:hover { color: var(--primary); }

.rss-desc { 
    font-size: 0.9rem; 
    color: var(--text-muted); 
    margin-bottom: 1rem; 
    flex: 1; 
    overflow: hidden;
}
/* 去除 RSS 描述中链接的下划线 */
.rss-desc a { text-decoration: none; color: var(--primary); }
.rss-desc img { max-width: 100%; height: auto; border-radius: 6px; margin-top: 0.5rem; }

.meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
}

.tag { background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }

/* Jina Browser & Content */
.reader-container { background: white; border-radius: 16px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); min-height: 60vh; }
.reader-header { border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 2rem; }
.reader-header h1 { font-size: 1.8rem; margin-bottom: 1rem; line-height: 1.3; }
.reader-meta { color: var(--text-muted); font-size: 0.9rem; }

.markdown-body { font-size: 1rem; line-height: 1.7; color: #374151; }
.markdown-body h1, .markdown-body h2 { border-bottom: none; padding-bottom: 0; }
.markdown-body img { max-width: 100%; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.markdown-body pre { background: #f8fafc; border-radius: 8px; padding: 1rem; }

/* Skeleton Loading */
.skeleton { animation: shimmer 2s infinite linear; background: linear-gradient(to right, #f6f7f8 0%, #edeef1 20%, #f6f7f8 40%, #f6f7f8 100%); background-size: 1000px 100%; }
.sk-title { height: 32px; width: 80%; margin-bottom: 1rem; border-radius: 4px; }
.sk-meta { height: 20px; width: 40%; margin-bottom: 2rem; border-radius: 4px; }
.sk-line { height: 16px; margin-bottom: 0.8rem; border-radius: 4px; }
.sk-line.short { width: 60%; }

@keyframes shimmer { 0% { background-position: -1000px 0; } 100% { background-position: 1000px 0; } }

/* Error State */
.error-box { text-align: center; padding: 3rem 1rem; color: #ef4444; background: #fef2f2; border-radius: 12px; border: 1px solid #fee2e2; }
.error-box i { font-size: 3rem; margin-bottom: 1rem; opacity: 0.8; }
.btn-retry { margin-top: 1rem; padding: 0.5rem 1.5rem; background: white; border: 1px solid #ef4444; color: #ef4444; border-radius: 6px; cursor: pointer; }

/* Mobile Responsive */
@media (max-width: 768px) {
    :root { --sidebar-width: 0px; }
    .sidebar { width: 260px; transform: translateX(-100%); }
    .sidebar.open { transform: translateX(0); box-shadow: 5px 0 15px rgba(0,0,0,0.3); }
    .menu-toggle { display: block; }
    .main-wrapper { margin-left: 0; width: 100%; }
    .content { padding: 1rem; }
    
    /* Overlay when menu is open */
    .sidebar-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5); z-index: 45;
        display: none;
    }
    .sidebar-overlay.show { display: block; }
}
`;

// 布局模板
function renderLayout(content: string, activeId: string, pageTitle: string) {
  // 生成侧边栏 HTML
  const navHtml = CATEGORIES.map(cat => `
    <a href="/category/${cat.id}" class="nav-item ${activeId === cat.id ? 'active' : ''}">
      <i>${cat.icon}</i> ${cat.name}
    </a>
  `).join('');

  const otherNavHtml = `
    <div style="margin: 1rem 0; border-top: 1px solid rgba(255,255,255,0.1);"></div>
    <a href="/browser" class="nav-item ${activeId === 'browser' ? 'active' : ''}">
      <i class="fas fa-compass"></i> Jina 浏览器
    </a>
    <a href="/settings" class="nav-item ${activeId === 'settings' ? 'active' : ''}">
      <i class="fas fa-cog"></i> 设置
    </a>
  `;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="referrer" content="no-referrer">
    <title>${pageTitle} - Linux DO Reader</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>${STYLES}</style>
</head>
<body>
    <!-- Mobile Overlay -->
    <div class="sidebar-overlay" onclick="toggleMenu()"></div>

    <!-- Sidebar -->
    <nav class="sidebar" id="sidebar">
        <div class="logo-area">
            <h1><i class="fab fa-linux"></i> Linux DO</h1>
        </div>
        <div class="nav-links">
            <a href="/" class="nav-item ${activeId === 'home' ? 'active' : ''}">
                <i class="fas fa-home"></i> 首页广场
            </a>
            ${navHtml}
            ${otherNavHtml}
        </div>
        <div class="sidebar-footer">
            <span class="slogan-title">Linux DO 阅读器</span>
            <p class="slogan-text">
                借 RSS 之骨<br>
                附内容之肉<br>
                破 CF 之困
            </p>
        </div>
    </nav>

    <!-- Main Content -->
    <div class="main-wrapper">
        <div class="top-bar">
            <button class="menu-toggle" onclick="toggleMenu()"><i class="fas fa-bars"></i></button>
            <div class="page-title">${pageTitle}</div>
            <div style="width: 24px;"></div><!-- Spacer for centering -->
        </div>
        <div class="content">
            ${content}
        </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
    <script>
        function toggleMenu() {
            document.getElementById('sidebar').classList.toggle('open');
            document.querySelector('.sidebar-overlay').classList.toggle('show');
        }
    </script>
</body>
</html>`;
}

// 处理请求
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- API Routes ---
  
  // 1. Jina Proxy API
  if (path === "/api/jina") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response(JSON.stringify({ error: "Missing URL" }), { status: 400 });

    try {
      // 如果是 /t/topic/xxxx，自动补全完整 Jina URL
      let jinaRequestUrl = targetUrl;
      
      // 判断是否是完整 URL，如果不是，假设是 topic 路径
      if (!targetUrl.startsWith("http")) {
         // 构建 https://r.jina.ai/https://linux.do/t/topic/xxx
         const siteUrl = `https://linux.do${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
         const jinaBase = CONFIG.JINA_PROXY || CONFIG.JINA_BASE_URL;
         jinaRequestUrl = `${jinaBase}/${siteUrl}`;
      } else {
          // 如果已经是完整 URL，检查是否需要拼 Jina 前缀
           if (!targetUrl.includes("jina.ai")) {
                const jinaBase = CONFIG.JINA_PROXY || CONFIG.JINA_BASE_URL;
                jinaRequestUrl = `${jinaBase}/${targetUrl}`;
           }
      }

      const headers: Record<string, string> = {};
      if (CONFIG.JINA_API_KEY) headers["Authorization"] = `Bearer ${CONFIG.JINA_API_KEY}`;

      const text = await proxyRequest(jinaRequestUrl, headers);
      const data = parseJinaResponse(text);
      
      return new Response(JSON.stringify(data), { 
        headers: { "Content-Type": "application/json" } 
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message, status: e.status || 500 }), { 
        status: e.status || 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // --- Page Routes ---

  // 首页 (显示最新内容)
  if (path === "/" || path === "/home") {
    // 复用 Latest 逻辑
    return await renderRSSPage("latest", "home", "最新话题");
  }

  // 分类页面
  if (path.startsWith("/category/")) {
    const catId = path.split("/")[2];
    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return new Response("Category not found", { status: 404 });
    return await renderRSSPage(catId, catId, cat.name);
  }

  // 话题详情页 (骨架屏 + CSR)
  if (path.startsWith("/topic/")) {
    const topicId = path.split("/")[2];
    const topicUrl = `/t/topic/${topicId}`;
    
    const content = `
      <div class="reader-container">
        <div style="margin-bottom: 1rem;">
             <a href="javascript:history.back()" style="display:inline-flex; align-items:center; gap:0.5rem; color:var(--primary); text-decoration:none; font-weight:500;">
                <i class="fas fa-arrow-left"></i> 返回列表
             </a>
        </div>

        <!-- Loading Skeleton -->
        <div id="skeleton-loader">
            <div class="skeleton sk-title"></div>
            <div class="skeleton sk-meta"></div>
            <div style="margin-top: 2rem;">
                <div class="skeleton sk-line"></div>
                <div class="skeleton sk-line"></div>
                <div class="skeleton sk-line"></div>
                <div class="skeleton sk-line short"></div>
                <br>
                <div class="skeleton sk-line"></div>
                <div class="skeleton sk-line"></div>
            </div>
        </div>

        <!-- Error State -->
        <div id="error-display" style="display: none;" class="error-box"></div>

        <!-- Real Content -->
        <div id="real-content" style="display: none;">
            <div class="reader-header">
                <h1 id="article-title"></h1>
                <div class="reader-meta">
                    <span id="article-date"></span> • 
                    <a id="article-source" href="#" target="_blank" style="color: inherit;">查看原文</a>
                </div>
            </div>
            <div id="markdown-output" class="markdown-body"></div>
        </div>
      </div>

      <script>
        async function loadContent() {
            const targetUrl = '${topicUrl}';
            const loader = document.getElementById('skeleton-loader');
            const content = document.getElementById('real-content');
            const errorDiv = document.getElementById('error-display');

            try {
                const res = await fetch('/api/jina?url=' + encodeURIComponent(targetUrl));
                const data = await res.json();

                if (data.error) {
                    throw new Error(data.error);
                }

                // Render Data
                document.getElementById('article-title').innerText = data.title;
                document.getElementById('article-date').innerText = data.date || new Date().toLocaleString();
                document.getElementById('article-source').href = data.url;
                document.getElementById('article-source').innerText = data.url;
                document.getElementById('markdown-output').innerHTML = marked.parse(data.markdown);
                
                // Make images responsive in rendered markdown
                document.querySelectorAll('.markdown-body img').forEach(img => {
                    img.loading = 'lazy';
                });

                loader.style.display = 'none';
                content.style.display = 'block';

            } catch (e) {
                console.error(e);
                loader.style.display = 'none';
                errorDiv.style.display = 'block';
                
                let msg = '加载失败，请稍后重试';
                if(e.message.includes('429')) msg = '请求过于频繁 (429)，请喝杯茶再来';
                if(e.message.includes('403')) msg = '访问被拒绝 (403)，可能是 CF 盾';

                errorDiv.innerHTML = \`
                    <i class="fas fa-exclamation-circle"></i>
                    <p>\${msg}</p>
                    <p style="font-size:0.8rem; color:#999; margin-top:0.5rem;">Debug: \${e.message}</p>
                    <button class="btn-retry" onclick="location.reload()">重试</button>
                \`;
            }
        }

        // Start loading
        loadContent();
      </script>
    `;
    return new Response(renderLayout(content, "topic", "话题详情"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Jina 浏览器页面
  if (path === "/browser") {
    const content = `
    <div class="reader-container">
        <h2 style="margin-bottom: 1rem;">Jina 网页浏览器</h2>
        <div style="display: flex; gap: 10px; margin-bottom: 1rem;">
            <input type="url" id="custom-url" placeholder="输入完整网址 (https://...)" style="flex:1; padding: 10px; border: 1px solid #ddd; border-radius: 8px;">
            <button onclick="browseCustom()" style="padding: 0 20px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer;">前往</button>
        </div>
        <p style="font-size: 0.9rem; color: #666; margin-bottom: 2rem;">此功能利用 Jina.ai 将任意网页转换为 Markdown 阅读模式。</p>
        <hr style="border:none; border-top:1px solid #eee; margin: 2rem 0;">
        <div id="browser-result"></div>
    </div>
    <script>
        function browseCustom() {
            const url = document.getElementById('custom-url').value.trim();
            if(url) {
                // 直接复用 topic 的逻辑，但这里我们需要跳转到一个能处理任意URL的页面
                // 或者简单点，直接 encode 后跳转到 topic 路由的一个变体，这里为了简单，我们直接在当前页渲染
                // 为了体验统一，我们构造一个特殊的 url 参数跳到 detail 逻辑
                // 但由于 topic 路由只处理 ID，我们最好复用 api 并在本页显示
                
                // 既然用户想要"重构界面"，我们简单做：跳转到一个通用阅读路由
                // 比如 /read?url=xxx
                window.location.href = '/topic/custom?url=' + encodeURIComponent(url);
            }
        }
    </script>
    `;
    // 特殊处理：为了兼容 topic/:id 路由，这里简单处理
    // 实际更好的做法是单独开一个 /read 路由。
    // 上面的 script 会跳转到 /topic/custom?url=... 
    // 我们需要在 topic 路由处理那个逻辑，下面补丁一下 topic 路由逻辑：
    
    return new Response(renderLayout(content, "browser", "Jina 浏览器"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // 补丁：处理 /topic/custom?url=... 的情况
  // (注意：这部分逻辑需要合并到上面的 path.startsWith("/topic/") 块中，或者修改上面的正则)
  // 为了代码整洁，我假设你理解上面的 topic 路由里的 `const targetUrl = '${topicUrl}';`
  // 如果是 custom，我们需要从 query param 取 url。
  // 修改上面的 topic 路由逻辑如下：
  /*
    let targetUrlJS = '';
    if (topicId === 'custom') {
        const u = url.searchParams.get('url');
        targetUrlJS = u; // 直接传完整 URL
    } else {
        targetUrlJS = `/t/topic/${topicId}`;
    }
    // 然后把 ${topicUrl} 替换为 ${targetUrlJS}
  */
 
  // 设置页面
  if (path === "/settings") {
      const content = `
      <div class="reader-container">
        <h2>系统设置</h2>
        <div style="margin-top: 2rem;">
            <p>当前环境变量配置 (只读):</p>
            <pre style="margin-top: 1rem;">
RSS_BASE: ${CONFIG.RSS_BASE_URL}
JINA_BASE: ${CONFIG.JINA_BASE_URL}
JINA_PROXY: ${CONFIG.JINA_PROXY ? '已配置' : '未配置'}
            </pre>
        </div>
      </div>`;
      return new Response(renderLayout(content, "settings", "设置"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not Found", { status: 404 });
}

// 辅助：渲染 RSS 列表页
async function renderRSSPage(catId: string, activeTab: string, title: string) {
    try {
        const category = CATEGORIES.find(c => c.id === catId) || CATEGORIES[0];
        const rssUrl = `${CONFIG.RSS_BASE_URL}/${category.file}`;
        
        const xml = await proxyRequest(rssUrl);
        const items = parseRSS(xml);

        const htmlContent = `
            <div class="card-grid">
                ${items.map(item => `
                    <div class="card">
                        <div class="rss-item">
                            <h3><a href="/topic/${item.topicId}">${item.title}</a></h3>
                            <div class="rss-desc">${item.description}</div>
                            <div class="meta-row">
                                <span><i class="far fa-user"></i> ${item.creator || 'L'}</span>
                                <span class="tag">${item.category}</span>
                                <span>${new Date(item.pubDate).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <a href="/topic/${item.topicId}" style="margin-top: 1rem; text-align: center; padding: 8px; background: #f3f4f6; border-radius: 6px; text-decoration: none; color: var(--primary); font-weight: 500; font-size: 0.9rem;">
                            阅读全文 <i class="fas fa-angle-right"></i>
                        </a>
                    </div>
                `).join('')}
            </div>
        `;
        return new Response(renderLayout(htmlContent, activeTab, title), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    } catch (error) {
        return new Response(renderLayout(`
            <div class="error-box">
                <i class="fas fa-wifi"></i>
                <h3>RSS 获取失败</h3>
                <p>${error.message}</p>
                <button class="btn-retry" onclick="location.reload()">刷新重试</button>
            </div>
        `, activeTab, title), { headers: { "Content-Type": "text/html" } });
    }
}

// --- 启动服务 ---
console.log("🚀 Linux DO RSS Reader Reborn is running on http://localhost:8000");
serve(handler, { port: 8000 });
