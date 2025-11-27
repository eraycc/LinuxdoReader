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

function unescapeHTML(str: string) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseRSS(xml: string) {
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
      items.push({
        title: extract("title"),
        link: link,
        topicId: topicIdMatch[1],
        descriptionHTML: extract("description"), 
        pubDate: extract("pubDate"),
        creator: extract("dc:creator") || "Linux Do",
      });
    }
  }
  return items;
}

async function proxyRequest(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "LinuxDOReader/7.0", ...headers } });
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

/* 侧边栏 (全平台默认隐藏) */
.sidebar { 
    width: var(--sidebar-width); 
    background: #1e1e2e; 
    color: #a6adc8; 
    position: fixed; 
    inset: 0 auto 0 0; 
    z-index: 100; /* 最高层级 */
    overflow-y: auto; 
    transform: translateX(-100%); /* 默认隐藏 */
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: none;
}
.sidebar.open { 
    transform: translateX(0); 
    box-shadow: 0 0 50px rgba(0,0,0,0.5);
}

.brand { padding: 1.5rem; color: #fff; font-weight: bold; font-size: 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px;}
.nav a { display: flex; align-items: center; padding: 0.8rem 1.5rem; color: inherit; text-decoration: none; transition: all 0.2s; }
.nav a:hover, .nav a.active { background: rgba(255,255,255,0.1); color: #fff; }
.nav a.active { border-left: 3px solid var(--primary); background: rgba(124, 58, 237, 0.1); }
.nav i { width: 24px; margin-right: 8px; text-align: center;}

/* 遮罩层 (全平台通用) */
.overlay { 
    position: fixed; 
    inset: 0; 
    background: rgba(0,0,0,0.5); 
    z-index: 90; 
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
    backdrop-filter: blur(2px);
}
.overlay.show { opacity: 1; pointer-events: auto; }

/* 主区域 (全平台全屏) */
.main { 
    flex: 1; 
    width: 100%; 
    margin-left: 0; /* 不再预留边距 */
    min-width: 0; /* 防止 Flex 子项溢出 */
}

.header { 
    background: #fff; 
    padding: 0.8rem 1.5rem; 
    position: sticky; 
    top: 0; 
    z-index: 40; 
    box-shadow: 0 1px 2px rgba(0,0,0,0.05); 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
}

/* 菜单按钮 (始终显示) */
.menu-btn { 
    display: flex; 
    align-items: center; 
    justify-content: center;
    background: transparent; 
    border: 1px solid #e5e7eb; 
    font-size: 1rem; 
    cursor: pointer; 
    width: 40px; 
    height: 40px; 
    border-radius: 8px;
    color: var(--text);
    transition: all 0.2s;
}
.menu-btn:hover { background: #f3f4f6; }

.content { padding: 2rem; max-width: 1200px; margin: 0 auto; }

/* Grid & Card */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; align-items: start; }

.card { 
    background: var(--card-bg); 
    border-radius: 12px; 
    padding: 1.5rem; 
    box-shadow: 0 1px 3px rgba(0,0,0,0.05); 
    display: flex; 
    flex-direction: column; 
    position: relative; 
    transition: transform 0.2s; 
}
.card:hover { transform: translateY(-3px); box-shadow: 0 10px 15px rgba(0,0,0,0.1); }

.card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; line-height: 1.4; }

/* Card Body: 完全展示，无截断 */
.card-body {
  font-size: 0.95rem;
  color: #4b5563;
  line-height: 1.6;
  margin-bottom: 1rem;
}
.card-body p { margin-bottom: 0.8rem; }
.card-body img { display: block; max-width: 100%; height: auto; border-radius: 6px; margin: 0.8rem 0; }
.card-body small, .card-body a[href*="topic"] { display: none !important; }
.card-body br { display: block; content: ""; margin-bottom: 0.5rem; }
.card-body a { pointer-events: none; text-decoration: none; color: inherit; }

.card-meta { margin-top: auto; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.85rem; color: var(--gray); display: flex; justify-content: space-between; }
.card-link { position: absolute; inset: 0; z-index: 10; }

/* Reader & Forms */
.reader { background: #fff; padding: 2rem; border-radius: 12px; min-height: 60vh; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.form-group { margin-bottom: 1.5rem; }
.form-group label { display: block; margin-bottom: 0.5rem; font-weight: 500; }
.form-input { width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; }
.btn { background: var(--primary); color: #fff; border: none; padding: 0.8rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 1rem; display: inline-flex; align-items: center; gap: 8px; }
.btn:hover { opacity: 0.9; }

/* Mobile tweaks */
@media (max-width: 768px) {
  .content { padding: 1rem; }
}
`;

// --- 页面渲染模板 ---

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
      <div style="width:40px"></div> <!-- 占位符保持标题居中 -->
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

// --- 统一阅读器模板 (用于 RSS 详情和 Jina 浏览器) ---
function renderReaderScript(apiUrlParamJS: string, backLink: string, backText: string) {
    return `
      <div class="reader">
        <div style="margin-bottom:1rem"><a href="${backLink}" style="color:var(--primary);text-decoration:none;font-weight:500"><i class="fas fa-arrow-left"></i> ${backText}</a></div>
        <div id="load" style="text-align:center;padding:4rem"><i class="fas fa-spinner fa-spin fa-3x" style="color:#ddd"></i><p style="margin-top:1rem;color:#888">正在渲染内容...</p></div>
        <div id="err" style="display:none;color:#dc2626;padding:1rem;background:#fee2e2;border-radius:8px"></div>
        <div id="view" style="display:none">
          <h1 id="tt" style="margin-bottom:0.5rem;font-size:1.8rem"></h1>
          <div id="meta" style="color:#888;margin-bottom:2rem;font-size:0.9rem;border-bottom:1px solid #eee;padding-bottom:1rem"></div>
          <div id="md" class="markdown-body"></div>
        </div>
      </div>
      <script>
        (async () => {
          const h = {};
          const b = localStorage.getItem('r_base'), k = localStorage.getItem('r_key');
          if(b) h['x-base'] = b; if(k) h['x-key'] = k;
          try {
            // 动态获取 URL
            const urlParam = ${apiUrlParamJS};
            const r = await fetch('/api/jina?url=' + encodeURIComponent(urlParam), {headers:h});
            const d = await r.json();
            if(d.error) throw new Error(d.error);
            
            document.getElementById('load').style.display='none';
            document.getElementById('view').style.display='block';
            document.getElementById('tt').innerText = d.title;
            document.getElementById('meta').innerHTML = (d.date||'') + ' • <a href="'+d.url+'" target="_blank" style="color:inherit">阅读原文 <i class="fas fa-external-link-alt"></i></a>';
            document.getElementById('md').innerHTML = marked.parse(d.markdown);
            
            // 图片懒加载优化
            document.querySelectorAll('.markdown-body img').forEach(img => img.loading = 'lazy');
          } catch(e) {
            document.getElementById('load').style.display='none';
            document.getElementById('err').style.display='block';
            document.getElementById('err').innerHTML = '<strong>加载失败</strong><br>' + e.message + '<br><br><button onclick="location.reload()" class="btn">重试</button>';
          }
        })();
      </script>
    `;
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
      
      let md = text;
      const idx = text.indexOf("Markdown Content:");
      if (idx > -1) md = text.substring(idx + 17).trim();
      
      const titleM = text.match(/Title: (.+)/);
      const dateM = text.match(/Published Time: (.+)/);
      const urlM = text.match(/URL Source: (.+)/);

      return new Response(JSON.stringify({
        title: titleM ? titleM[1] : "阅读模式",
        date: dateM ? dateM[1] : "",
        url: urlM ? urlM[1] : target,
        markdown: md
      }), { headers: { "Content-Type": "application/json" } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Page: Jina Browser (Input)
  if (path === "/browser") {
      const html = `
        <div class="reader" style="text-align:center; padding-top:4rem;">
            <i class="fas fa-compass" style="font-size:4rem; color:var(--primary); margin-bottom:2rem;"></i>
            <h1 style="margin-bottom:1rem;">Jina 浏览器</h1>
            <p style="color:#666; margin-bottom:2rem;">输入任意网址，将其转换为清爽的 Markdown 阅读模式</p>
            
            <div style="max-width:600px; margin:0 auto;">
                <div class="form-group">
                    <input type="url" id="target-url" class="form-input" placeholder="https://example.com/article..." required>
                </div>
                <button onclick="goBrowse()" class="btn" style="width:100%; justify-content:center; padding:1rem;">
                    立即阅读 <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        </div>
        <script>
            function goBrowse() {
                const u = document.getElementById('target-url').value.trim();
                if(u) window.location.href = '/read?url=' + encodeURIComponent(u);
                else alert('请输入网址');
            }
            // 回车支持
            document.getElementById('target-url').addEventListener('keypress', function(e) {
                if(e.key === 'Enter') goBrowse();
            });
        </script>
      `;
      return new Response(render(html, "browser", "Jina 浏览器"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // Page: Custom Reader (Jina Browser Result)
  if (path === "/read") {
      const targetUrl = url.searchParams.get("url") || "";
      const html = renderReaderScript(`'${targetUrl}'`, '/browser', '返回浏览器');
      return new Response(render(html, "browser", "阅读模式"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // Page: Settings
  if (path === "/settings") {
    const html = `
      <div class="reader settings">
        <h2 style="margin-bottom:2rem"><i class="fas fa-sliders-h"></i> 个性化设置</h2>
        <div class="form-group">
            <label>Jina Base URL (反代地址)</label>
            <input id="base" class="form-input" placeholder="${DEFAULT_CONFIG.JINA_BASE_URL}">
        </div>
        <div class="form-group">
            <label>Jina API Key (可选)</label>
            <input id="key" class="form-input" placeholder="Optional">
        </div>
        <div style="margin-top:2rem">
            <button class="btn" onclick="save()"><i class="fas fa-save"></i> 保存配置</button>
            <button class="btn" onclick="reset()" style="background:transparent; color:#666; border:1px solid #ddd; margin-left:1rem">恢复默认</button>
        </div>
      </div>
      <script>
        const $ = id => document.getElementById(id);
        $('base').value = localStorage.getItem('r_base') || '';
        $('key').value = localStorage.getItem('r_key') || '';
        function save() {
          const b = $('base').value.trim(), k = $('key').value.trim();
          b ? localStorage.setItem('r_base', b) : localStorage.removeItem('r_base');
          k ? localStorage.setItem('r_key', k) : localStorage.removeItem('r_key');
          alert('设置已保存');
        }
        function reset() { localStorage.clear(); location.reload(); }
      </script>
    `;
    return new Response(render(html, "settings", "设置"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  // Page: Topic Detail (RSS Item)
  if (path.startsWith("/topic/")) {
    const id = path.split("/")[2];
    // 复用统一的阅读器脚本，但是 URL 来源不同
    const html = renderReaderScript(`'/t/topic/${id}'`, 'javascript:history.back()', '返回列表');
    return new Response(render(html, "topic", "话题详情"), { headers: { "Content-Type": "text/html; charset=utf-8" }});
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
    return new Response(render(`<div style="color:#dc2626;padding:2rem;text-align:center">RSS 获取失败: ${e.message}</div>`, catId, "Error"), { headers: { "Content-Type": "text/html" }});
  }
}

console.log("Service running on http://localhost:8000");
serve(handler, { port: 8000 });
