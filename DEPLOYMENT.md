# AI Morning Brief — 部署文档

> 一个 AI 驱动的每日简报仪表盘，聚合 AI 资讯、国际局势、LM Arena 排行榜、天气预报和金融市场数据。
> 单文件 HTML 前端 + Node.js LLM 后端，部署在 Nginx 反向代理之后。

---

## 项目架构

```
浏览器 (http://your-domain.com)
  │
  ▼
Nginx (80端口) ─────────────────────────────────────────
  │                                                     │
  ├─ /                     → /usr/share/nginx/html/*    (静态文件)
  ├─ /api/aihot/*          → aihot.virxact.com          (AI 新闻代理)
  └─ /api/llm/*            → http://localhost:3000/*     (LLM 后端)
                               │
                               ▼
                          Node.js Express (端口 3000)
                               │
                               ▼
                          DeepSeek API (v4-flash)
```

### 数据源一览

| 板块 | 数据来源 | 类型 | 说明 |
|------|---------|------|------|
| AI 日报 | aihot.virxact.com `/api/public/` | API | AI 领域新闻 |
| 国际局势 | news.google.com RSS | RSS | 全球新闻标题 |
| LM Arena | GitHub raw (arena-ai-leaderboards) | JSON | 模型排行榜 |
| 天气 | Open-Meteo API | API | 7 天天气预报（免费，无需 Key） |
| 金融市场 | 腾讯财经 / 新浪财经 | API | 上证、纳斯达克、金银价格 |
| AI 分析 | DeepSeek V4 Flash | LLM | 金融分析、翻译、局势解读 |

---

## 文件清单

```
项目根目录/
├── ai-morning-brief.html   # 前端单文件（131KB，包含 CSS + JS）
├── llm-server.js           # LLM 后端服务（Express）
├── package.json            # 后端依赖声明
├── nginx.conf              # Nginx 完整配置参考
├── nginx-llm.conf          # LLM 反代 location 片段
├── favicon.ico             # 网站图标
├── favicon.png             # 网站图标 (256px)
├── .gitignore              # Git 忽略规则
└── .env                    # 后端环境变量（不上传 Git）
```

---

## 第一步：服务器环境准备

### 1.1 系统要求

- **OS**: Linux (CentOS 7+ / Ubuntu 20.04+ / Rocky Linux 8+)
- **Nginx**: 1.18+
- **Node.js**: 18.0+
- **npm**: 自动随 Node.js 安装

### 1.2 安装 Nginx

```bash
# CentOS / Rocky
yum install -y nginx
systemctl enable nginx
systemctl start nginx

# Ubuntu
apt update && apt install -y nginx
systemctl enable nginx
systemctl start nginx
```

### 1.3 安装 Node.js 18+

```bash
# 使用 NodeSource 仓库
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs

# 验证
node -v   # ≥ 18.0
npm -v
```

---

## 第二步：部署前端静态文件

### 2.1 上传文件

```bash
# 将以下文件上传到服务器 /usr/share/nginx/html/
scp ai-morning-brief.html root@YOUR_SERVER_IP:/usr/share/nginx/html/index.html
scp favicon.ico root@YOUR_SERVER_IP:/usr/share/nginx/html/
scp favicon.png root@YOUR_SERVER_IP:/usr/share/nginx/html/
```

### 2.2 配置 Nginx

编辑 `/etc/nginx/nginx.conf`，在 `server` 块中添加以下配置：

```nginx
server {
    listen       80 default_server;
    server_name  _;
    root         /usr/share/nginx/html;

    # 1. AI 新闻 API 代理（绕过 CORS）
    location /api/aihot/ {
        proxy_pass https://aihot.virxact.com/api/public/;
        proxy_set_header Host aihot.virxact.com;
        proxy_set_header User-Agent "Mozilla/5.0";
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "public, max-age=300";
    }

    # 2. LLM 后端代理
    location /api/llm/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
        add_header Access-Control-Allow-Headers 'Content-Type, Authorization';
        if ($request_method = 'OPTIONS') {
            return 204;
        }
    }
}
```

```bash
# 测试配置并重载
nginx -t && systemctl reload nginx
```

---

## 第三步：部署 LLM 后端

### 3.1 上传后端文件

```bash
# 上传到服务器
scp llm-server.js root@YOUR_SERVER_IP:/opt/llm-backend/
scp package.json root@YOUR_SERVER_IP:/opt/llm-backend/
```

### 3.2 配置 API Key

在服务器上创建 `.env` 文件：

```bash
mkdir -p /opt/llm-backend
cat > /opt/llm-backend/.env << 'EOF'
DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
PORT=3000
EOF
```

> ⚠️ `.env` 包含敏感信息，已加入 `.gitignore`，切勿上传到 Git 仓库。

### 3.3 安装依赖并启动

```bash
cd /opt/llm-backend
npm install

# 启动服务（后台运行）
nohup node llm-server.js > llm.log 2>&1 &

# 验证健康检查
curl http://localhost:3000/health
# 期望输出: {"status":"ok","model":"deepseek-v4-flash","version":"1.0.0"}
```

### 3.4 设置开机自启（可选）

使用 systemd 管理后端进程：

```bash
cat > /etc/systemd/system/llm-backend.service << 'EOF'
[Unit]
Description=AI Morning Brief LLM Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/llm-backend
ExecStart=/usr/bin/node /opt/llm-backend/llm-server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable llm-backend
systemctl start llm-backend
```

### 3.5 后端 API 端点一览

| 方法 | 路径 | 功能 | 速率限制 |
|------|------|------|---------|
| GET | `/health` | 健康检查 | 无限制 |
| POST | `/translate` | 批量英译中 | 50 次/天 |
| POST | `/finance-analysis` | 金融走势 AI 分析 | 10 次/天 |
| POST | `/ai-news-summary` | AI 日报摘要 | 10 次/天 |
| POST | `/arena-comment` | Arena 排行榜点评 | 10 次/天 |
| POST | `/world-news-analysis` | 国际局势简要分析 | 10 次/天 |
| POST | `/world-news-generate` | AI 生成详细报道 | 10 次/天 |
| POST | `/my-focus-analysis` | 美军大动作筛选 | 10 次/天 |

---

## 第四步：验证部署

### 4.1 前端验证

在浏览器访问 `http://YOUR_SERVER_IP/` 或 `http://your-domain.com/`：

- ✅ 页面正常加载，显示橙红渐变主题
- ✅ 五大板块可见：AI 日报 / 国际局势 / Arena Top10 / 天气 / 金融市场
- ✅ Hero 统计栏显示实时数据
- ✅ 深色模式切换正常

### 4.2 后端验证

```bash
# 健康检查
curl http://YOUR_SERVER_IP/api/llm/health

# 翻译测试
curl -X POST http://YOUR_SERVER_IP/api/llm/translate \
  -H "Content-Type: application/json" \
  -d '{"texts": ["Hello World", "Breaking News"]}'

# 金融分析测试
curl -X POST http://YOUR_SERVER_IP/api/llm/finance-analysis \
  -H "Content-Type: application/json" \
  -d '{"shanghai":{"cur":3350,"prev":3340},"gold":{"cur":4300,"prev":4280},"nasdaq":{"cur":19200,"prev":19150}}'
```

---

## 日常运维

### 查看后端日志

```bash
tail -f /opt/llm-backend/llm.log
```

### 重启后端

```bash
# 方式一：杀进程重启
fuser -k 3000/tcp
cd /opt/llm-backend && nohup node llm-server.js > llm.log 2>&1 &

# 方式二：systemd（如已配置）
systemctl restart llm-backend
```

### 更新前端

```bash
scp ai-morning-brief.html root@YOUR_SERVER_IP:/usr/share/nginx/html/index.html
# Nginx 静态文件无需重启
```

### 更新后端

```bash
scp llm-server.js root@YOUR_SERVER_IP:/opt/llm-backend/
# 然后重启后端服务
```

### 调整速率限制

编辑 `/opt/llm-backend/llm-server.js`，修改常量：

```javascript
const TRANSLATE_DAILY_LIMIT = 50;  // 翻译次数/天
const ANALYSIS_DAILY_LIMIT = 10;   // 分析次数/天
```

修改后重启后端即可生效。

---

## 前端功能详解

### 缓存机制

前端使用两层 localStorage 缓存：

| 缓存层 | Key | 内容 | 策略 |
|--------|-----|------|------|
| API 缓存 | `_brief_api_cache` | 原始 API 响应 | 网络优先，失败降级 |
| AI 缓存 | `_brief_ai_cache` | LLM 生成内容 | 内容哈希校验，变化时刷新 |

- **打开页面**：API 数据总是尝试获取最新，AI 数据按哈希判断是否复用缓存
- **点击刷新按钮**：清空 AI 缓存，重新获取所有数据
- **API 请求失败**：自动降级到本地缓存

### 速率限制提示

当 AI 请求超过每日上限时，页面会显示友好提示：
> "AI 请求已达每日上限（10 次/天），请明天再试"

### 主题切换

支持浅色/深色模式，通过页面右上角按钮切换，偏好存入 localStorage。

---

## 故障排查

### Nginx 502 Bad Gateway

后端未启动或端口不正确：
```bash
# 检查后端是否运行
curl http://localhost:3000/health

# 查看端口监听
netstat -tlnp | grep 3000

# 如未运行，重启后端
fuser -k 3000/tcp
cd /opt/llm-backend && nohup node llm-server.js > llm.log 2>&1 &
```

### DeepSeek API 调用失败

```bash
# 检查日志
tail -20 /opt/llm-backend/llm.log

# 常见原因：
# 1. API Key 过期或余额不足 → 充值或更换 Key
# 2. API 限流 → 等待恢复
# 3. 网络不通 → curl https://api.deepseek.com 测试连通性
```

### 页面数据不更新

1. 检查浏览器 Console 是否有错误
2. 检查 Nginx 错误日志：`tail -f /var/log/nginx/error.log`
3. 检查后端日志：`tail -f /opt/llm-backend/llm.log`
4. 点击页面"刷新数据"按钮强制刷新

### Arena 数据不显示

Arena 数据来自 GitHub raw，需要当日数据文件存在。如果当天数据尚未发布（通常 UTC 时间每天更新），会使用前一天缓存。

---

## 安全注意事项

1. **`.env` 文件**：包含 API Key，已加入 `.gitignore`，不要上传到公开仓库
2. **SSH 密钥**：`.pem` 文件已加入 `.gitignore`，不要上传
3. **速率限制**：后端已内置 IP 级别速率限制，防止恶意刷 Token
4. **CORS**：Nginx 已配置跨域头，只允许必要的方法
5. **HTTPS**：生产环境建议使用 Certbot 配置免费 SSL 证书

### 配置 HTTPS（可选）

```bash
# 安装 Certbot
yum install -y certbot python3-certbot-nginx

# 自动配置（需要域名已解析）
certbot --nginx -d your-domain.com

# 自动续期
echo "0 3 * * * certbot renew --quiet" | crontab -
```

---

## 版本历史

| 日期 | 主要变更 |
|------|---------|
| 2026-06-15 | 初始版本：AI 日报、国际局势、Arena、天气、金融市场五板块 |
| 2026-06-16 | 增加国际局势翻译、金融 AI 分析、渐进式加载、缓存机制、速率限制 |
| 2026-06-16 | 重构国际局势板块，新增"我的关注"（美军大动作筛选） |
| 2026-06-16 | 移除所有硬编码日期/价格，全面动态化；修复 Arena 数据 URL 硬编码问题 |

---

## 技术栈

- **前端**: 原生 HTML/CSS/JS（无框架），约 3000 行
- **后端**: Node.js + Express
- **LLM**: DeepSeek V4 Flash
- **反向代理**: Nginx
- **部署**: 阿里云 ECS（或其他 Linux 服务器）

---

> 📝 本文档最后更新：2026-06-16
