# Meeting Minutes

一个基于 Vue 3 和 NestJS 的多人会议纪要系统，支持用户数据隔离、多会议归档、参会人员管理、待办事项、座位图和交互式树形思维导图。

## 功能

- 用户注册、登录、退出和会话保持
- 不同账号的会议数据独立隔离
- 多份会议纪要与历史检索
- 时间轴、发言人、主题和思维导图视图
- 待办事项、标签与参会人员管理
- Grid 方块式座位图
- 基于 Apache ECharts 的可缩放树形思维导图
- 自定义通知与确认弹窗

## 技术栈

- 前端：Vue 3、Vite、Apache ECharts
- 后端：NestJS、Node.js
- 数据存储：JSON 文件
- 生产部署：Nginx、PM2、阿里云 ECS

## 项目结构

```text
meeting-minutes-project/
├── meeting-minutes-vue/       # Vue 3 前端
├── meeting-minutes-server/    # NestJS 后端
└── docs/
    └── DEPLOYMENT.md          # 完整部署文档
```

## 本地运行

安装并启动后端：

```bash
cd meeting-minutes-server
npm install
npm run start:dev
```

后端默认地址：`http://localhost:3000`。

另开终端启动前端：

```bash
cd meeting-minutes-vue
npm install
npm run dev
```

前端开发服务器会把 `/api` 代理到 `http://localhost:3000`。

## 生产构建

```bash
cd meeting-minutes-server
npm install
npm run build

cd ../meeting-minutes-vue
npm install
npm run build
```

完整的阿里云部署、更新、备份、恢复和故障排查流程见 [部署文档](docs/DEPLOYMENT.md)。

## 数据安全

运行数据保存在 `meeting-minutes-server/data`，其中可能包含会议内容、账号和会话。该目录已被 `.gitignore` 排除，请勿将其中的 JSON 文件提交到代码仓库。

