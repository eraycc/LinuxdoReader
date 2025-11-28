# Linux DO Reader

一个基于 Deno 的 Linux DO 社区 RSS 阅读器，提供美观的界面和增强的阅读体验。

## ✨ 特性

- 🎯 **多分类浏览** - 支持最新话题、热门话题、开发调优等12个分类
- 🤖 **智能阅读** - 集成 Jina AI 服务，将网页内容转换为易读的 Markdown 格式
- 🖼️ **图片代理** - 可配置的图片代理，解决图片加载问题
- 📱 **响应式设计** - 完美适配桌面和移动设备
- 🎨 **卡片式布局** - 瀑布流展示，视觉体验优秀
- ⚡ **智能缓存** - RSS 内容和 Jina 解析结果双重缓存
- 🔄 **懒加载** - 图片懒加载，提升页面加载速度

## 🚀 快速开始

### Docker 部署（推荐）

```bash
# 拉取镜像
docker pull ghcr.io/eraycc/linuxdoreader:latest

# 运行容器
docker run -d \
  --name linuxdo-reader \
  -p 8000:8000 \
  ghcr.io/eraycc/linuxdoreader:latest
```

访问 http://localhost:8000 即可使用。

### 使用 Docker Compose

```yaml
version: '3.8'
services:
  linuxdo-reader:
    image: ghcr.io/eraycc/linuxdoreader:latest
    container_name: linuxdo-reader
    ports:
      - "8000:8000"
    environment:
      - JINA_API_KEY=your_jina_api_key
      - IMAGE_PROXY_URL=https://proxy.example.com/?url=\${image}
    restart: unless-stopped
```

## ⚙️ 配置选项

支持以下环境变量配置：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `RSS_BASE_URL` | `https://linuxdorss.longpink.com` | RSS 源地址 |
| `JINA_BASE_URL` | `https://r.jina.ai` | Jina AI 服务地址 |
| `JINA_API_KEY` | 空 | Jina API 密钥（提升速率限制） |
| `IMAGE_PROXY_URL` | 空 | 图片代理 URL 模板 |
| `IMAGE_URL_ENCODE` | `false` | 是否对图片 URL 编码 |
| `RSS_CACHE_TTL` | `600` | RSS 缓存时间（秒） |
| `JINA_CACHE_TTL` | `604800` | Jina 缓存时间（秒） |

## 🎯 使用说明

### 主要功能

1. **首页广场** - 浏览最新话题
2. **分类浏览** - 按分类查看内容：
   - 🆕 最新话题
   - 🔥 热门话题  
   - 💻 开发调优
   - 📚 资源荟萃
   - 📝 文档共建
   - 🎁 福利羊毛
   - 💬 搞七捻三
   - 📰 前沿快讯
   - 📖 读书成诗
   - 💼 非我莫属
   - ⚖️ 跳蚤市场
   - 📊 运营反馈

3. **Jina 浏览器** - 智能阅读模式
4. **系统设置** - 个性化配置

### 特色功能

- **智能阅读**：点击"Jina 浏览"使用 AI 优化阅读体验
- **图片代理**：在设置中配置图片代理解决加载问题
- **响应式设计**：完美支持手机、平板、桌面设备
- **实时缓存**：智能缓存机制提升加载速度

## 🔧 开发

### 本地运行

```bash
# 克隆项目
git clone https://github.com/eraycc/LinuxdoReader.git
cd LinuxdoReader

# 安装 Deno (https://deno.land)
deno run --allow-net --allow-env main.ts
```

### 构建镜像

```bash
docker build -t linuxdo-reader .
```

## 📁 项目结构

```
LinuxdoReader/
├── main.ts          # 主程序入口
├── Dockerfile       # Docker 构建文件
└── README.md        # 项目说明
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request

- 📝 **项目地址**: https://github.com/eraycc/LinuxdoReader
- 🐛 **问题反馈**: https://github.com/eraycc/LinuxdoReader/issues

## 🙏 致谢

- [Linux DO](https://linux.do) - LinuxDo社区
- [Linux DO RSS](https://linuxdorss.longpink.com/) - LinuxDo第三方RSS源
- [Jina.ai](https://jina.ai) - 内容解析服务  
- [Deno](https://deno.com) - 运行时环境
- [Marked](https://marked.js.org) - Markdown 解析

---

**立即体验**: `docker run -p 8000:8000 ghcr.io/eraycc/linuxdoreader:latest`
