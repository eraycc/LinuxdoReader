# Linux DO RSS Reader

一个基于 Deno 的现代化 RSS 阅读器，专为 Linux DO 社区设计，集成了 Jina.ai 内容解析服务，突破网络访问限制。

## ✨ 特性

- 🎨 **现代化界面** - 侧边栏导航、卡片式布局、响应式设计
- 📚 **完整 RSS 支持** - 支持 Linux DO 所有分类话题
- 🔍 **Jina 集成** - 自动解析网页内容，突破 CF 防护
- 📱 **移动端友好** - 完美适配各种屏幕尺寸
- ⚡ **边缘部署** - 基于 Deno Deploy，全球快速访问
- 🛡️ **内容安全** - 防御性 CSS 布局，防止内容溢出

## 🚀 快速开始

### 本地运行

```bash
# 运行服务
deno run --allow-net --allow-env main.ts

# 指定端口运行
deno run --allow-net --allow-env main.ts --port=3000
```

服务启动后访问: http://localhost:8000

### 环境变量配置

```bash
# RSS 源地址
export RSS_BASE_URL="https://linuxdorss.longpink.com"

# Jina.ai 服务地址  
export JINA_BASE_URL="https://r.jina.ai"

# Jina.ai API Key (可选)
export JINA_API_KEY="your-api-key"
```

## 📖 使用指南

### 首页广场
- 浏览所有 RSS 分类
- 点击分类进入对应话题列表

### 话题阅读
- **Jina 浏览**: 使用 Jina.ai 解析完整内容
- **阅读原文**: 直接访问原始链接
- **响应式卡片**: 完美展示话题摘要

### Jina 浏览器
- 输入任意网址进行内容解析
- 支持自定义 Jina 代理服务
- 实时 Markdown 渲染

### 系统设置
- 配置 Jina 服务地址
- 设置 API Key
- 本地存储配置

## 🏗️ 项目结构

```
main.ts                 # 主应用文件
├── 配置部分
│   ├── 环境变量配置
│   └── RSS 分类定义
├── 工具函数
│   ├── HTML 反转义
│   ├── RSS 解析器
│   └── 代理请求
├── 样式系统
│   └── 防御性 CSS 布局
├── 模板渲染
│   ├── 主布局模板
│   └── 阅读器组件
└── 路由处理
    ├── API 端点
    ├── 页面路由
    └── 错误处理
```

## 🔧 API 接口

### `GET /api/jina`
获取 Jina.ai 解析内容

**参数:**
- `url`: 目标网址

**响应:**
```json
{
  "title": "页面标题",
  "date": "发布时间", 
  "url": "源地址",
  "markdown": "Markdown 内容"
}
```

### RSS 分类端点
- `GET /` - 首页
- `GET /category/{id}` - 分类话题列表
- `GET /topic/{id}` - 话题详情页

## 🌐 部署

### Deno Deploy

1. 访问 [deno.com/deploy](https://deno.com/deploy)
2. 创建新项目
3. 粘贴 `main.ts` 代码
4. 配置环境变量
5. 部署完成

### 其他平台

支持任何支持 Deno 的部署平台：
- Deno Deploy
- Fly.io
- Railway
- 自建服务器

## 🎨 界面特色

### 设计理念
- **侧边栏导航** - 固定分类，快速切换
- **卡片布局** - 信息层次清晰，视觉舒适
- **毛玻璃效果** - 现代 UI 设计
- **流畅动画** - 增强用户体验

### 响应式特性
```css
/* 移动端适配 */
@media (max-width: 768px) {
  .content { padding: 1rem; }
  .grid { grid-template-columns: 1fr; }
}
```

## 🔒 内容安全

### 防御性 CSS
```css
/* 防止内容溢出 */
.card-body * {
  max-width: 100% !important;
  box-sizing: border-box;
}

/* 图片自适应 */
.card-body img {
  max-width: 100%;
  height: auto;
}

/* 代码块滚动 */
.card-body pre {
  overflow-x: auto;
}
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 🙏 致谢

- [Linux DO](https://linux.do) - 社区内容源
- [Jina.ai](https://jina.ai) - 内容解析服务  
- [Deno](https://deno.com) - 运行时环境
- [Marked](https://marked.js.org) - Markdown 解析

---

**「曲线救国终不美，然此路可通」**
