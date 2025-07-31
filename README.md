# @vite-plugin-ruoyi-collect-api

ruoyi框架 一个 Vite 插件，用于自动收集 Vue 组件中的 API 使用情况并生成 API 集合文件。

## 功能特性

- 自动扫描 Vue 组件中的 API 使用
- 递归处理子组件
- 从 API 文件中提取 API 定义
- 生成完整的 API 集合 JSON 文件
- 支持 TypeScript 和 JavaScript 文件

## 使用方法

在你的 `vite.config.ts` 中添加：

```typescript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import collectApiPlugin from "@vite-plugin-collect-api";

export default defineConfig({
  plugins: [vue(), collectApiPlugin()],
});
```

## 工作原理

1. **API 定义扫描**：扫描 `src/api` 目录中的 API 定义
2. **组件分析**：递归分析 `src/views` 中的 Vue 组件
3. **API 使用检测**：检测 API 导入和函数调用
4. **子组件处理**：跟踪组件导入以构建完整的 API 使用映射
5. **文件生成**：在 `public/api-collection.json` 中创建收集到的数据

## 输出格式

插件生成的 JSON 文件结构如下：

```json
{
  "视图分类": {
    "页面路径": [
      {
        "url": "/api/endpoint",
        "method": "GET"
      }
    ]
  }
}
```

## 配置选项

插件支持丰富的配置选项，可以根据项目需求进行自定义：

```typescript
collectApiPlugin({
  // API 定义文件的根目录
  apiDir: "src/api",

  // Vue 组件的根目录
  viewsDir: "src/views",

  // 组件目录配置，支持多个目录和别名映射
  componentDirs: [
    { path: "src/components", alias: "@/components" },
    { path: "src/shared", alias: "@/shared" },
  ],

  // 输出文件路径
  outputPath: "public/api-collection.json",

  // 支持的文件扩展名
  extensions: [".vue", ".js", ".ts"],

  // API 文件名模式
  apiFilePatterns: ["index.ts", "index.js"],

  // 路径别名配置
  alias: { "@": "src" },

  // 是否启用详细日志
  verbose: true,

  // 自定义 API 提取规则
  customExtractors: {
    // 自定义函数调用匹配规则
    functionCallPatterns: [/customApiCall\s*\(/g],

    // 自定义导入匹配规则
    importPatterns: [/import.*from\s+["']@\/custom\/.*["']/g],

    // 自定义 URL 匹配规则
    urlPatterns: [/baseURL:\s*["']([^"']+)["']/g],
  },

  // 排除的目录或文件模式
  exclude: ["node_modules", "dist", ".git"],

  // 只包含的目录或文件模式（可选）
  include: ["src"],
});
```

### 配置选项详解

#### 基础路径配置

- **`apiDir`**: API 定义文件的根目录，默认为 `'src/api'`
- **`viewsDir`**: Vue 组件的根目录，默认为 `'src/views'`
- **`outputPath`**: 生成的 JSON 文件输出路径，默认为 `'public/api-collection.json'`

#### 组件目录配置

- **`componentDirs`**: 支持配置多个组件目录，每个目录可以设置对应的别名
  ```typescript
  componentDirs: [
    { path: "src/components", alias: "@/components" },
    { path: "src/widgets", alias: "@/widgets" },
  ];
  ```

#### 文件处理配置

- **`extensions`**: 支持的文件扩展名数组，默认为 `['.vue', '.js', '.ts']`
- **`apiFilePatterns`**: API 文件名匹配模式，默认为 `['index.ts', 'index.js']`

#### 路径别名配置

- **`alias`**: 自定义路径别名映射，会与 Vite 配置中的别名合并使用

#### 调试和日志

- **`verbose`**: 启用详细日志输出，方便调试和查看处理过程

#### 高级配置

- **`customExtractors`**: 自定义 API 提取规则

  - `functionCallPatterns`: 自定义函数调用匹配规则
  - `importPatterns`: 自定义导入语句匹配规则
  - `urlPatterns`: 自定义 URL 匹配规则

- **`exclude`/`include`**: 文件过滤配置
  - `exclude`: 排除指定的目录或文件模式
  - `include`: 只处理指定的目录或文件模式

### 使用示例

#### 基础使用

```typescript
import collectApiPlugin from "@vite-plugin-collect-api";

export default defineConfig({
  plugins: [
    vue(),
    collectApiPlugin(), // 使用默认配置
  ],
});
```

#### 自定义配置

```typescript
export default defineConfig({
  plugins: [
    vue(),
    collectApiPlugin({
      apiDir: "src/services",
      outputPath: "dist/api-docs.json",
      verbose: true,
      componentDirs: [
        { path: "src/components", alias: "@/components" },
        { path: "src/business", alias: "@/business" },
      ],
    }),
  ],
});
```

## 系统要求

- Node.js >= 16
- Vite >= 4.0.0
- 项目结构需包含 `src/api` 和 `src/views` 目录

## 许可证

MIT
