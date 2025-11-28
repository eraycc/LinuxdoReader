# 使用官方 Deno alpine 镜像
FROM denoland/deno:alpine-2.4.3

# 设置工作目录
WORKDIR /app

# 复制项目文件到镜像
COPY main.ts .

# 缓存依赖
RUN deno cache main.ts

# 暴露端口
EXPOSE 8000

# 设置默认环境变量
ENV RSS_BASE_URL="https://linuxdorss.longpink.com"
ENV JINA_BASE_URL="https://r.jina.ai"
ENV JINA_API_KEY=""
ENV IMAGE_PROXY_URL=""
ENV IMAGE_URL_ENCODE="false"
ENV RSS_CACHE_TTL="600"
ENV JINA_CACHE_TTL="604800"

# 启动应用
CMD ["deno", "run", \
    "--allow-net", \
    "--allow-env", \
    "--allow-read", \
    "--allow-write", \
    "--no-check", \
    "--no-prompt", \
    "main.ts"]
