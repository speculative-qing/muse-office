# Muse 办公室

一个常驻的个人工作空间：打开就能看到 AI 助理的工作状态墙、待发作品流水线、各业务线的进展和待拍板事项，不用翻聊天记录。

## 功能板块

- **老板大屏（状态墙）**：各条业务线的当前状态一屏总览
- **发布流水线**：待发作品从制作到发布的流转状态
- **业务桌**：每条业务线一张桌，各自的进展与下一步
- **待拍板收件箱**：需要老板定夺的事项，每件可「拍板通过／打回重做／去掉」
- **3D 办公室**：Three.js 真 3D 工位视图（`client/src/Office3D.tsx`）

数据不与外部平台实时同步，由助理在每次办完事后回填，每项带更新时间。

## 技术栈

- 前端：React 19 + Three.js + Recharts + Tailwind CSS 4（`client/`）
- 服务端：Bun + Drizzle ORM + SQLite（`server/`，表结构见 `drizzle/`）
- 构建：`bun run build`（先 build:server 再 build:client）

## 说明

- 本仓库是该空间的**源码快照**，不包含运行数据（app.db 未上传）。
- 源码原本运行在 Muse 空间运行时上，`package.json` 中的 `@hatch/space-sdk` 为本地运行时依赖，独立部署时需自行替换或适配。
