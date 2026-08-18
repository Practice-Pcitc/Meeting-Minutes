# 会议纪要系统部署文档

> 文档版本：2026-08-14  
> 服务器公网 IP：`182.92.96.173`  
> 服务器部署目录：`/opt/meeting-minutes`  
> 最终部署包：`meeting-minutes-deploy-login-mindmap.tar.gz`

## 1. 系统结构

本项目由前后端两部分组成：

- `meeting-minutes-vue`：Vue 3 前端，由 Vite 构建，构建结果位于 `dist`。
- `meeting-minutes-server`：NestJS 后端，默认监听 `3000` 端口。
- Nginx：监听公网 `80` 端口，提供前端静态文件，并将 `/api/` 转发到 NestJS。
- PM2：在后台运行后端进程，并负责崩溃重启和开机启动。
- 数据文件：保存在后端的 `data` 目录中。
  - `data/state.json`：会议、人员、记录、待办、标签和座位数据。
  - `data/auth.json`：用户、密码散列、登录会话和用户配置的 AI 供应商凭据。

访问链路：

```text
浏览器 http://182.92.96.173
              │
              ▼
         Nginx :80
          ├── /       → meeting-minutes-vue/dist
          └── /api/   → NestJS 127.0.0.1:3000
```

## 2. 部署前准备

### 2.1 本地项目位置

```text
D:\新建文件夹\OneDrive\文档\ChatGPT\8.06\meeting-minutes-project
```

最终部署包位置：

```text
D:\新建文件夹\OneDrive\文档\ChatGPT\8.06\meeting-minutes-deploy-login-mindmap.tar.gz
```

### 2.2 本地构建检查

以下命令在本地 PowerShell 执行。

检查后端：

```powershell
cd "D:\新建文件夹\OneDrive\文档\ChatGPT\8.06\meeting-minutes-project\meeting-minutes-server"
npm install
npm run build
```

检查前端：

```powershell
cd "D:\新建文件夹\OneDrive\文档\ChatGPT\8.06\meeting-minutes-project\meeting-minutes-vue"
npm install --cache .npm-cache
npm run build
```

两边都没有红色错误并显示构建成功后，才继续上传。

## 3. 首次初始化阿里云服务器

如果服务器已经安装 Node.js、npm、Nginx 和 PM2，可跳到第 4 节。

### 3.1 登录服务器

在本地 PowerShell 执行：

```powershell
ssh root@182.92.96.173
```

出现下面的提示时输入 root 密码：

```text
root@182.92.96.173's password:
```

输入密码时屏幕不会显示星号或其他字符，这是 SSH 的正常安全行为。

成功后会看到类似：

```text
[root@aliyun ~]#
```

只有出现该提示符后，才能执行后续 Linux 命令。

### 3.2 安装运行环境

以下命令在服务器中执行：

```bash
dnf install -y nodejs npm nginx
```

检查版本：

```bash
node -v
npm -v
nginx -v
```

当前已验证可用的环境示例：

```text
Node.js v20.20.2
npm 10.8.2
Nginx 1.24.0
```

安装 PM2：

```bash
npm install -g pm2
pm2 -v
```

创建部署目录：

```bash
mkdir -p /opt/meeting-minutes
```

## 4. 阿里云安全组配置

进入阿里云 ECS 控制台：

1. 进入“实例与镜像 → 实例”。
2. 找到公网 IP 为 `182.92.96.173` 的实例。
3. 打开实例关联的安全组。
4. 进入“入方向规则”。
5. 添加 HTTP 规则。

规则内容：

| 配置项 | 内容 |
|---|---|
| 授权策略 | 允许 |
| 协议 | TCP |
| 端口 | `80/80` |
| 来源 | `0.0.0.0/0` |
| 描述 | 会议纪要 HTTP |

安全建议：

- 不要将后端 `3000` 端口开放到公网，后端只由 Nginx 访问。
- SSH 的 `22` 端口尽量只允许管理员自己的公网 IP，不建议长期对 `0.0.0.0/0` 开放。
- 配置 HTTPS 后，再开放 `443/443`。
- AI 总结不需要新增入方向端口，但服务器需要能够通过出方向 HTTPS（TCP 443）访问所配置的模型供应商。

## 5. 上传部署包

### 5.1 从本地上传

退出服务器或新开一个本地 PowerShell 窗口，执行：

```powershell
scp "D:\新建文件夹\OneDrive\文档\ChatGPT\8.06\meeting-minutes-deploy-login-mindmap.tar.gz" root@182.92.96.173:/opt/meeting-minutes/
```

看到类似下面的信息表示上传成功：

```text
meeting-minutes-deploy-login-mindmap.tar.gz  100%  98KB
```

### 5.2 在服务器上确认文件

重新登录服务器：

```powershell
ssh root@182.92.96.173
```

然后在服务器执行：

```bash
ls -lh /opt/meeting-minutes/meeting-minutes-deploy-login-mindmap.tar.gz
```

注意：`ls -lh` 是 Linux 命令，不能直接在本地 Windows PowerShell 中执行。

## 6. 首次部署应用

### 6.1 解压

在服务器中执行：

```bash
cd /opt/meeting-minutes
tar -xzf meeting-minutes-deploy-login-mindmap.tar.gz
```

检查目录：

```bash
ls -la /opt/meeting-minutes
```

应看到：

```text
meeting-minutes-server
meeting-minutes-vue
```

### 6.2 安装并构建后端

```bash
cd /opt/meeting-minutes/meeting-minutes-server
npm install
npm run build
```

首次启动后端：

```bash
pm2 start npm --name meeting-minutes-api -- run start:prod
pm2 save
```

配置 PM2 开机启动：

```bash
pm2 startup systemd -u root --hp /root
pm2 save
```

检查状态：

```bash
pm2 status
```

正常状态应显示：

```text
meeting-minutes-api    online
```

查看后端日志：

```bash
pm2 logs meeting-minutes-api --lines 100
```

按 `Ctrl + C` 退出日志查看，不会停止 PM2 后端进程。

### 6.3 检查后端接口

```bash
curl -i http://127.0.0.1:3000/api/state
```

用户登录功能启用后，未携带登录令牌时返回下面的结果是正常的：

```text
HTTP/1.1 401 Unauthorized
```

它表示后端已经启动，并且接口鉴权已经生效。

### 6.4 安装并构建前端

```bash
cd /opt/meeting-minutes/meeting-minutes-vue
npm install
npm run build
```

检查构建结果：

```bash
ls -lh dist
```

应看到 `index.html` 和 `assets` 目录。

## 7. 配置 Nginx

创建站点配置：

```bash
cat > /etc/nginx/conf.d/meeting-minutes.conf <<'EOF'
server {
    listen 80;
    server_name 182.92.96.173;

    root /opt/meeting-minutes/meeting-minutes-vue/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
```

检查配置语法：

```bash
nginx -t
```

正常结果：

```text
syntax is ok
test is successful
```

启用并重启 Nginx：

```bash
systemctl enable --now nginx
systemctl restart nginx
```

检查运行状态：

```bash
systemctl status nginx --no-pager
```

## 8. 部署完成后的验证

### 8.1 服务器内部验证

检查前端：

```bash
curl -I -H "Host: 182.92.96.173" http://127.0.0.1/
```

应返回：

```text
HTTP/1.1 200 OK
```

检查登录保护：

```bash
curl -i -H "Host: 182.92.96.173" http://127.0.0.1/api/state
```

应返回：

```text
HTTP/1.1 401 Unauthorized
```

使用 `Host` 请求头是为了确保命中会议纪要的 Nginx 配置，而不是服务器上的其他域名站点。

### 8.2 公网验证

浏览器打开：

```text
http://182.92.96.173
```

如果仍显示旧页面，按 `Ctrl + F5` 强制刷新缓存。

### 8.3 首次注册

1. 点击“立即注册”。
2. 设置用户名、显示名称和至少 8 位密码。
3. 第一个注册成功的用户会自动接收升级前的历史纪要。
4. 其他用户注册后拥有各自独立的会议空间，不能查看第一个用户的数据。

建议部署完成后立即由管理员注册第一个账号。

### 8.4 功能检查清单

- [ ] 可以注册账号。
- [ ] 可以登录和退出。
- [ ] 刷新页面后保持登录。
- [ ] 可以新建多份会议纪要。
- [ ] 可以检索和打开历史会议。
- [ ] 不同账号的数据互相隔离。
- [ ] 可以添加人员和会议记录。
- [ ] 可以添加待办事项。
- [ ] 座位图可以点击网格分配人员。
- [ ] 思维导图显示“会议 → 主题 → 记录”树形结构。
- [ ] 思维导图可以滚轮缩放和拖动画布。
- [ ] 思维导图可以展开、收起主题和重置视图。
- [ ] 删除等操作使用系统自定义确认组件，而不是浏览器默认弹窗。

## 9. 后续版本更新流程

更新部署必须先备份服务器数据。

### 9.1 上传新版本

在本地 PowerShell 执行：

```powershell
scp "D:\新建文件夹\OneDrive\文档\ChatGPT\8.06\meeting-minutes-deploy-login-mindmap.tar.gz" root@182.92.96.173:/opt/meeting-minutes/
```

### 9.2 备份数据

登录服务器后执行：

```bash
cd /opt/meeting-minutes
mkdir -p backups

cp -a meeting-minutes-server/data \
"backups/data-$(date +%Y%m%d-%H%M%S)"
```

列出备份：

```bash
ls -lah backups
```

### 9.3 解压更新包

```bash
cd /opt/meeting-minutes
tar -xzf meeting-minutes-deploy-login-mindmap.tar.gz
```

正式升级包不包含 `meeting-minutes-server/data`，因此正常解压不会覆盖会议和账号数据。

### 9.4 更新后端

```bash
cd /opt/meeting-minutes/meeting-minutes-server
npm install
npm run build
pm2 restart meeting-minutes-api
pm2 save
pm2 status
```

如果旧进程没有名称，也可以使用进程 ID：

```bash
pm2 restart 0
```

### 9.5 更新前端

```bash
cd /opt/meeting-minutes/meeting-minutes-vue
npm install
npm run build
```

### 9.6 重载 Nginx

```bash
nginx -t
systemctl reload nginx
```

## 10. 日常运维命令

### 后端状态

```bash
pm2 status
```

### 后端日志

```bash
pm2 logs meeting-minutes-api --lines 100
```

### 重启后端

```bash
pm2 restart meeting-minutes-api
pm2 save
```

### Nginx 状态

```bash
systemctl status nginx --no-pager
```

### Nginx 日志

```bash
tail -n 100 /var/log/nginx/access.log
tail -n 100 /var/log/nginx/error.log
```

### 检查监听端口

```bash
ss -lntp | grep -E ':80|:3000'
```

正常情况下：

- Nginx 监听 `0.0.0.0:80`。
- Node.js 监听 `0.0.0.0:3000` 或 `127.0.0.1:3000`。
- 阿里云安全组只需要对公网开放 `80`，不需要开放 `3000`。

### 检查磁盘数据

```bash
ls -lh /opt/meeting-minutes/meeting-minutes-server/data
```

## 11. 数据备份与恢复

### 11.1 手动备份

```bash
cd /opt/meeting-minutes
mkdir -p backups
cp -a meeting-minutes-server/data \
"backups/data-$(date +%Y%m%d-%H%M%S)"
```

### 11.2 恢复备份

先查看可用备份：

```bash
ls -lah /opt/meeting-minutes/backups
```

停止后端：

```bash
pm2 stop meeting-minutes-api
```

将下面的备份目录名替换为真实名称：

```bash
mv /opt/meeting-minutes/meeting-minutes-server/data \
/opt/meeting-minutes/meeting-minutes-server/data.before-restore

cp -a /opt/meeting-minutes/backups/data-20260814-120000 \
/opt/meeting-minutes/meeting-minutes-server/data
```

恢复后启动：

```bash
pm2 restart meeting-minutes-api
pm2 save
```

确认数据正常后，再决定是否删除 `data.before-restore`。不要在未验证恢复结果前删除它。

## 12. 常见问题排查

### 12.1 PowerShell 执行 `ls -lh` 报错

原因：当前仍在 Windows PowerShell，`ls -lh` 是 Linux 命令。

解决：

```powershell
ssh root@182.92.96.173
```

看到 `[root@aliyun ~]#` 后再执行 `ls -lh`。

### 12.2 SSH 输入密码时没有显示

这是正常现象。输入完整密码后直接按回车。

### 12.3 `Permission denied`

常见原因：

- root 密码错误。
- 输入法或大小写错误。
- SSH 登录策略发生变化。

重新执行：

```powershell
ssh root@182.92.96.173
```

### 12.4 网站完全打不开

按顺序检查：

```bash
pm2 status
systemctl status nginx --no-pager
nginx -t
curl -I -H "Host: 182.92.96.173" http://127.0.0.1/
```

同时检查阿里云安全组是否允许 TCP `80/80`。

如果服务器启用了 firewalld：

```bash
systemctl is-active firewalld
```

如果返回 `active`，放行 HTTP：

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --reload
```

### 12.5 页面可以打开，但接口失败

检查后端：

```bash
pm2 status
pm2 logs meeting-minutes-api --lines 100
curl -i http://127.0.0.1:3000/api/state
```

检查 Nginx 代理：

```bash
curl -i -H "Host: 182.92.96.173" http://127.0.0.1/api/state
```

未登录返回 `401` 是正常结果；`502 Bad Gateway` 通常表示后端没有启动或没有监听 `3000` 端口。

### 12.6 浏览器仍显示旧版页面

先确认前端已经重新构建：

```bash
ls -lh /opt/meeting-minutes/meeting-minutes-vue/dist
```

然后重载 Nginx：

```bash
nginx -t
systemctl reload nginx
```

浏览器按 `Ctrl + F5` 强制刷新。

### 12.7 思维导图为空

思维导图根据会议记录自动生成：

1. 进入纪要页面。
2. 添加至少一条会议记录。
3. 给记录选择或填写主题。
4. 打开“思维导图视图”。

没有设置主题的记录会归到“未分类”。

### 12.8 PM2 重启服务器后没有自动运行

重新执行：

```bash
pm2 startup systemd -u root --hp /root
pm2 save
systemctl is-enabled pm2-root
```

应返回：

```text
enabled
```

## 13. 回滚方案

更新后如果页面或接口异常：

1. 保留当前故障现场和日志。
2. 重新解压上一个可用部署包。
3. 执行 `npm install` 和构建。
4. 恢复更新前的数据备份。
5. 重启 PM2 和 Nginx。

后端重启：

```bash
pm2 restart meeting-minutes-api
pm2 save
```

前端与 Nginx：

```bash
cd /opt/meeting-minutes/meeting-minutes-vue
npm run build
nginx -t
systemctl reload nginx
```

验证：

```bash
curl -I -H "Host: 182.92.96.173" http://127.0.0.1/
curl -i -H "Host: 182.92.96.173" http://127.0.0.1/api/state
```

## 14. 安全注意事项

- 不要在文档、聊天记录或代码中保存服务器 root 密码。
- 不要将 `data/auth.json` 上传到代码仓库；该文件可能包含用户配置的 AI API Key，备份文件也应限制访问权限。
- 不要将 `3000`、数据库或管理端口直接开放到公网。
- 定期备份整个 `meeting-minutes-server/data` 目录。
- SSH 端口应限制可信来源 IP。
- 正式长期使用时，建议绑定域名并配置 HTTPS。
- 如果服务器提供公开注册，部署完成后应尽快注册首个管理员账号。

## 15. 本次最终功能

- 多会议纪要与历史检索。
- 用户注册、登录、退出和登录状态保持。
- 每个用户的数据独立隔离。
- 旧会议数据自动归属首个注册用户。
- 自定义通知和确认弹窗。
- Grid 方块式座位图和人员颜色映射。
- 面包屑导航。
- 用户级 AI 供应商管理、默认供应商设置和持久化 AI 会议总结。
- 紧凑时间轴布局。
- Vue 3 + Apache ECharts 树形思维导图。
- 思维导图支持缩放、拖拽、展开、收起和重置视图。
