import type { Command } from '../../commands.js'

// 上游仓库缺失 /plan 命令源码（作者本地全局 .gitignore 忽略了 plan/ 目录），
// 全新克隆后 bun run build 会被 Build guard 拦下、pnpm install 失败。
// 本项目只通过 SDK 驱动 Agent，不使用交互式 /plan 命令，这里给一个禁用的占位命令。
const plan = {
  type: 'local',
  name: 'plan',
  description: 'Plan mode toggle (not available in this build)',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({
    call: async () => ({ type: 'text', value: 'plan 命令在此构建中不可用' }),
  }),
} satisfies Command

export default plan
