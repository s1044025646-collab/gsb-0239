# uni-table-layout — Unicode 定宽文本表格排版后端

本地纯文本表格排版服务：输入列定义、表头、行数据与每列显示宽度，输出带 ASCII 边框（`+ - |`）的文本表格，并返回每个单元格实际占用的输出行及显示宽度。**只做 API 与 CLI，不做 HTML/PDF/字体渲染，不读取或控制真实终端。**

技术栈：TypeScript + Node.js（内置 `node:sqlite`），SQLite 落库，零 Docker / WSL / 外部在线服务依赖。

## 环境要求

- Windows 本地 PowerShell；Node.js **>= 22.5**（开发验证版本 Node v25.5.0）。
- SQLite 使用 Node 内置实验模块，运行命令统一带 `--experimental-sqlite`（npm 脚本已封装）。

## 安装与构建

```powershell
npm install
npm run build     # tsc 编译到 dist/
npm test          # 19 个测试：排版、持久化、HTTP API
npm run demo      # 端到端演示（创建/导入/预览/存版本/查单元格/导出）
npm start         # 启动 HTTP API；默认自动选择空闲端口，打印实际地址
```

指定端口：`npm run dev -- --port 8080` 或 `$env:PORT=8080; npm start`。
数据文件默认在项目内 `data/tables.sqlite`，可用环境变量 `TABLE_DB_PATH` 覆盖。

## 显示宽度口径（重要假设）

- 宽度单位是**终端显示列**，不是 JavaScript `.length`、UTF-16 码元或码点数。
- 字素分割使用 Node 内置 **Intl.Segmenter**（grapheme 簇）：UTF-16 代理对、组合附标、ZWJ 表情序列不会被拆开。
- 显示宽度使用 [`string-width@7`](https://github.com/sindresorhus/string-width)（Unicode East Asian Width + emoji 数据）：
  - 中文/日文/韩文等宽字符与常见 emoji = **2 列**；
  - 普通 ASCII、组合附标（不占独立宽）按库规则；
  - **模糊宽度（Ambiguous）字符统一按窄宽 = 1 列**处理（例如 `·`、部分全角标点的模糊归类）。这是本题固定口径，版本中记录为 `ambiguous=narrow(1)`。
- 不承诺适配所有终端字体；若某字体把某字符渲染成不同宽度，输出以该口径为准。

## 换行与对齐规则

- **确定性贪心换行**：按字素簇顺序填充，放入后宽度超过列宽就在该字素簇前换行；不做按词回退（超长英文词因此也能安全逐字符断开）。
- 仅 `\n` 是显式换行：
  - 空字符串 / `null` / `undefined` => 1 个空行；
  - `"a\nb"` => 两段；`"a\n"` => `a` 加**一个显式尾部空行**（保留）；连续 `\n` 产生显式空行。
- 对齐：`left`（默认）/ `center` / `right`，用空格填充；居中剩余奇数空格时**左侧 floor、右侧 ceil**，保证右边框整齐。
- 同一逻辑行内各单元格按最高者**补齐到相同高度**（补空白行），表头与数据使用同一套规则。
- 某个完整字素簇宽度超过列宽时，返回错误 `GRAPHEME_TOO_WIDE`，**绝不截断或超宽输出**。
- 明确拒绝（`UNSUPPORTED_CHARACTER`）：制表符、`\r`、ESC（ANSI/CSI 序列）、NEL 及其他 C0/C1 控制符，避免隐藏光标/回车覆盖等终端副作用。
- 校验错误：数据行列数与列定义不符 => `ROW_COLUMN_MISMATCH`；宽度必须是 >=1 的整数 => `INVALID_WIDTH`；对齐值非法 => `INVALID_ALIGN`。

## CLI

```powershell
node --experimental-sqlite dist/cli.js render samples/demo.json
node dist/cli.js help   # 完整命令列表（serve 同样需要 --experimental-sqlite）
```

常用：`create` / `import` / `preview` / `cell` / `save` / `versions` / `export` / `serve`。
例：

```powershell
node --experimental-sqlite dist/cli.js render samples/demo.json --out data/preview.txt
$t = (Get-Content $null -Raw | Out-Null) # id 来自 create 的 JSON 输出
node --experimental-sqlite dist/cli.js save <tableId>
node --experimental-sqlite dist/cli.js export <tableId> --version 1 --out data/out.txt
```

## HTTP API（均为 JSON，错误形如 `{"error":{"code","message","details"}}`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/render` | 临时渲染，不落库 |
| POST | `/api/tables` | 创建配置+数据，返回 UUID |
| GET | `/api/tables/:id` | 查看原始配置与数据 |
| PUT | `/api/tables/:id` | 替换配置+数据（先校验） |
| POST | `/api/tables/:id/import` | 仅替换行数据 `{"rows":[...]}` |
| POST | `/api/tables/:id/preview` | 基于当前数据渲染 |
| POST | `/api/tables/:id/versions` | 渲染并保存一个**不可变版本** |
| GET | `/api/tables/:id/versions` | 版本列表 |
| GET | `/api/tables/:id/versions/:v` | `v` 为数字或 `latest` |
| GET | `/api/tables/:id/cells/:rowIndex/:columnKeyOrIndex` | 单元格分行/宽度/填充 |
| GET | `/api/tables/:id/export/:v?` | 导出 `text/plain; charset=utf-8` |
| GET | `/health` | 健康检查 |

```powershell
# PowerShell 示例
Invoke-RestMethod -Uri http://127.0.0.1:<port>/api/render -Method Post `
  -ContentType 'application/json; charset=utf-8' `
  -InFile samples/demo.json
```

## SQLite 结构

- `tables(id, config_json, created_at, updated_at)`：保存**原始**列定义与数据，不用修改原文伪装对齐。
- `versions(id, table_id, version, width_rule, layout_params_json, result_json, created_at)`：
  保存宽度规则版本、排版参数（列宽/对齐/换行策略/模糊口径）与渲染结果；重启后可直接导出历史结果。

## 样例

- `samples/demo.json`：中英文混排、组合重音、ZWJ 表情、长英文词、多行/空行备注，三种对齐。
- `samples/demo-narrow.json`：同一批内容收窄列宽后的重排对比。
- `samples/rows.json`：CLI `import` 用数据。

## 错误码

`INVALID_CONFIG` / `EMPTY_COLUMNS` / `DUPLICATE_COLUMN_KEY` / `INVALID_WIDTH` / `INVALID_ALIGN` /
`ROW_COLUMN_MISMATCH` / `UNSUPPORTED_CHARACTER` / `GRAPHEME_TOO_WIDE` / `INVALID_DATA` /
`NOT_FOUND` / `BAD_REQUEST`（HTTP 400；`NOT_FOUND` 为 404）。

## 已知限制

- 模糊宽度固定 narrow(1)，不按终端 locale 切换；不做词边界/连字符断行。
- `node:sqlite` 在当前 Node 版本带实验警告；边框仅 ASCII 一种样式。
- 服务仅监听 `127.0.0.1`，无鉴权（定位为本地单机工具）。
