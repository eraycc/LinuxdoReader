// main.ts - Linux DO RSS Reader with Jina.ai Proxy (优化版)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// 环境变量配置
const CONFIG = {
  RSS_BASE_URL: Deno.env.get("RSS_BASE_URL") || "https://linuxdorss.longpink.com",
  JINA_BASE_URL: Deno.env.get("JINA_BASE_URL") || "https://r.jina.ai",
  JINA_PROXY: Deno.env.get("JINA_PROXY") || "",
  JINA_API_KEY: Deno.env.get("JINA_API_KEY") || "",
};

// RSS 分类配置 - 完整列表
const CATEGORIES = [
  { id: "latest", name: "最新话题", desc: "实时更新的最新讨论", icon: "🆕" },
  { id: "top", name: "热门话题", desc: "社区热门内容", icon: "🔥" },
  { id: "develop", name: "开发调优", desc: "技术开发与优化", icon: "💻" },
  { id: "domestic", name: "国产替代", desc: "汇聚中国智造", icon: "🇨🇳" },
  { id: "resource", name: "资源荟萃", desc: "优质资源分享", icon: "📚" },
  { id: "cloud-asset", name: "网盘资源", desc: "网盘资源专区", icon: "☁️" },
  { id: "wiki", name: "文档共建", desc: "知识文档协作", icon: "📝" },
  { id: "trade", name: "跳蚤市场", desc: "二手交易平台", icon: "🛒" },
  { id: "job", name: "非我莫属", desc: "招聘求职信息", icon: "💼" },
  { id: "reading", name: "读书成诗", desc: "阅读与文学", icon: "📖" },
  { id: "startup", name: "扬帆起航", desc: "创业与项目", icon: "🚀" },
  { id: "news", name: "前沿快讯", desc: "技术资讯快报", icon: "📰" },
  { id: "feeds", name: "网络记忆", desc: "网络存档记忆", icon: "🗄️" },
  { id: "welfare", name: "福利羊毛", desc: "福利活动分享", icon: "🎁" },
  { id: "gossip", name: "搞七捻三", desc: "闲聊杂谈", icon: "💬" },
  { id: "feedback", name: "运营反馈", desc: "社区运营讨论", icon: "📊" },
  { id: "muted", name: "深海幽域", desc: "静默区域", icon: "🌊" },
];

// Jina 错误信息映射
const JINA_ERROR_MESSAGES: Record<number, string> = {
  429: "请求过于频繁，请稍后再试。Jina.ai 有速率限制，建议配置 API Key 以获得更高配额。",
  403: "访问被拒绝。目标网站可能禁止了爬虫访问，或 Jina.ai 服务暂时不可用。",
  404: "页面不存在。请检查链接是否正确。",
  500: "Jina.ai 服务器内部错误，请稍后重试。",
  502: "Jina.ai 网关错误，服务可能正在维护中。",
  503: "Jina.ai 服务暂时不可用，请稍后重试。",
  504: "请求超时。目标页面加载时间过长，请稍后重试。",
};

// 代理请求函数
async function proxyRequest(url: string, headers: Record<string, string> = {}): Promise<{ content: string; status: number }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const content = await response.text();
    return { content, status: response.status };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error("请求超时，请稍后重试");
    }
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
      // 清理 CDATA 和 HTML 实体
      let title = titleMatch[1].trim()
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"');

      let description = descMatch
        ? descMatch[1].trim()
            .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
        : "";

      items.push({
        title,
        link: linkMatch[1].trim(),
        description,
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

// 获取 Jina 错误提示
function getJinaErrorMessage(status: number): string {
  return JINA_ERROR_MESSAGES[status] || `请求失败 (HTTP ${status})，请稍后重试。`;
}

// 渲染基础 HTML 布局
function renderLayout(title: string, content: string, activePage = "home") {
  const escapeHtml = (str: string) => str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="referrer" content="no-referrer">
    <title>${escapeHtml(title)} - Linux DO Reader</title>
    
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
            --primary-light: #818cf8;
            --secondary: #f8fafc;
            --text: #1e293b;
            --text-light: #64748b;
            --text-muted: #94a3b8;
            --border: #e2e8f0;
            --card-bg: #ffffff;
            --sidebar-bg: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
            --sidebar-width: 280px;
            --header-height: 60px;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
            background: var(--secondary);
            min-height: 100vh;
            color: var(--text);
            line-height: 1.6;
            overflow-x: hidden;
        }
        
        /* 侧边栏样式 */
        .sidebar {
            position: fixed;
            left: 0;
            top: 0;
            width: var(--sidebar-width);
            height: 100vh;
            background: var(--sidebar-bg);
            color: white;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            transition: transform 0.3s ease;
            overflow: hidden;
        }
        
        .sidebar-header {
            padding: 1.5rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            flex-shrink: 0;
        }
        
        .sidebar-logo {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
        }
        
        .sidebar-logo i {
            font-size: 1.5rem;
        }
        
        .sidebar-logo h1 {
            font-size: 1.25rem;
            font-weight: 600;
        }
        
        .sidebar-tagline {
            font-size: 0.75rem;
            opacity: 0.8;
            line-height: 1.4;
        }
        
        .sidebar-nav {
            flex: 1;
            overflow-y: auto;
            padding: 1rem 0;
        }
        
        .sidebar-nav::-webkit-scrollbar {
            width: 4px;
        }
        
        .sidebar-nav::-webkit-scrollbar-track {
            background: transparent;
        }
        
        .sidebar-nav::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 2px;
        }
        
        .nav-section {
            padding: 0 1rem;
            margin-bottom: 1.5rem;
        }
        
        .nav-section-title {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            opacity: 0.6;
            margin-bottom: 0.5rem;
            padding: 0 0.75rem;
        }
        
        .nav-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.75rem;
            border-radius: 8px;
            color: rgba(255, 255, 255, 0.85);
            text-decoration: none;
            transition: all 0.2s ease;
            margin-bottom: 2px;
            cursor: pointer;
            border: none;
            background: transparent;
            width: 100%;
            text-align: left;
            font-size: 0.9rem;
        }
        
        .nav-item:hover {
            background: rgba(255, 255, 255, 0.15);
            color: white;
        }
        
        .nav-item.active {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            font-weight: 500;
        }
        
        .nav-item i {
            width: 20px;
            text-align: center;
            font-size: 0.9rem;
        }
        
        .nav-item .nav-icon-emoji {
            width: 20px;
            text-align: center;
            font-size: 1rem;
        }
        
        /* 主内容区域 */
        .main-content {
            margin-left: var(--sidebar-width);
            min-height: 100vh;
            transition: margin-left 0.3s ease;
        }
        
        /* 移动端头部 */
        .mobile-header {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: var(--header-height);
            background: white;
            box-shadow: var(--shadow);
            z-index: 999;
            padding: 0 1rem;
            align-items: center;
            justify-content: space-between;
        }
        
        .mobile-header h1 {
            font-size: 1.1rem;
            color: var(--text);
        }
        
        .menu-toggle {
            width: 40px;
            height: 40px;
            border: none;
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            color: var(--text);
            border-radius: 8px;
        }
        
        .menu-toggle:hover {
            background: var(--secondary);
        }
        
        /* 遮罩层 */
        .sidebar-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .sidebar-overlay.active {
            opacity: 1;
        }
        
        /* 页面内容 */
        .page-content {
            padding: 2rem;
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .page-header {
            margin-bottom: 2rem;
        }
        
        .page-header h2 {
            font-size: 1.75rem;
            color: var(--text);
            margin-bottom: 0.5rem;
        }
        
        .page-header p {
            color: var(--text-light);
        }
        
        /* 卡片网格 */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 1.5rem;
        }
        
        .card {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: var(--shadow);
            transition: all 0.3s ease;
            border: 1px solid var(--border);
            display: flex;
            flex-direction: column;
        }
        
        .card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }
        
        .card-header {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        
        .card-icon {
            font-size: 1.5rem;
            flex-shrink: 0;
        }
        
        .card-title {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text);
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        
        .card-desc {
            color: var(--text-light);
            font-size: 0.875rem;
            margin-bottom: 1rem;
            flex: 1;
        }
        
        .card-description {
            background: var(--secondary);
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1rem;
            font-size: 0.875rem;
            line-height: 1.6;
            color: var(--text);
            flex: 1;
            overflow: hidden;
            max-height: 150px;
            position: relative;
        }
        
        .card-description::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 40px;
            background: linear-gradient(transparent, var(--secondary));
            pointer-events: none;
        }
        
        .card-description a {
            color: var(--primary);
            text-decoration: none;
        }
        
        .card-description a:hover {
            text-decoration: underline;
        }
        
        .card-description img {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
        }
        
        .card-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.75rem;
            color: var(--text-muted);
            padding-top: 1rem;
            border-top: 1px solid var(--border);
            margin-top: auto;
        }
        
        .card-meta .author {
            display: flex;
            align-items: center;
            gap: 0.25rem;
        }
        
        /* 按钮样式 */
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 0.625rem 1.25rem;
            border-radius: 8px;
            text-decoration: none;
            border: none;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 0.875rem;
            font-weight: 500;
        }
        
        .btn-primary {
            background: var(--primary);
            color: white;
        }
        
        .btn-primary:hover {
            background: var(--primary-dark);
        }
        
        .btn-secondary {
            background: var(--secondary);
            color: var(--text);
            border: 1px solid var(--border);
        }
        
        .btn-secondary:hover {
            background: var(--border);
        }
        
        .btn-sm {
            padding: 0.5rem 1rem;
            font-size: 0.8rem;
        }
        
        /* Jina 浏览器 */
        .browser-container {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: var(--shadow);
            margin-bottom: 2rem;
        }
        
        .browser-input-group {
            display: flex;
            gap: 0.75rem;
            margin-top: 1rem;
        }
        
        .browser-input {
            flex: 1;
            padding: 0.875rem 1rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 0.9rem;
            outline: none;
            transition: border-color 0.2s;
        }
        
        .browser-input:focus {
            border-color: var(--primary);
        }
        
        /* 设置面板 */
        .settings-container {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: var(--shadow);
        }
        
        .form-group {
            margin-bottom: 1.25rem;
        }
        
        .form-group:last-of-type {
            margin-bottom: 1.5rem;
        }
        
        .form-label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
            color: var(--text);
            font-size: 0.875rem;
        }
        
        .form-input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 0.875rem;
            outline: none;
            transition: border-color 0.2s;
        }
        
        .form-input:focus {
            border-color: var(--primary);
        }
        
        .form-hint {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 0.25rem;
        }
        
        /* 文章内容区域 */
        .article-container {
            background: var(--card-bg);
            border-radius: 12px;
            padding: 2rem;
            box-shadow: var(--shadow);
        }
        
        .article-header {
            margin-bottom: 1.5rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid var(--border);
        }
        
        .article-title {
            font-size: 1.5rem;
            color: var(--text);
            margin-bottom: 0.75rem;
            line-height: 1.4;
        }
        
        .article-meta {
            display: flex;
            align-items: center;
            gap: 1rem;
            font-size: 0.875rem;
            color: var(--text-light);
            flex-wrap: wrap;
        }
        
        .article-meta a {
            color: var(--primary);
            text-decoration: none;
            word-break: break-all;
        }
        
        .article-meta a:hover {
            text-decoration: underline;
        }
        
        .back-btn {
            margin-bottom: 1.5rem;
        }
        
        /* Markdown 内容样式 */
        .markdown-body {
            background: transparent !important;
            font-size: 1rem;
            line-height: 1.8;
        }
        
        .markdown-body img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
        }
        
        .markdown-body a {
            color: var(--primary);
        }
        
        .markdown-body pre {
            border-radius: 8px;
            overflow-x: auto;
        }
        
        .markdown-body table {
            display: block;
            overflow-x: auto;
        }
        
        .markdown-body blockquote {
            border-left-color: var(--primary);
        }
        
        /* 加载状态 */
        .loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 3rem;
            color: var(--text-light);
        }
        
        .loading i {
            font-size: 2rem;
            margin-bottom: 1rem;
            color: var(--primary);
        }
        
        /* 骨架屏 */
        .skeleton {
            background: linear-gradient(90deg, var(--secondary) 25%, #e2e8f0 50%, var(--secondary) 75%);
            background-size: 200% 100%;
            animation: skeleton-loading 1.5s infinite;
            border-radius: 4px;
        }
        
        @keyframes skeleton-loading {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        
        .skeleton-title {
            height: 2rem;
            width: 70%;
            margin-bottom: 1rem;
        }
        
        .skeleton-meta {
            height: 1rem;
            width: 50%;
            margin-bottom: 1.5rem;
        }
        
        .skeleton-line {
            height: 1rem;
            width: 100%;
            margin-bottom: 0.75rem;
        }
        
        .skeleton-line:nth-child(odd) {
            width: 95%;
        }
        
        .skeleton-line:last-child {
            width: 60%;
        }
        
        /* 错误提示 */
        .error-container {
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 12px;
            padding: 1.5rem;
            margin: 1rem 0;
        }
        
        .error-container h4 {
            color: #dc2626;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .error-container p {
            color: #991b1b;
            font-size: 0.875rem;
        }
        
        .error-container .error-actions {
            margin-top: 1rem;
            display: flex;
            gap: 0.75rem;
        }
        
        /* 空状态 */
        .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-light);
        }
        
        .empty-state i {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }
        
        .empty-state h3 {
            margin-bottom: 0.5rem;
            color: var(--text);
        }
        
        /* 页脚 */
        .footer {
            text-align: center;
            padding: 2rem;
            color: var(--text-muted);
            font-size: 0.875rem;
            border-top: 1px solid var(--border);
            margin-top: 3rem;
        }
        
        .footer a {
            color: var(--primary);
            text-decoration: none;
        }
        
        /* Toast 通知 */
        .toast-container {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            z-index: 2000;
        }
        
        .toast {
            background: var(--text);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: var(--shadow-xl);
            margin-top: 0.75rem;
            animation: toast-in 0.3s ease;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .toast.success {
            background: #059669;
        }
        
        .toast.error {
            background: #dc2626;
        }
        
        @keyframes toast-in {
            from {
                opacity: 0;
                transform: translateY(1rem);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        /* 响应式设计 */
        @media (max-width: 1024px) {
            .grid {
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            }
        }
        
        @media (max-width: 768px) {
            .sidebar {
                transform: translateX(-100%);
            }
            
            .sidebar.open {
                transform: translateX(0);
            }
            
            .sidebar-overlay {
                display: block;
            }
            
            .mobile-header {
                display: flex;
            }
            
            .main-content {
                margin-left: 0;
                padding-top: var(--header-height);
            }
            
            .page-content {
                padding: 1rem;
            }
            
            .grid {
                grid-template-columns: 1fr;
            }
            
            .browser-input-group {
                flex-direction: column;
            }
            
            .article-container {
                padding: 1.25rem;
            }
            
            .article-title {
                font-size: 1.25rem;
            }
            
            .toast-container {
                left: 1rem;
                right: 1rem;
                bottom: 1rem;
            }
        }
        
        /* 隐藏类 */
        .hidden {
            display: none !important;
        }
    </style>
</head>
<body>
    <!-- 移动端遮罩 -->
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebar()"></div>
    
    <!-- 移动端头部 -->
    <header class="mobile-header">
        <button class="menu-toggle" onclick="toggleSidebar()" aria-label="打开菜单">
            <i class="fas fa-bars"></i>
        </button>
        <h1>Linux DO 阅读器</h1>
        <div style="width: 40px;"></div>
    </header>
    
    <!-- 侧边栏 -->
    <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
            <div class="sidebar-logo">
                <i class="fas fa-rss"></i>
                <h1>Linux DO 阅读器</h1>
            </div>
            <p class="sidebar-tagline">借 RSS 之骨，附内容之肉，破 CF 之困</p>
        </div>
        
        <nav class="sidebar-nav">
            <div class="nav-section">
                <div class="nav-section-title">导航</div>
                <a href="/" class="nav-item ${activePage === 'home' ? 'active' : ''}" data-page="home">
                    <i class="fas fa-home"></i>
                    <span>首页</span>
                </a>
                <a href="/browser" class="nav-item ${activePage === 'browser' ? 'active' : ''}" data-page="browser">
                    <i class="fas fa-compass"></i>
                    <span>Jina 浏览器</span>
                </a>
                <a href="/settings" class="nav-item ${activePage === 'settings' ? 'active' : ''}" data-page="settings">
                    <i class="fas fa-cog"></i>
                    <span>设置</span>
                </a>
            </div>
            
            <div class="nav-section">
                <div class="nav-section-title">分类订阅</div>
                ${CATEGORIES.map(cat => `
                    <a href="/category/${cat.id}" class="nav-item ${activePage === `category-${cat.id}` ? 'active' : ''}">
                        <span class="nav-icon-emoji">${cat.icon}</span>
                        <span>${cat.name}</span>
                    </a>
                `).join('')}
            </div>
        </nav>
    </aside>
    
    <!-- 主内容区域 -->
    <main class="main-content">
        ${content}
        
        <footer class="footer">
            <p>数据来源: <a href="https://linuxdorss.longpink.com" target="_blank">linuxdorss.longpink.com</a> • 内容渲染: <a href="https://jina.ai" target="_blank">Jina.ai</a></p>
            <p style="margin-top: 0.5rem; opacity: 0.7;">「曲线救国终不美，然此路可通」</p>
        </footer>
    </main>
    
    <!-- Toast 容器 -->
    <div class="toast-container" id="toastContainer"></div>

    <!-- Scripts -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked.min.js"></script>
    <script>
        // 侧边栏切换
        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        }
        
        // 关闭侧边栏（移动端）
        function closeSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
        
        // Toast 通知
        function showToast(message, type = 'info') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle') + '"></i>' + message;
            container.appendChild(toast);
            
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(1rem)';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
        
        // 设置管理
        function getSettings() {
            const saved = localStorage.getItem('appSettings');
            return saved ? JSON.parse(saved) : {
                jinaProxy: '${CONFIG.JINA_PROXY}',
                jinaApiKey: '${CONFIG.JINA_API_KEY}',
                rssBaseUrl: '${CONFIG.RSS_BASE_URL}'
            };
        }
        
        function saveSettings() {
            const settings = {
                jinaProxy: document.getElementById('jinaProxy')?.value || '',
                jinaApiKey: document.getElementById('jinaApiKey')?.value || '',
                rssBaseUrl: document.getElementById('rssBaseUrl')?.value || '${CONFIG.RSS_BASE_URL}'
            };
            localStorage.setItem('appSettings', JSON.stringify(settings));
            showToast('设置已保存', 'success');
        }
        
        function loadSettings() {
            const settings = getSettings();
            const jinaProxyEl = document.getElementById('jinaProxy');
            const jinaApiKeyEl = document.getElementById('jinaApiKey');
            const rssBaseUrlEl = document.getElementById('rssBaseUrl');
            
            if (jinaProxyEl) jinaProxyEl.value = settings.jinaProxy || '';
            if (jinaApiKeyEl) jinaApiKeyEl.value = settings.jinaApiKey || '';
            if (rssBaseUrlEl) rssBaseUrlEl.value = settings.rssBaseUrl || '${CONFIG.RSS_BASE_URL}';
        }
        
        // Jina 浏览器功能
        async function fetchWithJina() {
            const urlInput = document.getElementById('jinaUrl');
            const resultDiv = document.getElementById('jinaResult');
            const loadingDiv = document.getElementById('jinaLoading');
            
            if (!urlInput || !urlInput.value.trim()) {
                showToast('请输入要获取的网址', 'error');
                return;
            }
            
            const targetUrl = urlInput.value.trim();
            
            // 显示骨架屏
            resultDiv.innerHTML = \`
                <div class="article-container">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-meta"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                </div>
            \`;
            
            try {
                const response = await fetch('/api/jina?url=' + encodeURIComponent(targetUrl));
                const data = await response.json();
                
                if (data.error) {
                    resultDiv.innerHTML = \`
                        <div class="error-container">
                            <h4><i class="fas fa-exclamation-triangle"></i> 获取失败</h4>
                            <p>\${data.error}</p>
                            <div class="error-actions">
                                <button class="btn btn-secondary btn-sm" onclick="fetchWithJina()">
                                    <i class="fas fa-redo"></i> 重试
                                </button>
                                <a href="\${targetUrl}" target="_blank" class="btn btn-secondary btn-sm">
                                    <i class="fas fa-external-link-alt"></i> 直接访问
                                </a>
                            </div>
                        </div>
                    \`;
                } else {
                    resultDiv.innerHTML = \`
                        <div class="article-container">
                            <div class="article-header">
                                <h1 class="article-title">\${escapeHtml(data.title)}</h1>
                                <div class="article-meta">
                                    <span><i class="fas fa-link"></i> <a href="\${data.url}" target="_blank">\${data.url}</a></span>
                                </div>
                            </div>
                            <div class="markdown-body" id="markdown-content"></div>
                        </div>
                    \`;
                    
                    // 渲染 Markdown
                    const markdownContent = document.getElementById('markdown-content');
                    if (markdownContent && window.marked) {
                        markdownContent.innerHTML = marked.parse(data.markdown || '');
                    }
                }
            } catch (error) {
                resultDiv.innerHTML = \`
                    <div class="error-container">
                        <h4><i class="fas fa-exclamation-triangle"></i> 请求失败</h4>
                        <p>\${error.message}</p>
                        <div class="error-actions">
                            <button class="btn btn-secondary btn-sm" onclick="fetchWithJina()">
                                <i class="fas fa-redo"></i> 重试
                            </button>
                        </div>
                    </div>
                \`;
            }
        }
        
        // HTML 转义
        function escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
        
        // 动态加载文章内容
        async function loadArticleContent(topicId, container) {
            try {
                const response = await fetch('/api/topic/' + topicId);
                const data = await response.json();
                
                if (data.error) {
                    container.innerHTML = \`
                        <div class="error-container">
                            <h4><i class="fas fa-exclamation-triangle"></i> 加载失败</h4>
                            <p>\${data.error}</p>
                            <div class="error-actions">
                                <button class="btn btn-secondary btn-sm" onclick="location.reload()">
                                    <i class="fas fa-redo"></i> 重试
                                </button>
                                <a href="https://linux.do/t/topic/\${topicId}" target="_blank" class="btn btn-secondary btn-sm">
                                    <i class="fas fa-external-link-alt"></i> 直接访问
                                </a>
                            </div>
                        </div>
                    \`;
                } else {
                    container.innerHTML = \`
                        <div class="article-header">
                            <h1 class="article-title">\${escapeHtml(data.title)}</h1>
                            <div class="article-meta">
                                <span><i class="fas fa-link"></i> <a href="\${data.url}" target="_blank">\${data.url}</a></span>
                            </div>
                        </div>
                        <div class="markdown-body" id="article-markdown"></div>
                    \`;
                    
                    // 渲染 Markdown
                    const markdownEl = document.getElementById('article-markdown');
                    if (markdownEl && window.marked) {
                        markdownEl.innerHTML = marked.parse(data.markdown || '');
                    }
                }
            } catch (error) {
                container.innerHTML = \`
                    <div class="error-container">
                        <h4><i class="fas fa-exclamation-triangle"></i> 请求失败</h4>
                        <p>\${error.message}</p>
                        <div class="error-actions">
                            <button class="btn btn-secondary btn-sm" onclick="location.reload()">
                                <i class="fas fa-redo"></i> 重试
                            </button>
                        </div>
                    </div>
                \`;
            }
        }
        
        // 返回上一页
        function goBack() {
            if (document.referrer && document.referrer.includes(location.host)) {
                history.back();
            } else {
                location.href = '/';
            }
        }
        
        // 页面加载初始化
        document.addEventListener('DOMContentLoaded', function() {
            loadSettings();
            
            // Jina URL 回车事件
            const jinaUrlInput = document.getElementById('jinaUrl');
            if (jinaUrlInput) {
                jinaUrlInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        fetchWithJina();
                    }
                });
            }
            
            // 动态加载文章
            const articleContainer = document.getElementById('articleContent');
            const topicId = articleContainer?.dataset.topicId;
            if (articleContainer && topicId) {
                loadArticleContent(topicId, articleContainer);
            }
            
            // 移动端点击导航后关闭侧边栏
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                item.addEventListener('click', function() {
                    if (window.innerWidth <= 768) {
                        closeSidebar();
                    }
                });
            });
        });
    </script>
</body>
</html>`;
}

// 渲染首页内容
function renderHomePage() {
  const content = `
    <div class="page-content">
        <div class="page-header">
            <h2>📚 分类浏览</h2>
            <p>选择感兴趣的分类，浏览 Linux DO 社区最新内容</p>
        </div>
        
        <div class="grid">
            ${CATEGORIES.map(cat => `
                <a href="/category/${cat.id}" class="card" style="text-decoration: none;">
                    <div class="card-header">
                        <span class="card-icon">${cat.icon}</span>
                        <h3 class="card-title">${cat.name}</h3>
                    </div>
                    <p class="card-desc">${cat.desc}</p>
                    <div style="margin-top: auto;">
                        <span class="btn btn-primary btn-sm">
                            <i class="fas fa-arrow-right"></i> 浏览话题
                        </span>
                    </div>
                </a>
            `).join('')}
        </div>
    </div>
  `;

  return renderLayout("首页", content, "home");
}

// 渲染浏览器页面
function renderBrowserPage() {
  const content = `
    <div class="page-content">
        <div class="page-header">
            <h2><i class="fas fa-compass"></i> Jina 网页浏览器</h2>
            <p>输入任意网址，使用 Jina.ai 获取并渲染内容，绕过访问限制</p>
        </div>
        
        <div class="browser-container">
            <h3 style="margin-bottom: 0.5rem;"><i class="fas fa-globe"></i> 输入网址</h3>
            <p style="color: var(--text-light); font-size: 0.875rem;">支持任意网页，Jina.ai 会将内容转换为 Markdown 格式</p>
            
            <div class="browser-input-group">
                <input type="url" id="jinaUrl" class="browser-input" placeholder="https://linux.do/t/topic/12345" value="https://linux.do">
                <button class="btn btn-primary" onclick="fetchWithJina()">
                    <i class="fas fa-download"></i> 获取内容
                </button>
            </div>
        </div>
        
        <div id="jinaResult"></div>
    </div>
  `;

  return renderLayout("Jina 浏览器", content, "browser");
}

// 渲染设置页面
function renderSettingsPage() {
  const content = `
    <div class="page-content">
        <div class="page-header">
            <h2><i class="fas fa-cog"></i> 系统设置</h2>
            <p>配置 RSS 源和 Jina.ai 服务参数</p>
        </div>
        
        <div class="settings-container">
            <div class="form-group">
                <label class="form-label" for="rssBaseUrl">RSS 基础地址</label>
                <input type="url" id="rssBaseUrl" class="form-input" placeholder="https://linuxdorss.longpink.com">
                <p class="form-hint">RSS 订阅源的基础 URL</p>
            </div>
            
            <div class="form-group">
                <label class="form-label" for="jinaProxy">Jina 代理地址 (可选)</label>
                <input type="url" id="jinaProxy" class="form-input" placeholder="https://your-jina-proxy.com">
                <p class="form-hint">如果无法直接访问 Jina.ai，可以配置代理服务器</p>
            </div>
            
            <div class="form-group">
                <label class="form-label" for="jinaApiKey">Jina API Key (可选)</label>
                <input type="password" id="jinaApiKey" class="form-input" placeholder="输入 Jina.ai API Key">
                <p class="form-hint">配置 API Key 可以获得更高的请求配额和更快的响应速度</p>
            </div>
            
            <button class="btn btn-primary" onclick="saveSettings()">
                <i class="fas fa-save"></i> 保存设置
            </button>
        </div>
    </div>
  `;

  return renderLayout("设置", content, "settings");
}

// 渲染分类页面
function renderCategoryPage(categoryId: string, items: any[]) {
  const categoryInfo = CATEGORIES.find(cat => cat.id === categoryId) || CATEGORIES[0];

  const content = `
    <div class="page-content">
        <div class="page-header">
            <h2>${categoryInfo.icon} ${categoryInfo.name}</h2>
            <p>${categoryInfo.desc}</p>
        </div>
        
        ${items.length === 0 ? `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>暂无内容</h3>
                <p>该分类下暂时没有话题</p>
            </div>
        ` : `
            <div class="grid">
                ${items.map(item => {
                  const topicId = item.link.split('/').pop();
                  return `
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">${escapeHtml(item.title)}</h3>
                        </div>
                        <div class="card-description">${item.description}</div>
                        <div class="card-meta">
                            <span class="author">
                                <i class="fas fa-user"></i>
                                ${escapeHtml(item.creator) || '匿名'}
                            </span>
                            <span>${formatDate(item.pubDate)}</span>
                        </div>
                        <a href="/topic/${topicId}" class="btn btn-primary btn-sm" style="margin-top: 1rem;">
                            <i class="fas fa-book-open"></i> 阅读全文
                        </a>
                    </div>
                  `;
                }).join('')}
            </div>
        `}
    </div>
  `;

  return renderLayout(`${categoryInfo.name}`, content, `category-${categoryId}`);
}

// 渲染话题详情页（骨架屏版本）
function renderTopicPage(topicId: string) {
  const content = `
    <div class="page-content">
        <button class="btn btn-secondary back-btn" onclick="goBack()">
            <i class="fas fa-arrow-left"></i> 返回
        </button>
        
        <div class="article-container" id="articleContent" data-topic-id="${topicId}">
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-meta"></div>
            <div style="margin-top: 2rem;">
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line"></div>
            </div>
        </div>
    </div>
  `;

  return renderLayout("加载中...", content, "");
}

// 渲染 404 页面
function render404Page() {
  const content = `
    <div class="page-content">
        <div class="empty-state">
            <i class="fas fa-map-signs"></i>
            <h3 style="font-size: 4rem; margin-bottom: 1rem;">404</h3>
            <h3>页面不存在</h3>
            <p style="margin-bottom: 2rem;">您访问的页面可能已被移除或链接错误</p>
            <a href="/" class="btn btn-primary">
                <i class="fas fa-home"></i> 返回首页
            </a>
        </div>
    </div>
  `;

  return renderLayout("页面不存在", content, "");
}

// 渲染错误页面
function renderErrorPage(error: string) {
  const content = `
    <div class="page-content">
        <div class="error-container" style="max-width: 600px; margin: 2rem auto;">
            <h4><i class="fas fa-exclamation-triangle"></i> 发生错误</h4>
            <p>${escapeHtml(error)}</p>
            <div class="error-actions">
                <button class="btn btn-secondary" onclick="location.reload()">
                    <i class="fas fa-redo"></i> 重试
                </button>
                <a href="/" class="btn btn-primary">
                    <i class="fas fa-home"></i> 返回首页
                </a>
            </div>
        </div>
    </div>
  `;

  return renderLayout("错误", content, "");
}

// 辅助函数：HTML 转义
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 辅助函数：格式化日期
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return minutes <= 0 ? '刚刚' : `${minutes} 分钟前`;
      }
      return `${hours} 小时前`;
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days} 天前`;
    } else {
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  } catch {
    return dateStr;
  }
}

// 处理请求
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // API 路由
    if (path.startsWith("/api/")) {
      // RSS API
      if (path === "/api/rss") {
        const category = url.searchParams.get("category") || "latest";
        const rssUrl = `${CONFIG.RSS_BASE_URL}/${category}.xml`;

        const { content, status } = await proxyRequest(rssUrl);
        if (status !== 200) {
          return new Response(JSON.stringify({ error: `获取 RSS 失败 (HTTP ${status})` }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const items = parseRSS(content);
        return new Response(JSON.stringify({ success: true, items }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Jina API
      if (path === "/api/jina") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) {
          return new Response(JSON.stringify({ error: "缺少 URL 参数" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const jinaProxy = CONFIG.JINA_PROXY;
        const jinaBase = jinaProxy || CONFIG.JINA_BASE_URL;
        const jinaUrl = `${jinaBase}/${targetUrl}`;

        const headers: Record<string, string> = {};
        if (CONFIG.JINA_API_KEY) {
          headers["Authorization"] = `Bearer ${CONFIG.JINA_API_KEY}`;
        }

        try {
          const { content, status } = await proxyRequest(jinaUrl, headers);

          if (status !== 200) {
            const errorMessage = getJinaErrorMessage(status);
            return new Response(JSON.stringify({ error: errorMessage }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const parsed = parseJinaResponse(content);
          return new Response(JSON.stringify(parsed), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return new Response(JSON.stringify({ error: error.message || "请求 Jina.ai 失败" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Topic API（用于动态加载）
      if (path.startsWith("/api/topic/")) {
        const topicId = path.split("/")[3];
        const targetUrl = `https://linux.do/t/topic/${topicId}`;

        const jinaProxy = CONFIG.JINA_PROXY;
        const jinaBase = jinaProxy || CONFIG.JINA_BASE_URL;
        const jinaUrl = `${jinaBase}/${targetUrl}`;

        const headers: Record<string, string> = {};
        if (CONFIG.JINA_API_KEY) {
          headers["Authorization"] = `Bearer ${CONFIG.JINA_API_KEY}`;
        }

        try {
          const { content, status } = await proxyRequest(jinaUrl, headers);

          if (status !== 200) {
            const errorMessage = getJinaErrorMessage(status);
            return new Response(JSON.stringify({ error: errorMessage }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const parsed = parseJinaResponse(content);
          return new Response(JSON.stringify(parsed), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return new Response(JSON.stringify({ error: error.message || "请求失败" }), {
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
      return new Response(renderHomePage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/browser") {
      return new Response(renderBrowserPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/settings") {
      return new Response(renderSettingsPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 分类页面
    if (path.startsWith("/category/")) {
      const category = path.split("/")[2];
      const rssUrl = `${CONFIG.RSS_BASE_URL}/${category}.xml`;

      try {
        const { content, status } = await proxyRequest(rssUrl);

        if (status !== 200) {
          return new Response(renderErrorPage(`获取分类数据失败 (HTTP ${status})`), {
            status: 500,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        const items = parseRSS(content);
        return new Response(renderCategoryPage(category, items), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (error) {
        return new Response(renderErrorPage(error.message), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    // 话题详情页
    if (path.startsWith("/topic/")) {
      const topicId = path.split("/")[2];
      return new Response(renderTopicPage(topicId), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 404 页面
    return new Response(render404Page(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  } catch (error) {
    console.error("Handler error:", error);
    return new Response(renderErrorPage(error.message), {
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
