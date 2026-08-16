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
- 多段录音、可缩放录音时间轴和精准跳转播放
- 真实麦克风音量波形与录音输入源选择
- 本地 FunASR ONNX 流式转写、停顿分句和长录音 VAD 分段转写
- 用户级默认语音引擎设置，支持本地 FunASR 与 OpenAI

## 技术栈

- 前端：Vue 3、Vite、Apache ECharts
- 后端：NestJS、Node.js
- 本地语音识别：FunASR ONNX、Paraformer、FSMN-VAD、WebSocket
- 数据存储：JSON 文件
- 生产部署：Nginx、PM2、阿里云 ECS

## 项目结构

```text
Meeting-Minutes/
├── meeting-minutes-vue/       # Vue 3 前端
├── meeting-minutes-server/    # NestJS 后端
├── scripts/                   # 本地语音服务启停脚本
├── tools/                     # FunASR ONNX 服务与 uv 项目
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

如需使用 OpenAI 云端转写，请复制 `meeting-minutes-server/.env.example` 为 `.env`，并填写服务端 `OPENAI_API_KEY`。密钥只由后端读取，不会发送到浏览器。

另开终端启动前端：

```bash
cd meeting-minutes-vue
npm install
npm run dev
```

前端开发服务器会把 `/api` 代理到 `http://localhost:3000`。

## 本地 FunASR 转写

项目默认使用轻量的 FunASR ONNX CPU 服务，不依赖 CUDA 或 PyTorch。Python 版本和依赖由 [uv](https://docs.astral.sh/uv/) 根据 `tools/pyproject.toml` 与 `tools/uv.lock` 统一管理；启动时会自动创建并同步 `tools/.venv`。

### Windows

安装 uv：

```powershell
winget install --id astral-sh.uv -e
```

启动和停止：

```powershell
.\scripts\start-funasr-onnx.ps1
.\scripts\stop-funasr-onnx.ps1
```

### Linux

安装 uv：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

重新打开终端或加载 shell 配置后启动：

```bash
sh ./scripts/start-funasr-onnx.sh
sh ./scripts/stop-funasr-onnx.sh
```

### macOS

可通过 Homebrew 或官方安装器安装 uv：

```bash
brew install uv
# 或：curl -LsSf https://astral.sh/uv/install.sh | sh
```

启动和停止方式与 Linux 相同：

```bash
sh ./scripts/start-funasr-onnx.sh
sh ./scripts/stop-funasr-onnx.sh
```

如需仅同步依赖而不启动服务：

```bash
uv sync --project tools --locked
```

首次启动会由 uv 安装兼容的 Python 3.11 或 3.12，并从 ModelScope 下载 Paraformer 中文识别、中文标点和 FSMN-VAD 模型。Python 依赖与模型均会在后续启动时复用。

健康检查地址：`http://127.0.0.1:10095/health`。

登录后点击左下角用户头像，进入“语音转写设置”，选择 `FunASR（本地）`，接口地址填写：

```text
http://127.0.0.1:10095/v1/audio/transcriptions
```

录音时，前端通过 AudioWorklet 采集 PCM 并使用 WebSocket 实时显示当前句。停顿后句子会被确认并固定；连续讲话会按上限自动切段。结束录音时优先保存实时确认文本，不会自动用长文件结果覆盖。用户主动重新转写完整录音时，服务会先通过 FSMN-VAD 检测发言区间，再分段识别并按时间顺序合并。

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

运行数据保存在 `meeting-minutes-server/data`，其中可能包含会议内容、账号、录音和会话。该目录已被 `.gitignore` 排除，请勿将其中的文件提交到代码仓库。

本地虚拟环境、模型运行日志、Python 缓存以及历史重型环境备份也已被忽略。不要提交 `tools/.venv`、`.funasr-onnx`、`.funasr-heavy-backup`、`.runtime`、`__pycache__` 或模型文件；需要提交 `tools/uv.lock` 以保证跨平台依赖可复现。

