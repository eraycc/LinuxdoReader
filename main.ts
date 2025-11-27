// main.ts - Linux DO RSS Reader with Jina.ai Proxy
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// 环境变量配置
const CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_PROXY: Deno.env.get("JINA_PROXY") || "",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
};

// RSS 分类配置（完整版本）
const CATEGORIES = [
  { id: "latest", name: "最新话题", desc: "实时更新的最新讨论", icon: "🆕" },
  { id: "top", name: "热门话题", desc: "社区热门内容", icon: "🔥" },
  { id: "develop", name: "开发调优", desc: "技术开发与优化", icon: "💻" },
  { id: "resource", name: "资源荟萃", desc: "优质资源分享", icon: "📚" },
  { id: "wiki", name: "文档共建", desc: "知识文档协作", icon: "📝" },
  { id: "gossip", name: "搞七捻三", desc: "闲聊杂谈", icon: "💬" },
  { id: "feedback", name: "运营反馈", desc: "社区运营讨论", icon: "📊" },
  { id: "welfare", name: "福利羊毛", desc: "福利活动分享", icon: "🎁" },
  { id: "news", name: "前沿快讯", desc: "技术资讯快报", icon: "📰" },
  { id: "reading", name: "读书成诗", desc: "阅读与文学", icon: "📖" },
  { id: "trade", name: "跳蚤市场", desc: "二手交易", icon: "🛒" },
  { id: "job", name: "非我莫属", desc: "求职招聘", icon: "💼" },
  { id: "startup", name: "扬帆起航", desc: "创业分享", icon: "⛵" },
  { id: "feeds", name: "网络记忆", desc: "网络存档", icon: "🗂️" },
  { id: "muted", name: "深海幽域", desc: "隐藏内容", icon: "🌊" },
];

// 代理请求函数（带错误处理）
async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...headers,
      },
    });
    
    // 处理 HTTP 错误状态码
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("请求过于频繁，请稍后再试 (429 Too Many Requests)");
      } else if (response.status === 403) {
        throw new Error("访问被拒绝，请检查权限或代理设置 (403 Forbidden)");
      } else if (response.status === 404) {
        throw new Error("请求的资源不存在 (404 Not Found)");
      } else if (response.status === 500) {
        throw new Error("服务器内部错误 (500 Internal Server Error)");
      } else if (response.status === 503) {
        throw new Error("服务暂时不可用，请稍后重试 (503 Service Unavailable)");
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
    
    return await response.text();
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error("网络连接失败，请检查网络或代理设置");
    }
    throw error;
  }
}

// 解析 RSS XML
function parseRSS(xml: string) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];
    const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
    const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/);
    const dateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const creatorMatch = itemContent.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/);
    const categoryMatch = itemContent.match(/<category>([\s\S]*?)<\/category>/);
    
    if (titleMatch && linkMatch) {
      // 清理描述内容
      let description = descMatch ? descMatch[1].trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") : "";
      
      // 提取纯文本描述（移除 small 和 Read full topic 链接）
      description = description
        .replace(/<p><small>.*?<\/small><\/p>/g, "")
        .replace(/<p><a href=".*?">Read full topic<\/a><\/p>/g, "")
        .trim();
      
      items.push({
        title: titleMatch[1].trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1"),
        link: linkMatch[1].trim(),
        description: description,
        pubDate: dateMatch ? dateMatch[1].trim() : new Date().toISOString(),
        creator: creatorMatch ? creatorMatch[1].trim() : "",
        category: categoryMatch ? categoryMatch[1].trim() : "",
      });
    }
  }
  
  return items;
}

// 解析 Jina.ai 响应
function parseJinaResponse(content: string) {
  const titleMatch = content.match(/Title: (.+)/);
  const urlMatch = content.match(/URL Source: (.+)/);
  const markdownStart = content.indexOf("Markdown Content:");
  
  let markdownContent = "";
  if (markdownStart !== -1) {
    markdownContent = content.substring(markdownStart + 17).trim();
  }
  
  return {
    title: titleMatch ? titleMatch[1].trim() : "无标题",
    url: urlMatch ? urlMatch[1].trim() : "",
    markdown: markdownContent,
  };
}

// 渲染 HTML 页面
function renderHTML(title: string, content: string, activeTab = "home") {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer">
    <title>${title} - Linux DO Reader</title>
    
    <!-- Styles -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.6.1/github-markdown.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --secondary: #f8fafc;
            --text: #1e293b;
            --text-light: #64748b;
            --border: #e2e8f0;
            --card-bg: #ffffff;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            --sidebar-width: 280px;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--text);
            line-height: 1.6;
            overflow-x: hidden;
        }
        
        /* 侧边栏样式 */
        .sidebar-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 998;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .sidebar-overlay.active {
            display: block;
            opacity: 1;
        }
        
        .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            width: var(--sidebar-width);
            height: 100vh;
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(10px);
            box-shadow: var(--shadow-lg);
            z-index: 999;
            overflow-y: auto;
            transition: transform 0.3s ease;
            display: flex;
            flex-direction: column;
        }
        
        .sidebar-header {
            padding: 2rem 1.5rem;
            border-bottom: 1px solid var(--border);
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }
        
        .sidebar-header h1 {
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .sidebar-header p {
            font-size: 0.85rem;
            opacity: 0.9;
            line-height: 1.4;
        }
        
        .sidebar-nav {
            flex: 1;
            padding: 1rem 0;
        }
        
        .nav-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.875rem 1.5rem;
            color: var(--text);
            text-decoration: none;
            transition: all 0.2s ease;
            cursor: pointer;
            border-left: 3px solid transparent;
        }
        
        .nav-item:hover {
            background: var(--secondary);
            border-left-color: var(--primary);
        }
        
        .nav-item.active {
            background: var(--secondary);
            color: var(--primary);
            border-left-color: var(--primary);
            font-weight: 500;
        }
        
        .nav-item i {
            width: 20px;
            text-align: center;
        }
        
        .mobile-toggle {
            display: none;
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 1000;
            background: rgba(255, 255, 255, 0.95);
            border: none;
            border-radius: 12px;
            padding: 0.75rem 1rem;
            box-shadow: var(--shadow-lg);
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .mobile-toggle:hover {
            transform: scale(1.05);
        }
        
        .mobile-toggle i {
            font-size: 1.25rem;
            color: var(--primary);
        }
        
        /* 主内容区 */
        .app-container {
            margin-left: var(--sidebar-width);
            padding: 20px;
            min-height: 100vh;
            transition: margin-left 0.3s ease;
        }
        
        .content-wrapper {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        /* Tab 内容 */
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
            animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        /* 分类网格 */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        /* 卡片样式 */
        .card {
            background: var(--card-bg);
            border-radius: 16px;
            padding: 1.5rem;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
            border: 1px solid var(--border);
            overflow: hidden;
        }
        
        .card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
        }
        
        .card h3 {
            color: var(--text);
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
            line-height: 1.4;
        }
        
        .card p {
            color: var(--text-light);
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }
        
        .card .description {
            background: var(--secondary);
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
            font-size: 0.9rem;
            line-height: 1.6;
            max-height: 150px;
            overflow: hidden;
            position: relative;
        }
        
        .card .description * {
            margin: 0.5rem 0;
        }
        
        .card .description a {
            color: var(--primary);
            text-decoration: none;
            font-weight: 500;
        }
        
        .card .description a:hover {
            text-decoration: underline;
        }
        
        .card .description::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 40px;
            background: linear-gradient(transparent, var(--secondary));
        }
        
        .card .meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.8rem;
            color: var(--text-light);
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid var(--border);
            flex-wrap: wrap;
            gap: 0.5rem;
        }
        
        /* 按钮样式 */
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: var(--primary);
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            text-decoration: none;
            border: none;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9rem;
            justify-content: center;
        }
        
        .btn:hover {
            background: var(--primary-dark);
            transform: translateY(-1px);
        }
        
        .btn-outline {
            background: transparent;
            border: 1px solid var(--primary);
            color: var(--primary);
        }
        
        .btn-outline:hover {
            background: var(--primary);
            color: white;
        }
        
        /* 内容区域 */
        .content-area {
            background: var(--card-bg);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: var(--shadow-lg);
            margin-bottom: 2rem;
        }
        
        /* Jina 浏览器 */
        .jina-browser {
            background: var(--secondary);
            padding: 1.5rem;
            border-radius: 12px;
            margin-bottom: 2rem;
        }
        
        .url-input {
            width: 100%;
            padding: 1rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 1rem;
            margin-bottom: 1rem;
        }
        
        /* 设置面板 */
        .settings-panel {
            background: var(--secondary);
            padding: 1.5rem;
            border-radius: 12px;
            margin-bottom: 2rem;
        }
        
        .form-group {
            margin-bottom: 1rem;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
            color: var(--text);
        }
        
        .form-control {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 0.9rem;
        }
        
        /* Markdown 渲染 */
        .markdown-body {
            background: transparent !important;
            max-width: 100% !important;
            overflow-wrap: break-word !important;
            word-wrap: break-word !important;
        }
        
        .markdown-body * {
            max-width: 100% !important;
            box-sizing: border-box !important;
        }
        
        .markdown-body img {
            max-width: 100% !important;
            height: auto !important;
            border-radius: 8px;
        }
        
        .markdown-body table {
            display: block;
            overflow-x: auto;
            white-space: nowrap;
        }
        
        .markdown-body a {
            color: var(--primary);
            text-decoration: none;
        }
        
        .markdown-body a:hover {
            text-decoration: underline;
        }
        
        /* 骨架屏加载 */
        .skeleton-loader {
            padding: 2rem;
        }
        
        .skeleton-item {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: loading 1.5s ease-in-out infinite;
            border-radius: 8px;
            margin-bottom: 1rem;
        }
        
        .skeleton-title {
            height: 32px;
            width: 70%;
            margin-bottom: 1rem;
        }
        
        .skeleton-text {
            height: 16px;
            width: 100%;
            margin-bottom: 0.5rem;
        }
        
        .skeleton-text:last-child {
            width: 60%;
        }
        
        @keyframes loading {
            0% {
                background-position: 200% 0;
            }
            100% {
                background-position: -200% 0;
            }
        }
        
        /* 加载和错误状态 */
        .loading {
            text-align: center;
            padding: 2rem;
            color: var(--text-light);
        }
        
        .error {
            background: #fee2e2;
            color: #dc2626;
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
        }
        
        .error h3 {
            margin-bottom: 0.5rem;
        }
        
        /* 页脚 */
        .footer {
            text-align: center;
            padding: 2rem;
            color: rgba(255, 255, 255, 0.8);
            font-size: 0.9rem;
        }
        
        /* 响应式设计 */
        @media (max-width: 768px) {
            .sidebar {
                transform: translateX(-100%);
            }
            
            .sidebar.active {
                transform: translateX(0);
            }
            
            .mobile-toggle {
                display: block;
            }
            
            .app-container {
                margin-left: 0;
                padding: 70px 10px 10px 10px;
            }
            
            .grid {
                grid-template-columns: 1fr;
            }
            
            .content-area {
                padding: 1rem;
            }
            
            .card .description {
                max-height: 120px;
            }
        }
        
        @media (min-width: 769px) {
            .sidebar-overlay {
                display: none !important;
            }
        }
    </style>
</head>
<body>
    <!-- 移动端菜单按钮 -->
    <button class="mobile-toggle" onclick="toggleSidebar()">
        <i class="fas fa-bars"></i>
    </button>
    
    <!-- 侧边栏遮罩 -->
    <div class="sidebar-overlay" onclick="toggleSidebar()"></div>
    
    <!-- 侧边栏 -->
    <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
            <h1><i class="fas fa-rss"></i> Linux DO 阅读器</h1>
            <p>借 RSS 之骨，附内容之肉，破 CF 之困</p>
        </div>
        
        <nav class="sidebar-nav">
            <a class="nav-item ${activeTab === 'home' ? 'active' : ''}" onclick="switchTab('home', event)">
                <i class="fas fa-home"></i>
                <span>首页</span>
            </a>
            <a class="nav-item ${activeTab === 'browser' ? 'active' : ''}" onclick="switchTab('browser', event)">
                <i class="fas fa-compass"></i>
                <span>Jina 浏览器</span>
            </a>
            <a class="nav-item ${activeTab === 'settings' ? 'active' : ''}" onclick="switchTab('settings', event)">
                <i class="fas fa-cog"></i>
                <span>设置</span>
            </a>
        </nav>
    </aside>
    
    <!-- 主内容区 -->
    <div class="app-container">
        <div class="content-wrapper">
            ${content}
            
            <div class="footer">
                <p>数据来源: linuxdorss.longpink.com • 内容渲染: r.jina.ai</p>
                <p>「曲线救国终不美，然此路可通」</p>
            </div>
        </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
    <script>
        // 侧边栏切换
        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.querySelector('.sidebar-overlay');
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        }
        
        // Tab 切换
        function switchTab(tabName, event) {
            if (event) {
                event.preventDefault();
            }
            
            // 更新侧边栏导航状态
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            event?.target.closest('.nav-item')?.classList.add('active');
            
            // 更新内容区域
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            const targetTab = document.getElementById(tabName + '-tab');
            if (targetTab) {
                targetTab.classList.add('active');
            }
            
            // 保存当前 tab 状态
            localStorage.setItem('activeTab', tabName);
            
            // 移动端自动关闭侧边栏
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        }
        
        // 页面加载时恢复 tab 状态
        window.addEventListener('DOMContentLoaded', function() {
            const savedTab = localStorage.getItem('activeTab');
            if (savedTab && savedTab !== '${activeTab}') {
                const navItem = document.querySelector(\`.nav-item[onclick*="'\${savedTab}'"]\`);
                if (navItem) {
                    navItem.click();
                }
            }
            
            loadSettings();
        });
        
        // 设置保存
        function saveSettings() {
            const settings = {
                jinaProxy: document.getElementById('jinaProxy').value,
                jinaApiKey: document.getElementById('jinaApiKey').value,
                rssBaseUrl: document.getElementById('rssBaseUrl').value
            };
            localStorage.setItem('appSettings', JSON.stringify(settings));
            alert('设置已保存！');
        }
        
        // 加载设置
        function loadSettings() {
            const saved = localStorage.getItem('appSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                const jinaProxyInput = document.getElementById('jinaProxy');
                const jinaApiKeyInput = document.getElementById('jinaApiKey');
                const rssBaseUrlInput = document.getElementById('rssBaseUrl');
                
                if (jinaProxyInput) jinaProxyInput.value = settings.jinaProxy || '';
                if (jinaApiKeyInput) jinaApiKeyInput.value = settings.jinaApiKey || '';
                if (rssBaseUrlInput) rssBaseUrlInput.value = settings.rssBaseUrl || '';
            }
        }
        
        // Jina 浏览器功能
        async function fetchWithJina() {
            const urlInput = document.getElementById('jinaUrl');
            const resultDiv = document.getElementById('jinaResult');
            const loadingDiv = document.getElementById('jinaLoading');
            
            if (!urlInput.value.trim()) {
                alert('请输入要获取的网址');
                return;
            }
            
            const settings = JSON.parse(localStorage.getItem('appSettings') || '{}');
            const jinaProxy = settings.jinaProxy || '${CONFIG.JINA_PROXY}';
            const jinaBase = jinaProxy ? jinaProxy : '${CONFIG.JINA_BASE_URL}';
            const targetUrl = encodeURIComponent(urlInput.value.trim());
            const jinaUrl = \`\${jinaBase}/\${targetUrl}\`;
            
            // 显示骨架屏
            loadingDiv.style.display = 'block';
            resultDiv.innerHTML = '';
            
            try {
                const response = await fetch(\`/api/jina?url=\${encodeURIComponent(jinaUrl)}\`);
                const data = await response.json();
                
                loadingDiv.style.display = 'none';
                
                if (data.error) {
                    resultDiv.innerHTML = \`<div class="error">
                        <h3><i class="fas fa-exclamation-triangle"></i> 错误</h3>
                        <p>\${data.error}</p>
                    </div>\`;
                } else {
                    const mdContent = \`
                        <div class="content-area">
                            <h2>\${data.title}</h2>
                            <p style="color: var(--text-light); margin-bottom: 2rem;">
                                <i class="fas fa-link"></i> 来源: <a href="\${data.url}" target="_blank">\${data.url}</a>
                            </p>
                            <div class="markdown-body" id="markdown-content"></div>
                            <textarea id="markdown-text" style="display:none">\${data.markdown}</textarea>
                        </div>
                    \`;
                    resultDiv.innerHTML = mdContent;
                    
                    // 渲染 Markdown
                    const markdownText = document.getElementById('markdown-text').value;
                    const markdownContent = document.getElementById('markdown-content');
                    markdownContent.innerHTML = marked.parse(markdownText);
                }
            } catch (error) {
                loadingDiv.style.display = 'none';
                resultDiv.innerHTML = \`<div class="error">
                    <h3><i class="fas fa-exclamation-triangle"></i> 请求失败</h3>
                    <p>\${error.message}</p>
                </div>\`;
            }
        }
        
        // 回车键触发 Jina 获取
        document.addEventListener('DOMContentLoaded', function() {
            const urlInput = document.getElementById('jinaUrl');
            if (urlInput) {
                urlInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        fetchWithJina();
                    }
                });
            }
        });
        
        // 点击内容区域外关闭移动端侧边栏
        document.addEventListener('click', function(e) {
            if (window.innerWidth <= 768) {
                const sidebar = document.getElementById('sidebar');
                const toggle = document.querySelector('.mobile-toggle');
                
                if (!sidebar.contains(e.target) && !toggle.contains(e.target) && sidebar.classList.contains('active')) {
                    toggleSidebar();
                }
            }
        });
    </script>
</body>
</html>`;
}

// 处理请求
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  try {
    // API 路由
    if (path.startsWith("/api/")) {
      if (path === "/api/rss") {
        const category = url.searchParams.get("category") || "latest";
        const rssUrl = `${CONFIG.RSS_BASE_URL}/${category}.xml`;
        
        try {
          const xml = await proxyRequest(rssUrl);
          const items = parseRSS(xml);
          return new Response(JSON.stringify({ success: true, items }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: error.message 
          }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      
      if (path === "/api/jina") {
        const jinaUrl = url.searchParams.get("url");
        if (!jinaUrl) {
          return new Response(JSON.stringify({ error: "缺少 URL 参数" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        
        const headers: Record<string, string> = {};
        if (CONFIG.JINA_API_KEY) {
          headers["Authorization"] = `Bearer ${CONFIG.JINA_API_KEY}`;
        }
        
        try {
          const content = await proxyRequest(jinaUrl, headers);
          const parsed = parseJinaResponse(content);
          
          return new Response(JSON.stringify(parsed), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            error: error.message 
          }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      
      return new Response(JSON.stringify({ error: "API 不存在" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    // 页面路由
    if (path === "/" || path === "/home") {
      const content = `
        <div id="home-tab" class="tab-content active">
          <div class="grid">
            ${CATEGORIES.map(cat => `
              <div class="card">
                <h3>${cat.icon} ${cat.name}</h3>
                <p>${cat.desc}</p>
                <a href="/category/${cat.id}" class="btn">
                  <i class="fas fa-eye"></i> 浏览话题
                </a>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div id="browser-tab" class="tab-content">
          <div class="jina-browser">
            <h3><i class="fas fa-compass"></i> Jina 网页浏览器</h3>
            <p>输入任意网址，使用 Jina.ai 获取并渲染内容</p>
            <input type="url" id="jinaUrl" class="url-input" placeholder="https://example.com" value="https://linux.do">
            <button class="btn" onclick="fetchWithJina()">
              <i class="fas fa-download"></i> 获取内容
            </button>
          </div>
          
          <div id="jinaLoading" class="skeleton-loader" style="display: none;">
            <div class="skeleton-item skeleton-title"></div>
            <div class="skeleton-item skeleton-text"></div>
            <div class="skeleton-item skeleton-text"></div>
            <div class="skeleton-item skeleton-text"></div>
            <div class="skeleton-item skeleton-text"></div>
          </div>
          
          <div id="jinaResult"></div>
        </div>
        
        <div id="settings-tab" class="tab-content">
          <div class="settings-panel">
            <h3><i class="fas fa-cog"></i> 系统设置</h3>
            
            <div class="form-group">
              <label for="rssBaseUrl">RSS 基础地址</label>
              <input type="url" id="rssBaseUrl" class="form-control" value="${CONFIG.RSS_BASE_URL}">
            </div>
            
            <div class="form-group">
              <label for="jinaProxy">Jina 代理地址 (可选)</label>
              <input type="url" id="jinaProxy" class="form-control" placeholder="https://your-jina-proxy.com" value="${CONFIG.JINA_PROXY}">
            </div>
            
            <div class="form-group">
              <label for="jinaApiKey">Jina API Key (可选)</label>
              <input type="text" id="jinaApiKey" class="form-control" placeholder="输入 Jina.ai API Key" value="${CONFIG.JINA_API_KEY}">
            </div>
            
            <button class="btn" onclick="saveSettings()">
              <i class="fas fa-save"></i> 保存设置
            </button>
          </div>
        </div>
      `;
      
      return new Response(renderHTML("Linux DO 阅读器", content, "home"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    
    // 分类页面
    if (path.startsWith("/category/")) {
      const category = path.split("/")[2];
      const categoryInfo = CATEGORIES.find(cat => cat.id === category) || CATEGORIES[0];
      
      try {
        // 获取 RSS 数据
        const rssUrl = `${CONFIG.RSS_BASE_URL}/${category}.xml`;
        const xml = await proxyRequest(rssUrl);
        const items = parseRSS(xml);
        
        const content = `
          <div class="content-area">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem;">
              <h2>${categoryInfo.icon} ${categoryInfo.name}</h2>
              <a href="/" class="btn btn-outline">
                <i class="fas fa-arrow-left"></i> 返回首页
              </a>
            </div>
            
            <div class="grid">
              ${items.map(item => `
                <div class="card">
                  <h3>${item.title}</h3>
                  <div class="description">${item.description}</div>
                  <div class="meta">
                    <span><i class="fas fa-calendar"></i> ${new Date(item.pubDate).toLocaleDateString('zh-CN')}</span>
                    <span><i class="fas fa-user"></i> ${item.creator || '匿名'}</span>
                  </div>
                  <a href="/topic/${item.link.split('/').pop()}" class="btn" style="margin-top: 1rem; width: 100%;">
                    <i class="fas fa-book-open"></i> 阅读全文
                  </a>
                </div>
              `).join('')}
            </div>
          </div>
        `;
        
        return new Response(renderHTML(`${categoryInfo.name} - Linux DO`, content, "home"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (error) {
        const content = `
          <div class="content-area">
            <div class="error">
              <h3><i class="fas fa-exclamation-triangle"></i> 加载失败</h3>
              <p>${error.message}</p>
              <a href="/" class="btn" style="margin-top: 1rem;">
                <i class="fas fa-home"></i> 返回首页
              </a>
            </div>
          </div>
        `;
        
        return new Response(renderHTML("错误", content, "home"), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }
    
    // 话题详情页（骨架屏 + 动态加载）
    if (path.startsWith("/topic/")) {
      const topicId = path.split("/")[2];
      
      const content = `
        <div class="content-area">
          <a href="javascript:window.history.back()" class="btn btn-outline" style="margin-bottom: 1rem;">
            <i class="fas fa-arrow-left"></i> 返回
          </a>
          
          <div id="topic-skeleton" class="skeleton-loader">
            <div class="skeleton-item skeleton-title"></div>
            <div class="skeleton-item skeleton-text"></div>
            <div class="skeleton-item skeleton-text"></div>
            <div class="skeleton-item skeleton-text"></div>
            <div class="skeleton-item skeleton-text"></div>
            <div class="skeleton-item skeleton-text"></div>
          </div>
          
          <div id="topic-content" style="display: none;">
            <h1 id="topic-title"></h1>
            <p id="topic-url" style="color: var(--text-light); margin-bottom: 2rem;"></p>
            <div class="markdown-body" id="markdown-content"></div>
          </div>
          
          <div id="topic-error" style="display: none;"></div>
        </div>
        
        <script>
          (async function() {
            const topicId = '${topicId}';
            const targetUrl = \`https://linux.do/t/topic/\${topicId}\`;
            
            const skeleton = document.getElementById('topic-skeleton');
            const content = document.getElementById('topic-content');
            const errorDiv = document.getElementById('topic-error');
            
            try {
              const settings = JSON.parse(localStorage.getItem('appSettings') || '{}');
              const jinaProxy = settings.jinaProxy || '${CONFIG.JINA_PROXY}';
              const jinaBase = jinaProxy ? jinaProxy : '${CONFIG.JINA_BASE_URL}';
              const jinaUrl = \`\${jinaBase}/\${targetUrl}\`;
              
              const response = await fetch(\`/api/jina?url=\${encodeURIComponent(jinaUrl)}\`);
              const data = await response.json();
              
              skeleton.style.display = 'none';
              
              if (data.error) {
                errorDiv.innerHTML = \`<div class="error">
                  <h3><i class="fas fa-exclamation-triangle"></i> 加载失败</h3>
                  <p>\${data.error}</p>
                  <a href="javascript:window.history.back()" class="btn" style="margin-top: 1rem;">
                    <i class="fas fa-arrow-left"></i> 返回
                  </a>
                </div>\`;
                errorDiv.style.display = 'block';
              } else {
                document.getElementById('topic-title').textContent = data.title;
                document.getElementById('topic-url').innerHTML = 
                  \`<i class="fas fa-link"></i> 来源: <a href="\${data.url}" target="_blank">\${data.url}</a>\`;
                
                const markdownContent = document.getElementById('markdown-content');
                markdownContent.innerHTML = marked.parse(data.markdown);
                
                content.style.display = 'block';
              }
            } catch (error) {
              skeleton.style.display = 'none';
              errorDiv.innerHTML = \`<div class="error">
                <h3><i class="fas fa-exclamation-triangle"></i> 加载失败</h3>
                <p>\${error.message}</p>
                <a href="javascript:window.history.back()" class="btn" style="margin-top: 1rem;">
                  <i class="fas fa-arrow-left"></i> 返回
                </a>
              </div>\`;
              errorDiv.style.display = 'block';
            }
          })();
        </script>
      `;
      
      return new Response(renderHTML("加载中...", content, "home"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    
    // 404 页面
    return new Response(renderHTML("页面不存在", `
      <div class="content-area" style="text-align: center; padding: 4rem 2rem;">
        <h1 style="font-size: 4rem; margin-bottom: 1rem;">404</h1>
        <p style="font-size: 1.2rem; margin-bottom: 2rem; color: var(--text-light);">
          您访问的页面不存在
        </p>
        <a href="/" class="btn">
          <i class="fas fa-home"></i> 返回首页
        </a>
      </div>
    `, "home"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    
  } catch (error) {
    console.error("Handler error:", error);
    return new Response(renderHTML("错误", `
      <div class="content-area">
        <div class="error">
          <h3><i class="fas fa-exclamation-triangle"></i> 发生错误</h3>
          <p>${error.message}</p>
          <a href="/" class="btn" style="margin-top: 1rem;">
            <i class="fas fa-home"></i> 返回首页
          </a>
        </div>
      </div>
    `, "home"), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

// 启动服务器
console.log("🚀 Linux DO RSS Reader 服务已启动");
console.log("📍 访问地址: http://localhost:8000");
console.log("📖 RSS 源:", CONFIG.RSS_BASE_URL);
console.log("🔗 Jina 服务:", CONFIG.JINA_BASE_URL);

serve(handler, { port: 8000 });
