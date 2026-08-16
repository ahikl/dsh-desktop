# dsh-desktop

[English](README.en.md) | 简体中文

> DeepSeek Harness 桌面端插件：使用 Electron 包装 dsh Web UI，提供系统托盘与自定义标题栏。

## 简介

`dsh-desktop` 是一个 out-of-tree 桌面端插件，不修改 dsh 源码，也不把 Electron 引入 dsh 依赖树。

## 功能

- 使用 Electron 加载 dsh Web UI
- 无边框窗口 + dsh 风格标题栏，自动跟随主题
- 系统托盘：显示主窗口、打开浏览器、退出
- 关闭窗口时最小化到托盘
- URL 解析优先级：`--url` > Web Server 端口 > `dashboard.html`

## 工作原理

通过 `cordis.patch.yml` 挂载两个插件：

- **desktop-startup**：解析 `dsh desktop` 参数，提供 `webStartup` / `desktopStartup` 服务
- **desktop-runner**：等待树稳定后，解析 URL 和 Electron 路径，并以子进程方式启动 Electron

## 使用

```sh
dsh plugin --profile desktop add @ahikl/dsh-desktop @deepseek-ai/dsh-web-app
dsh plugin --profile desktop add electron
dsh --profile desktop desktop

dsh --profile desktop --url https://example.com
```

## 配置

```yaml
- id: desktop-runner
  config:
    url: https://example.com
    electronPath: /opt/electron/electron
    width: 1280
    height: 800
    electronArgs: ["--no-sandbox", "--disable-gpu"]
```

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test        # 单元测试
pnpm run build       # 构建到 lib/
```

## 目录结构

```text
dsh-desktop/
├── cordis.patch.yml        # bundle patch
├── src/
│   ├── index.ts            # desktop-runner 插件
│   ├── launcher.ts         # Electron 解析与启动逻辑
│   └── startup.ts          # desktop-startup 插件
├── electron-main.cjs       # Electron 主进程
├── preload.cjs             # 自定义标题栏预加载脚本
├── dashboard.html          # 兜底页面
├── tests/                  # 单元测试
└── package.json
```

## 许可证

[MIT](./LICENSE)
