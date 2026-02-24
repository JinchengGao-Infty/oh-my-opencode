# OmO 魔改版维护手册

**维护者**: Sisyphus (Claude Opus 4.6)
**分支**: feat/hydra-native
**上游**: code-yeongyu/oh-my-opencode (dev)
**Fork**: JinchengGao-Infty/oh-my-opencode

---

## 项目概况

这是 oh-my-opencode 的魔改 fork，在上游基础上增加了 Hydra 原生功能：
- Worktree 隔离（`isolation: "worktree"`）— 子 Agent 在独立 git worktree 工作
- Hydra Task 依赖系统 — 任务间声明依赖，DFS 循环检测，失败级联
- Worktree Diff/Merge — 查看子 Agent 改动并合并回主分支

魔改 commit（4 个）：
1. `0ade392c` feat: add worktree isolation with optional git worktree support
2. `d1028a06` feat: add worktree diff/merge tools with registry persistence
3. `f6ffbded` feat: add hydra task dependency system with cycle detection and failure propagation
4. `bf185640` fix: harden hydra reason escaping and worktree safety checks

---

## 硬编码修改

### TASK_TTL_MS = 1 小时
- 文件: `src/features/background-agent/constants.ts`
- 原因: GPT 5.2 xhigh thinking 可能跑超过 30 分钟
- 注意: 这个不走配置文件，是硬编码常量

---

## 配置架构

### 三台机器

| 机器 | 系统 | kiro baseURL | zerogravity baseURL | codex baseURL |
|------|------|-------------|---------------------|---------------|
| 本机 (当前) | macOS | https://kiro.infty.my/v1 (Cloudflare) | https://antigravity.infty.my/v1 | https://codex.infty.my/v1 |
| 另一台 Mac | macOS | http://localhost:8002/v1 (本地反代) | http://localhost:8741/v1 | https://codex.infty.my/v1 |
| Linux 机器 | Linux | https://kiro.infty.my/v1 (Cloudflare) | https://antigravity.infty.my/v1 | https://codex.infty.my/v1 |

### Provider 用途

| Provider | 协议 | 模型 | 用途 |
|----------|------|------|------|
| kiro / kiro-copy | Anthropic | Claude Opus 4.6 | 主力模型（Sisyphus、Explore、Librarian） |
| codex | OpenAI | GPT-5.2 | 重型编码（Hephaestus、Oracle、ultrabrain、deep） |
| zerogravity / zerogravity-copy | OpenAI 兼容 | Gemini / Claude | 多模型网关（multimodal-looker） |
| minmax | Anthropic 兼容 | MiniMax M2 系列 | MiniMax 模型 |

### Agent → Provider 映射

| Agent | Provider/Model | 角色 |
|-------|---------------|------|
| sisyphus | kiro/claude-opus-4-6 | 主力编码 + 调度 |
| hephaestus | codex/gpt-5.2 (xdeep) | 深度自主工作 |
| oracle | codex/gpt-5.2 (xdeep) | 架构顾问（只读） |
| explore | kiro/claude-opus-4-6 | 代码库探索（只读） |
| librarian | kiro/claude-opus-4-6 | 外部文档搜索（只读） |
| multimodal-looker | zerogravity/gemini-3-flash | 截图/UI 分析（只读） |

### Category 路由

| Category | Model | 用途 |
|----------|-------|------|
| ultrabrain | codex/gpt-5.2 (xhigh) | 最强编码 |
| deep | codex/gpt-5.2 (xhigh) | 严谨推理 |
| quick | kiro/claude-opus-4-6 | 简单快速 |
| visual-engineering | kiro/claude-opus-4-6 | 前端/UI |

---

## 三层超时配置

| 超时 | 值 | 位置 | 说明 |
|------|-----|------|------|
| TASK_TTL_MS | 1h (3600000ms) | 硬编码 constants.ts | 任务绝对寿命 |
| staleTimeoutMs | 1h (3600000ms) | oh-my-opencode.jsonc | 有进度后无活动判定 |
| messageStalenessTimeoutMs | 1h (3600000ms) | oh-my-opencode.jsonc | 从启动起无产出判定 |

---

## 插件清单

| 插件 | 安装方式 | 位置 |
|------|---------|------|
| oh-my-opencode (魔改) | 本地 wrapper | ~/.config/opencode/plugins/oh-my-opencode.js → ~/oh-my-opencode-jincheng/dist/index.js |
| superpowers | git clone + symlink | ~/.config/opencode/superpowers/ |
| @tarquinen/opencode-dcp | npm DCP | ~/.config/opencode/node_modules/ |

---

## 配置文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| opencode.json | ~/.config/opencode/opencode.json | Provider 定义 |
| oh-my-opencode.jsonc | ~/.config/opencode/oh-my-opencode.jsonc | OmO 插件配置 |
| instructions.md | ~/.config/opencode/instructions.md | 全局指令 |
| wrapper | ~/.config/opencode/plugins/oh-my-opencode.js | 动态路径 wrapper |

---

## 交接包

位置: `/Users/gaojincheng/Desktop/opencode-setup-kit/`

```
opencode-setup-kit/
├── setup.sh                  # 一键安装（自动选 Mac/Linux 配置）
├── opencode-mac.json         # Mac: kiro=localhost, zerogravity=localhost
├── opencode-linux.json       # Linux: kiro=Cloudflare, zerogravity=Cloudflare
├── oh-my-opencode.jsonc      # OmO 配置（通用）
├── oh-my-opencode-wrapper.js # 动态路径 wrapper
├── instructions.md           # 全局指令
└── README.md                 # 部署文档
```

---

## 常用操作

### 合并上游更新
```bash
cd ~/oh-my-opencode-jincheng
git fetch upstream
git merge upstream/dev --no-edit
# 解决冲突时保留 hydra 相关文件
bun install && bun run build
git push origin feat/hydra-native
```

### 更新配置后
必须关闭所有 OpenCode 实例再重启（server 模式下配置启动时加载）。

### 启动
```bash
opencode --port 4096
```

---

## 已知问题

### GPT xdeep 长思考超时（已缓解）
- 症状: 子 Agent 调用 GPT 5.2 xdeep 时大量 0-token 请求
- 原因: 反代层 streaming 超时
- 缓解: 自建反代 codex.infty.my (One-API)，可自行调超时
- 三层 OmO 超时已调至 1 小时

### 配置修改需全量重启
- OpenCode --port 模式是 server 模式，配置在启动时加载
- 改了配置必须关掉所有连接同一 server 的实例再重启

---

## Oracle Code Review 要点（2026-02-24）

- CRITICAL: 不受信任 repo 可通过 project-scoped skills 注入 prompt
- IMPORTANT: Config migration 会丢 JSONC 注释
- IMPORTANT: Hook 执行无 fault isolation
- IMPORTANT: manager.ts 2300 行 god file
- 总体: 143k LOC 架构异常干净
