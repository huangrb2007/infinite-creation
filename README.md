<div align="center">

# 短剧制作 Studio

**把小说 / 剧本做成带配音的 AI 短剧：云端 ComfyUI 与 RH 号池出片，Agent 全流程编排。**

基于 [SwotAtmk/infinite-creation](https://github.com/SwotAtmk/infinite-creation)（Agent 无限创作）二次创作 · MIT

</div>

> **致谢与署名**
> 本项目 fork 自 **SwotAtmk** 的开源项目 [infinite-creation](https://github.com/SwotAtmk/infinite-creation)，核心的 Agent 流水线、分镜/资产/成片管理、技能系统均来自原作者，版权与 MIT 授权声明保留在 [LICENSE](LICENSE)。原项目说明见 [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md)。
> `skills/` 与 `vendor/` 下的第三方内容遵循各自的许可证。

## 这个分支做了什么

原项目面向「本机显卡 + 本地 ComfyUI」，工作流和节点编号写在代码里。这个分支面向**云端出片**和**短剧生产**：

### 1. 云端 ComfyUI：自动读取你保存的工作流

- 在「设置 → 工作流」里刷新，直接读取云端 ComfyUI 里已保存的工作流（`user/default/workflows`），**不用导出 API 格式**，界面格式会在本地自动转换。
- 按文件夹自动归类，适配常见的字母前缀整理方式（如 `U视频-MINIMAX-H3`、`N声音生成…`、`J视频-对口型数字人`、`P视频-动作迁移`），可以只读取指定系列。
- 8 个类别各选一个工作流给流水线用：**视频、文生图、图生图、音色设计、声音克隆、背景音乐、数字人、动作迁移**。不选则用项目自带的工作流。
- 参数自动识别：MiniMax H3（Easy / Ref2V / T8）、Qwen-Image 2.1、Qwen3-TTS / FishAudio、MiniMax Music3 / ACE-Step 等节点直接认出提示词、种子、时长、参考素材槽。识别不准时，在 ComfyUI 里给节点标题加标签即可，例如 `正向提示词 #prompt`、`参考图 #image1`。
- 刷新时用云端的节点定义静态校验每个工作流（缺节点、缺必填参数、下拉值不合法），有问题的标「需确认」，不用真跑一次才发现。

### 2. RH 号池

- 号池里的工作流和云端工作流一起出现在各类别里，可混用（比如视频走号池并发、图片走云端 ComfyUI）。
- 素材上传、幂等提交、进度轮询、下载校验与确认都按号池协议处理；按号池并发同时出片。

### 3. 云端模式下的并行

原项目为了避免本机显存冲突，整条流水线严格串行。用云端 ComfyUI 时没有这个限制：下一集写剧本、拆分镜的同时，上一集可以在出片。

### 4. 技能编排更好用

- 每个技能显示一句中文用途，鼠标停留看完整说明；默认只列出适用于当前环节、能全自动运行的技能。
- 去掉了系统提示词里写死的技能映射，**面板上选什么，Agent 就用什么**。
- 默认流水线不再挂要求「逐项询问用户」的技能，避免和全自动流程冲突。

### 5. 其他

- 修复：全新克隆后 `pnpm install` 构建 Agent 内核失败（上游 `.gitignore` 误伤了 `/plan` 命令源码）。
- 界面与 Agent 改为「短剧制作」。

## 快速开始

前置：Node.js ≥ 22、pnpm ≥ 9、Bun、ffmpeg。

```bash
git clone https://github.com/huangrb2007/infinite-creation.git
cd infinite-creation
pnpm install
pnpm run dev          # 打开 http://127.0.0.1:4710
```

然后：

1. **设置 → ComfyUI 服务**：填云端 ComfyUI 地址（如 AutoDL 的 `https://…seetacloud.com:8443`），测试连接。
2. **设置 → 工作流**：填要读取的系列，「保存配置」后点「刷新工作流目录」，在各类别里选工作流。
3. （可选）启用 RH 号池：填号池地址和连接校验码，测试连接后刷新。
4. **设置 → LLM 模型**：填 OpenAI 兼容接口（如 DeepSeek）。
5. 新建项目，导入小说或剧本，开始生成。

Windows 一键安装包在规划中。

## 路线图

- [x] 云端 ComfyUI 工作流自动读取、归类、识别与校验
- [x] RH 号池接入
- [x] 技能面板中文说明与按环节过滤
- [ ] 动作迁移接入分镜流程
- [ ] 按集总览、审核点（剧本 / 资产 / 分镜可选人工确认）、待办一键处理
- [ ] Windows exe 安装包（GitHub Actions 自动打包）

## 许可证

MIT。原作者 SwotAtmk 的版权声明见 [LICENSE](LICENSE)；本分支的修改同样以 MIT 发布。
