// main.ts - Linux DO RSS Reader with Jina.ai Proxy
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// 环境变量配置
const CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_PROXY: Deno.env.get("JINA_PROXY") || "",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
};

// RSS 分类配置
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
];

// 代理请求函数
async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error("Proxy request failed:", error);
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
      items.push({
        title: titleMatch[1].trim().replace(/<\!\[CDATA\[(.*?)\]\]>/g, "$1"),
        link: linkMatch[1].trim(),
        description: descMatch ? 
          descMatch[1].trim().replace(/<\!\[CDATA\[(.*?)\]\]>/g, "$1") : "",
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
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: var(--text);
            line-height: 1.6;
        }
        
        .app-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            min-height: 100vh;
        }
        
        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: var(--shadow-lg);
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .header h1 {
            font-size: 2.5rem;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        
        .header p {
            color: var(--text-light);
            font-size: 1.1rem;
        }
        
        .nav-tabs {
            display: flex;
            background: var(--card-bg);
            border-radius: 12px;
            padding: 0.5rem;
            margin-bottom: 2rem;
            box-shadow: var(--shadow);
            overflow-x: auto;
        }
        
        .nav-tab {
            flex: 1;
            padding: 0.75rem 1rem;
            text-align: center;
            border: none;
            background: transparent;
            color: var(--text-light);
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.3s ease;
            white-space: nowrap;
            min-width: 120px;
        }
        
        .nav-tab:hover {
            background: var(--secondary);
            color: var(--text);
        }
        
        .nav-tab.active {
            background: var(--primary);
            color: white;
            box-shadow: var(--shadow);
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
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
            line-height: 1.5;
            max-height: 120px;
            overflow: hidden;
            position: relative;
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
        
        .card .description a {
            color: var(--primary);
            text-decoration: none;
        }
        
        .card .description a:hover {
            text-decoration: underline;
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
        }
        
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
        
        .content-area {
            background: var(--card-bg);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: var(--shadow-lg);
            margin-bottom: 2rem;
        }
        
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
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: rgba(255, 255, 255, 0.8);
            font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
            .app-container {
                padding: 10px;
            }
            
            .header {
                padding: 1.5rem;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .grid {
                grid-template-columns: 1fr;
            }
            
            .nav-tabs {
                flex-direction: column;
                gap: 0.5rem;
            }
            
            .content-area {
                padding: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="app-container">
        <div class="header">
            <h1><i class="fas fa-rss"></i> Linux DO 阅读器</h1>
            <p>借 RSS 之骨，附内容之肉，破 CF 之困</p>
        </div>
        
        <div class="nav-tabs">
            <button class="nav-tab ${activeTab === 'home' ? 'active' : ''}" onclick="switchTab('home')">
                <i class="fas fa-home"></i> 首页
            </button>
            <button class="nav-tab ${activeTab === 'browser' ? 'active' : ''}" onclick="switchTab('browser')">
                <i class="fas fa-compass"></i> Jina 浏览器
            </button>
            <button class="nav-tab ${activeTab === 'settings' ? 'active' : ''}" onclick="switchTab('settings')">
                <i class="fas fa-cog"></i> 设置
            </button>
        </div>
        
        ${content}
        
        <div class="footer">
            <p>数据来源: linuxdorss.longpink.com • 内容渲染: r.jina.ai</p>
            <p>「曲线救国终不美，然此路可通」</p>
        </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
    <script>
        // Tab 切换
        function switchTab(tabName) {
            document.querySelectorAll('.nav-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            event.target.classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
            
            // 保存当前 tab 状态
            localStorage.setItem('activeTab', tabName);
        }
        
        // 加载保存的 tab 状态
        const savedTab = localStorage.getItem('activeTab') || 'home';
        if (savedTab !== '${activeTab}') {
            switchTab(savedTab);
        }
        
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
                document.getElementById('jinaProxy').value = settings.jinaProxy || '';
                document.getElementById('jinaApiKey').value = settings.jinaApiKey || '';
                document.getElementById('rssBaseUrl').value = settings.rssBaseUrl || '';
            }
        }
        
        // Jina 浏览器功能
        async function fetchWithJina() {
            const urlInput = document.getElementById('jinaUrl');
            const resultDiv = document.getElementById('jinaResult');
            const loadingDiv = document.getElementById('jinaLoading');
            const contentDiv = document.getElementById('jinaContent');
            
            if (!urlInput.value.trim()) {
                alert('请输入要获取的网址');
                return;
            }
            
            const settings = JSON.parse(localStorage.getItem('appSettings') || '{}');
            const jinaProxy = settings.jinaProxy || '${CONFIG.JINA_PROXY}';
            const jinaBase = jinaProxy ? jinaProxy : '${CONFIG.JINA_BASE_URL}';
            const targetUrl = encodeURIComponent(urlInput.value.trim());
            const jinaUrl = \`\${jinaBase}/\${targetUrl}\`;
            
            loadingDiv.style.display = 'block';
            contentDiv.style.display = 'none';
            resultDiv.innerHTML = '';
            
            try {
                const response = await fetch(\`/api/jina?url=\${encodeURIComponent(jinaUrl)}\`);
                const data = await response.json();
                
                if (data.error) {
                    resultDiv.innerHTML = \`<div class="error">错误: \${data.error}</div>\`;
                } else {
                    const mdContent = \`
                        <div class="content-area">
                            <h2>\${data.title}</h2>
                            <p><small>来源: <a href="\${data.url}" target="_blank">\${data.url}</a></small></p>
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
                resultDiv.innerHTML = \`<div class="error">请求失败: \${error.message}</div>\`;
            } finally {
                loadingDiv.style.display = 'none';
                contentDiv.style.display = 'block';
            }
        }
        
        // 页面加载时初始化
        document.addEventListener('DOMContentLoaded', function() {
            loadSettings();
            
            // 为所有描述内容链接美化
            document.querySelectorAll('.description a').forEach(link => {
                link.style.textDecoration = 'none';
                link.style.color = 'var(--primary)';
                link.style.fontWeight = '500';
            });
        });
        
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
        const xml = await proxyRequest(rssUrl);
        const items = parseRSS(xml);
        return new Response(JSON.stringify({ success: true, items }), {
          headers: { "Content-Type": "application/json" },
        });
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
        
        const content = await proxyRequest(jinaUrl, headers);
        const parsed = parseJinaResponse(content);
        
        return new Response(JSON.stringify(parsed), {
          headers: { "Content-Type": "application/json" },
        });
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
          
          <div id="jinaLoading" class="loading" style="display: none;">
            <i class="fas fa-spinner fa-spin"></i> 正在获取内容...
          </div>
          
          <div id="jinaContent">
            <div id="jinaResult"></div>
          </div>
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
      
      // 获取 RSS 数据
      const rssUrl = `${CONFIG.RSS_BASE_URL}/${category}.xml`;
      const xml = await proxyRequest(rssUrl);
      const items = parseRSS(xml);
      
      const content = `
        <div class="content-area">
          <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 2rem;">
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
                  <span>${new Date(item.pubDate).toLocaleDateString('zh-CN')}</span>
                  <span>${item.creator || '匿名'}</span>
                </div>
                <a href="/topic/${item.link.split('/').pop()}" class="btn" style="margin-top: 1rem;">
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
    }
    
    // 话题详情页
    if (path.startsWith("/topic/")) {
      const topicId = path.split("/")[2];
      const targetUrl = `https://linux.do/t/topic/${topicId}`;
      
      // 构建 Jina.ai URL
      const jinaProxy = CONFIG.JINA_PROXY;
      const jinaBase = jinaProxy ? jinaProxy : CONFIG.JINA_BASE_URL;
      const jinaUrl = `${jinaBase}/${targetUrl}`;
      
      const headers: Record<string, string> = {};
      if (CONFIG.JINA_API_KEY) {
        headers["Authorization"] = `Bearer ${CONFIG.JINA_API_KEY}`;
      }
      
      const jinaContent = await proxyRequest(jinaUrl, headers);
      const parsed = parseJinaResponse(jinaContent);
      
      const content = `
        <div class="content-area">
          <a href="javascript:history.back()" class="btn btn-outline" style="margin-bottom: 1rem;">
            <i class="fas fa-arrow-left"></i> 返回
          </a>
          
          <h1>${parsed.title}</h1>
          <p style="color: var(--text-light); margin-bottom: 2rem;">
            <i class="fas fa-link"></i> 来源: <a href="${parsed.url}" target="_blank">${parsed.url}</a>
          </p>
          
          <div class="markdown-body" id="markdown-content"></div>
          <textarea id="markdown-text" style="display:none">${parsed.markdown}</textarea>
        </div>
        
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            const markdownText = document.getElementById('markdown-text').value;
            const markdownContent = document.getElementById('markdown-content');
            markdownContent.innerHTML = marked.parse(markdownText);
          });
        </script>
      `;
      
      return new Response(renderHTML(parsed.title, content, "home"), {
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
    `), {
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
    `), {
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
