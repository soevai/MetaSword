<h1 align="center">⚔️ 次元剑（MetaSword）</h1>

一款基于 Electron 的安全工具集成平台，聚合逆向分析与渗透测试工具链，支持多主题切换、插件扩展 — 免配置，开箱即用。

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.9-orange" alt="Version" />
  <img src="https://img.shields.io/badge/Electron-blue?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/platform-Windows-blue?logo=windows" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/status-active-success" alt="Status" />
  <img src="https://img.shields.io/badge/Author-VoxShadow-orange?logo=github" alt="Author" />
</p>

<p align="center">
  <img src="https://www.52tt.pro/usr/uploads/2026/01/1627329843.png" width="100%" alt="MetaSword Logo"/>
</p>

## 预览

### 次元・起源

<p align="center">
  <img src="https://www.52tt.pro/usr/uploads/2025/08/2006586841.png" alt="起源主题" width="55%" />
</p>

### 次元・紫雅・灰

<p align="center">
  <img src="https://pic1.imgdb.cn/item/69cdd7870d45b9ceac41894f.png" alt="紫雅灰主题" width="55%" />
</p>

### 工具分类

<p align="center">
  <img src="https://pic1.imgdb.cn/item/69ccf5ed0d45b9ceac3e3a05.webp" alt="工具分类" width="55%" />
</p>

## 功能

- 🔰 逆向分析 — 集成 IDA Pro、x64dbg、dnSpy、Cheat Engine，一站式反汇编与调试
- 🏳️ 渗透测试 — 集成 Burp Suite、Yakit、Tscan、ez，护网打点、协议分析、CTF 全覆盖
- 🏳️‍🌈 多主题 — 起源 / 紫雅 / 紫雅灰 / 灵梦 / 封面 / Fate 六套主题，随心切换
- 🍭 插件扩展 — Claude AI、CLI 终端、Frida 动态插桩，能力随插件延伸
- 👤 极简 UI — 初学者友好，高阶用户效率最大化

## 为什么写这个工具箱

市面上的安全工具散落各处——IDA 在桌面上，Burp 在任务栏里，x64dbg 在开始菜单，每次切工具都像在翻垃圾堆。这个项目的目标是：**把常用工具聚到一个启动台里，同时保持界面不丑**。

核心逻辑在 `Core/MetaSword.js` 里，工具配置 MCP 化。没有花里胡哨的架构，就是一个 Electron 窗口 + 分类标签 + 工具列表。主题系统独立在 `Theme/` 下，换主题就是换 CSS，不碰逻辑。Frida 和 Claude 插件按需加载，不影响启动速度。

如果你只是想要一个干净的安全工具启动器，不用每次手动翻文件夹，这个可能适合你。

## 跑起来

### 1. 环境

- Windows 10+
- 目标工具需自行安装（IDA Pro、x64dbg、Burp Suite 等），MetaSword 只做聚合启动

### 2. 启动

```bash
cd app
npm install
npm start
```

> 部分内置工具路径可在设置中自定义，指向你本机的安装位置。

## 项目结构

```
MetaSword/
├── app/
│   ├── Core/
│   │   ├── MetaSword.js          # 主进程入口
│   │   └── MCPFunc.js            # 工具注册与启动函数
│   ├── Nexus/
│   │   ├── Views/
│   │   │   ├── Home.html         # 首页
│   │   │   ├── ControL.html      # 控制面板
│   │   │   ├── ToolPanel.html    # 工具面板
│   │   │   ├── Frida.html        # Frida 插件页
│   │   │   ├── AddTool.html      # 自定义工具页
│   │   │   ├── Dialog.html       # 弹窗组件
│   │   │   ├── Logo.html         # Logo 页
│   │   │   └── config/
│   │   │       ├── Config.xml    # 工具配置
│   │   │       └── prompt.json   # AI 提示词
│   │   ├── CSS/
│   │   │   ├── MetaMain.css      # 主样式
│   │   │   ├── ControLMain.css   # 控制面板样式
│   │   │   ├── FridaMain.css     # Frida 插件样式
│   │   │   ├── AddTool.css       # 自定义工具样式
│   │   │   └── MetaLogo.css      # Logo 样式
│   │   ├── JS/
│   │   │   ├── MainFunc.js       # 主逻辑
│   │   │   ├── AddTool.js        # 自定义工具逻辑
│   │   │   ├── FridaFunc.js      # Frida 交互逻辑
│   │   │   ├── FridaEditor.js    # Frida 脚本编辑器
│   │   │   ├── DeepSeek.js       # DeepSeek AI 集成
│   │   │   ├── AceMain/          # Ace 代码编辑器（完整包）
│   │   │   └── prismjs/          # Prism 语法高亮
│   │   ├── Fonts/                # 字体文件
│   │   └── Assets/               # 图标 & 静态资源
│   ├── Plugins/
│   │   ├── claude/
│   │   │   ├── CLAUDE.md         # Claude Code 配置
│   │   │   └── Need.txt          # 依赖说明
│   │   ├── CLI/
│   │   │   └── Need.txt          # 依赖说明
│   │   └── Frida/
│   │       ├── Exten/Need.txt    # Frida 扩展依赖
│   │       └── Script/Demo.js    # Frida 示例脚本
│   ├── Theme/
│   │   ├── Cover/                # 主题封面图（6 套）
│   │   ├── Origin/               # 起源主题（CSS + Views + Assets）
│   │   ├── Ziya/                 # 紫雅主题
│   │   ├── Ziya Grey/            # 紫雅灰主题
│   │   ├── Reimu/                # 灵梦主题
│   │   ├── Fate/                 # Fate 主题
│   │   └── themes.json           # 主题注册表
│   └── package.json
├── LICENSE                       # MIT
└── README.md
```

## 内置工具

### 逆向分析

| 工具 | 说明 |
|------|------|
| IDA Pro | 反汇编与静态分析 |
| x64dbg | 动态调试 |
| dnSpy | .NET 逆向与调试 |
| Cheat Engine | 内存扫描与修改 |

### 渗透测试

| 工具 | 说明 |
|------|------|
| Burp Suite | Web 渗透测试代理 |
| Yakit | 国产网络空间测绘与渗透平台 |
| Tscan | 综合漏洞扫描 |
| ez | 轻量级渗透工具集 |

## 主题

| 主题 | 说明 |
|------|------|
| 起源（Origin） | 默认主题，干净简洁 |
| 紫雅（Ziya） | 深紫色调，暗色护眼 |
| 紫雅灰（Ziya Grey） | 紫雅变体，灰调收敛 |
| 灵梦（Reimu） | 东方主题色 |
| 封面（Cover） | 杂志封面风格 |
| Fate | Fate 系列主题 |

## 常见问题

**启动报错？** 确认 Node.js 已安装，`npm install` 无报错。部分插件依赖 Python / Frida 环境，不影响核心功能启动。

**工具点了没反应？** MetaSword 只做启动聚合，对应工具需要你自行安装并在设置中配置路径。

**怎么加自己的工具？** 编辑 `MCPFunc.js` 注册新工具条目，支持自定义图标、分类和启动命令。

**主题不生效？** 检查 `themes.json` 注册是否完整，CSS 文件是否在对应主题目录下。

## 项目发展

[![Star History Chart](https://api.star-history.com/svg?repos=soevai/MetaSword&type=Date&theme=light&DateInterval=Monthly)](https://star-history.com/#soevai/MetaSword&Date)

## 作者留言

> **次元剑的力量，是使用者的勇气与智慧。**  
> 江湖路远，愿你执剑，走向更远的地方。

## 免责声明

本软件仅供安全研究和学习用途，使用者在下载、安装或运行本软件时，即视为同意以下条款：

- 禁止将本软件用于任何违反法律法规的行为（包括但不限于未授权渗透、入侵系统、窃取数据等）
- 使用者应自行确保对目标系统拥有合法测试授权
- 本软件聚合的第三方工具（IDA Pro、Burp Suite 等）受其各自的许可证约束，使用者应自行获取合法授权
- 作者不参与使用者的任何活动，对使用者行为造成的任何后果不承担法律责任

使用本软件即表示你已阅读并同意上述条款。

## 许可证

MIT License · Copyright (c) 2023–2026 [VoxShadow (发光的神)](https://github.com/soevai) · 字节暗流实验室

## Logo

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=rect&color=ffffff&height=130&text=⚔️%20MetaSword&fontColor=0a0a0a&fontAlignY=40&desc=次元剑%20-%20逆流而上%20⧉%20字节暗流实验室&descSize=15&descAlignY=70" style="width: 100%;" />
</p>
