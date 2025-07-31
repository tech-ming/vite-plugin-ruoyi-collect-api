import { writeFileSync } from 'fs';
import { resolve } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import type { Plugin } from 'vite';

interface ApiInfo {
  url: string;
  method: string;
  functionName?: string; // 添加函数名字段
}

interface ViewApiData {
  [viewCategory: string]: {
    [pagePath: string]: Set<string>;
  };
}

interface ApiDefinitions {
  [apiModule: string]: ApiInfo[];
}

const viewApiData: ViewApiData = {};
const apiDefinitions: ApiDefinitions = {}; // 存储API定义
const componentCache = new Map<string, ApiInfo[]>(); // 缓存已处理的组件
const processingStack = new Set<string>(); // 防止循环依赖

// 递归扫描目录中的所有文件
function scanDirectory(dir: string, extensions: string[], exclude: string[] = [], include: string[] = []): string[] {
  const files: string[] = [];
  
  function scan(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    
    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      // 检查排除模式
      if (exclude.some(pattern => fullPath.includes(pattern))) {
        continue;
      }
      
      // 检查包含模式（如果有设置）
      if (include.length > 0 && !include.some(pattern => fullPath.includes(pattern))) {
        continue;
      }
      
      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (extensions.some(ext => item.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }
  
  scan(dir);
  return files;
}

// 分析API文件，提取实际的API定义
function analyzeApiFile(filePath: string, config: Required<CollectApiPluginOptions>): ApiInfo[] {
  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    const apis: ApiInfo[] = [];
    
    // 1. 匹配 export const 格式：export const xxx = ... => request({...})
    const exportConstMatches = code.match(/export\s+const\s+(\w+)\s*=[\s\S]*?request\s*\(\s*\{[\s\S]*?\}\s*\)/g) || [];
    
    exportConstMatches.forEach(match => {
      // 提取函数名
      const functionNameMatch = match.match(/export\s+const\s+(\w+)\s*=/);
      
      // 提取 request 调用部分
      const requestMatch = match.match(/request\s*\(\s*\{([\s\S]*?)\}\s*\)/);
      
      if (functionNameMatch && requestMatch) {
        const functionName = functionNameMatch[1];
        const requestBody = requestMatch[1];
        
        // 从 request 调用中提取 URL 和 method
        const urlMatch = requestBody.match(/url:\s*['"`]([^'"`]+)['"`]/);
        const methodMatch = requestBody.match(/method:\s*['"`]([^'"`]+)['"`]/);
        
        if (urlMatch) {
          const url = urlMatch[1];
          const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
          
          // 处理动态URL（如 '/car/carAuction/' + id）
          const cleanUrl = url.replace(/\s*\+\s*\w+/g, '/{id}');
          
          apis.push({
            url: cleanUrl,
            method: method,
            functionName: functionName
          });
        }
      }
    });
    
    // 2. 匹配 export function 格式：export function xxx(...) { return request({...}) }
    const exportFunctionMatches = code.match(/export\s+function\s+(\w+)\s*\([^)]*\)[\s\S]*?request\s*\(\s*\{[\s\S]*?\}\s*\)/g) || [];
    
    exportFunctionMatches.forEach(match => {
      // 提取函数名
      const functionNameMatch = match.match(/export\s+function\s+(\w+)\s*\(/);
      
      // 提取 request 调用部分
      const requestMatch = match.match(/request\s*\(\s*\{([\s\S]*?)\}\s*\)/);
      
      if (functionNameMatch && requestMatch) {
        const functionName = functionNameMatch[1];
        const requestBody = requestMatch[1];
        
        // 从 request 调用中提取 URL 和 method
        const urlMatch = requestBody.match(/url:\s*['"`]([^'"`]+)['"`]/);
        const methodMatch = requestBody.match(/method:\s*['"`]([^'"`]+)['"`]/);
        
        if (urlMatch) {
          const url = urlMatch[1];
          const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
          
          // 处理动态URL（如 '/system/dict/data/' + dictCode）
          const cleanUrl = url.replace(/\s*\+\s*\w+/g, '/{id}');
          
          apis.push({
            url: cleanUrl,
            method: method,
            functionName: functionName
          });
        }
      }
    });
    
    return apis;
  } catch (error) {
    console.warn(`分析API文件 ${filePath} 时出错:`, (error as Error).message);
    return [];
  }
}

// 扫描并缓存所有API定义
function scanApiDefinitions(rootPath: string, config: Required<CollectApiPluginOptions>) {
  const apiDir = resolve(rootPath, config.apiDir);
  if (!fs.existsSync(apiDir)) return;
  
  const apiFiles = scanDirectory(apiDir, config.extensions, config.exclude, config.include);
  if (config.verbose) {
    console.log(`🔍 扫描API定义文件: ${apiFiles.length} 个`);
  }
  
  apiFiles.forEach(filePath => {
    const apis = analyzeApiFile(filePath, config);
    if (apis.length > 0) {
      // 提取API模块路径
      const apiMatch = filePath.match(new RegExp(`[/\\\\]${config.apiDir.replace('/', '[/\\\\]')}[/\\\\](.+)\\.(js|ts)$`));
      if (apiMatch) {
        const apiModule = apiMatch[1].replace(/\\/g, '/');
        apiDefinitions[apiModule] = apis;
        if (config.verbose) {
          console.log(`  📄 ${apiModule}: ${apis.length} 个API`);
        }
      }
    }
  });
}

// 查找组件导入
function findComponentImports(code: string, currentFilePath: string, config: Required<CollectApiPluginOptions>): string[] {
  const componentPaths: string[] = [];
  const currentDir = path.dirname(currentFilePath);
  const rootPath = process.cwd();
  
  // 1. 匹配 import xxx from "./xxx.vue"
  const relativeImports = code.match(/import\s+\w+\s+from\s+["']\.(.*?)\.vue["']/g) || [];
  relativeImports.forEach(match => {
    const pathMatch = match.match(/from\s+["']\.(.*?)\.vue["']/);
    if (pathMatch) {
      const relativePath = pathMatch[1] + '.vue';
      const fullPath = path.resolve(currentDir, relativePath);
      componentPaths.push(fullPath);
    }
  });
  
  // 2. 匹配 import("./xxx.vue") 动态导入
  const dynamicImports = code.match(/import\s*\(\s*["']\.(.*?)\.vue["']\s*\)/g) || [];
  dynamicImports.forEach(match => {
    const pathMatch = match.match(/import\s*\(\s*["']\.(.*?)\.vue["']\s*\)/);
    if (pathMatch) {
      const relativePath = pathMatch[1] + '.vue';
      const fullPath = path.resolve(currentDir, relativePath);
      componentPaths.push(fullPath);
    }
  });
  
  // 3. 匹配配置的组件目录导入
  config.componentDirs.forEach(({ path: componentDir, alias }) => {
    const importPattern = new RegExp(`import\\s+\\w+\\s+from\\s+["']${alias.replace('@', '\\@')}\\/([^"']+)["']`, 'g');
    const matches = code.match(importPattern) || [];
    
    matches.forEach(match => {
      const pathMatch = match.match(new RegExp(`from\\s+["']${alias.replace('@', '\\@')}\\/([^"']+)["']`));
      if (pathMatch) {
        let componentPath = pathMatch[1];
        
        // 如果没有.vue扩展名，尝试添加
        if (!componentPath.endsWith('.vue')) {
          // 先尝试index.vue
          let fullPath = resolve(rootPath, componentDir, componentPath, 'index.vue');
          if (fs.existsSync(fullPath)) {
            componentPaths.push(fullPath);
          } else {
            // 再尝试直接添加.vue
            fullPath = resolve(rootPath, componentDir, componentPath + '.vue');
            if (fs.existsSync(fullPath)) {
              componentPaths.push(fullPath);
            }
          }
        } else {
          const fullPath = resolve(rootPath, componentDir, componentPath);
          componentPaths.push(fullPath);
        }
      }
    });
  });
  
  // 4. 匹配 import xxx from "@/views/xxx.vue"
  const viewImports = code.match(/import\s+\w+\s+from\s+["']@\/views\/(.*?)\.vue["']/g) || [];
  viewImports.forEach(match => {
    const pathMatch = match.match(/from\s+["']@\/views\/(.*?)\.vue["']/);
    if (pathMatch) {
      const viewPath = pathMatch[1] + '.vue';
      const fullPath = resolve(rootPath, config.viewsDir, viewPath);
      componentPaths.push(fullPath);
    }
  });
  
  return componentPaths;
}

// 处理单个文件的API收集（包含子组件） - 带配置版本
function processFileWithConfig(filePath: string, viteConfig?: any, config?: Required<CollectApiPluginOptions>) {
  try {
    // 提取 views 路径部分，兼容 Windows 和 Unix 路径
    const viewsPattern = new RegExp(`[/\\\\]${config?.viewsDir?.replace('/', '[/\\\\]') || 'views'}[/\\\\](.+)`);
    const viewsMatch = filePath.match(viewsPattern);
    if (!viewsMatch) return;
    
    const fullPath = viewsMatch[1].replace(/\\/g, '/'); // 统一使用 / 分隔符
    
    // 处理页面路径逻辑
    const pathParts = fullPath.split('/');
    let viewCategory: string;
    let pagePath: string;
    
    if (pathParts.length === 1) {
      // 根目录文件
      const fileName = pathParts[0];
      
      // 特殊处理：index.vue 或 defaultIndex.vue 直接显示为 '/'
      if (fileName === 'index.vue' || fileName === 'defaultIndex.vue') {
        viewCategory = '/';
        pagePath = '/';
      } else {
        // 其他根目录文件，去掉 .vue 扩展名作为 viewCategory
        viewCategory = fileName.replace(/\.vue$/, '');
        pagePath = '/';
      }
    } else {
      // 子目录文件，保持原有逻辑，但去掉文件名
      viewCategory = pathParts[0];
      if (pathParts.length === 2) {
        // 如果是二级目录下的文件，如 escortData/index.vue
        pagePath = pathParts[0]; // 只取目录名，不要文件名
      } else {
        // 如果是更深层级的目录，取前两级
        pagePath = pathParts.slice(0, 2).join('/');
      }
    }
    
    // 递归收集所有API（包含子组件）
    const allApis = extractApisFromComponentWithConfig(filePath, new Set(), viteConfig, config);
    
    if (allApis.length > 0) {
      // 初始化视图数据结构
      if (!viewApiData[viewCategory]) {
        viewApiData[viewCategory] = {};
      }
      
      if (!viewApiData[viewCategory][pagePath]) {
        viewApiData[viewCategory][pagePath] = new Set();
      }
      
      // 添加API到对应页面（去重）
      allApis.forEach(api => {
        viewApiData[viewCategory][pagePath].add(JSON.stringify(api));
      });
      
      if (config?.verbose) {
        console.log(`[${viewCategory}] ${pagePath} 发现API: ${allApis.map(api => `${api.method} ${api.url}`).join(', ')}`);
      }
    }
  } catch (error) {
    console.warn(`处理文件 ${filePath} 时出错:`, (error as Error).message);
  }
}

// 解析组件中的API（递归处理子组件） - 带配置版本
function extractApisFromComponentWithConfig(filePath: string, visited: Set<string> = new Set(), viteConfig?: any, config?: Required<CollectApiPluginOptions>): ApiInfo[] {
  // 防止循环依赖
  if (visited.has(filePath) || processingStack.has(filePath)) {
    return [];
  }
  
  // 检查缓存
  if (componentCache.has(filePath)) {
    return componentCache.get(filePath)!;
  }
  
  processingStack.add(filePath);
  visited.add(filePath);
  
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    
    const code = fs.readFileSync(filePath, 'utf-8');
    const apis: ApiInfo[] = [];
    
    // 1. 收集当前组件的直接API
    const directApis = extractDirectApisWithConfig(code, filePath, viteConfig, config);
    apis.push(...directApis);
    
    // 2. 查找子组件引用
    const componentImports = findComponentImports(code, filePath, config || defaultOptions);
    
    // 3. 递归处理子组件
    for (const componentPath of componentImports) {
      const childApis = extractApisFromComponentWithConfig(componentPath, new Set(visited), viteConfig, config);
      apis.push(...childApis);
    }
    
    // 缓存结果
    componentCache.set(filePath, apis);
    processingStack.delete(filePath);
    
    return apis;
  } catch (error) {
    console.warn(`处理组件 ${filePath} 时出错:`, (error as Error).message);
    processingStack.delete(filePath);
    return [];
  }
}

// 提取组件的直接API（不包含子组件） - 带配置版本
function extractDirectApisWithConfig(code: string, filePath: string, viteConfig?: any, config?: Required<CollectApiPluginOptions>): ApiInfo[] {
  const apis: ApiInfo[] = [];
  
  // 1. 直接匹配 url: "/xxx/xxx" 格式
  const urlMatches = code.match(/url:\s*["'](\/[^"']+)["']/g) || [];
  urlMatches.forEach(match => {
    const url = match.replace(/url:\s*["']|["']/g, "");
    apis.push({ url, method: 'UNKNOWN' });
  });
  
  // 2. 匹配所有 API 导入（包括 @/api/xxx 和相对路径）
  const allImportMatches = code.match(/import\s+\{([^}]+)\}\s+from\s+["']([^"']*\/api\/[^"']+)["']/g) || [];
  allImportMatches.forEach(match => {
    const importsMatch = match.match(/import\s+\{([^}]+)\}/);
    const pathMatch = match.match(/from\s+["']([^"']*\/api\/[^"']+)["']/);
    
    if (importsMatch && pathMatch) {
      const importPath = pathMatch[1];
      const apiPath = resolveApiPath(importPath, filePath, viteConfig, config);
      
      if (apiPath) {
        const importedFunctions = importsMatch[1].split(',').map(s => s.trim());
        
        // 检查这些导入的函数是否在代码中被实际调用
        importedFunctions.forEach(funcName => {
          const funcCallRegex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
          if (funcCallRegex.test(code)) {
            // 函数被使用了，查找对应的API定义
            if (apiDefinitions[apiPath]) {
              const matchedApi = findApiByFunctionName(apiDefinitions[apiPath], funcName);
              if (matchedApi) {
                apis.push(matchedApi);
              }
            }
          }
        });
      }
    }
  });
  
  // 3. 匹配单独的 API 导入
  const singleImportMatches = code.match(/import\s+(\w+)\s+from\s+["']([^"']*\/api\/[^"']+)["']/g) || [];
  singleImportMatches.forEach(match => {
    const funcNameMatch = match.match(/import\s+(\w+)\s+from/);
    const pathMatch = match.match(/from\s+["']([^"']*\/api\/[^"']+)["']/);
    
    if (funcNameMatch && pathMatch) {
      const funcName = funcNameMatch[1];
      const importPath = pathMatch[1];
      const apiPath = resolveApiPath(importPath, filePath, viteConfig, config);
      
      if (apiPath) {
        // 检查函数是否被调用
        const funcCallRegex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
        if (funcCallRegex.test(code)) {
          if (apiDefinitions[apiPath]) {
            const matchedApi = findApiByFunctionName(apiDefinitions[apiPath], funcName);
            if (matchedApi) {
              apis.push(matchedApi);
            }
          }
        }
      }
    }
  });
  
  return apis;
}

// 根据函数名匹配对应的API定义
function findApiByFunctionName(apis: ApiInfo[], functionName: string): ApiInfo | null {
  // 优先进行精确的函数名匹配
  for (const api of apis) {
    if (api.functionName === functionName) {
      return api;
    }
  }
  
  // 如果没有找到精确匹配，返回 null
  return null;
}

// 生成文件的函数
function generateApiFile(rootPath: string, config: Required<CollectApiPluginOptions>) {
  // 转换Set为Array以便JSON序列化
  const outputData: { [key: string]: any } = {};
  Object.keys(viewApiData).forEach(viewCategory => {
    // 检查是否应该使用扁平结构
    const pageKeys = Object.keys(viewApiData[viewCategory]);
    const shouldFlatten = (
      // 根目录文件
      (viewCategory === '/' || (pageKeys.length === 1 && pageKeys[0] === '/')) ||
      // 只有一层目录且目录名和分类名相同
      (pageKeys.length === 1 && pageKeys[0] === viewCategory)
    );
    
    if (shouldFlatten) {
      // 使用扁平结构
      const pagePath = pageKeys[0];
      const apis = Array.from(viewApiData[viewCategory][pagePath])
        .map(str => JSON.parse(str) as ApiInfo)
        .sort((a, b) => a.url.localeCompare(b.url));
      outputData[viewCategory] = apis;
    } else {
      // 使用嵌套结构
      outputData[viewCategory] = {};
      Object.keys(viewApiData[viewCategory]).forEach(pagePath => {
        const apis = Array.from(viewApiData[viewCategory][pagePath])
          .map(str => JSON.parse(str) as ApiInfo)
          .sort((a, b) => a.url.localeCompare(b.url));
        outputData[viewCategory][pagePath] = apis;
      });
    }
  });
  
  // 生成文件到指定目录
  const outputPath = resolve(rootPath, config.outputPath);
  writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
  
  const totalViews = Object.keys(outputData).length;
  const totalPages = Object.values(outputData).reduce((acc, view) => {
    if (Array.isArray(view)) {
      return acc + 1; // 扁平结构算作1页
    } else {
      return acc + Object.keys(view).length;
    }
  }, 0);
  const totalApis = Object.values(outputData).reduce((acc, view) => {
    if (Array.isArray(view)) {
      return acc + view.length; // 扁平结构直接是API数组
    } else {
      return acc + Object.values(view).reduce((pageAcc, apis: any) => pageAcc + apis.length, 0);
    }
  }, 0);
  if(config.verbose){
    console.log(`\n📋 API收集完成:`);
    console.log(`   📁 视图区分: ${totalViews} 个`);
    console.log(`   📄 页面总数: ${totalPages} 个`);
    console.log(`   🔗 API总数: ${totalApis} 个`);
    console.log(`   💾 文件已生成: ${outputPath}`);
  }
}

export interface CollectApiPluginOptions {
  /**
   * API 定义文件的根目录
   * @default 'src/api'
   */
  apiDir?: string;
  
  /**
   * Vue 组件的根目录
   * @default 'src/views'
   */
  viewsDir?: string;
  
  /**
   * 组件目录配置，支持多个目录和别名映射
   * @default [
   *   { path: 'src/components', alias: '@/components' },
   *   { path: 'src/apiComponents', alias: '@/apiComponents' }
   * ]
   */
  componentDirs?: Array<{
    path: string;
    alias: string;
  }>;
  
  /**
   * 输出文件路径
   * @default 'public/api-collection.json'
   */
  outputPath?: string;
  
  /**
   * 支持的文件扩展名
   * @default ['.vue', '.js', '.ts']
   */
  extensions?: string[];
  
  /**
   * API 文件名模式
   * @default ['index.ts', 'index.js']
   */
  apiFilePatterns?: string[];
  
  /**
   * 路径别名配置
   * @default { '@': 'src' }
   */
  alias?: Record<string, string>;
  
  /**
   * 是否启用详细日志
   * @default false
   */
  verbose?: boolean;
  
  /**
   * 自定义 API 提取规则
   */
  customExtractors?: {
    /**
     * 自定义函数调用匹配规则
     */
    functionCallPatterns?: RegExp[];
    
    /**
     * 自定义导入匹配规则
     */
    importPatterns?: RegExp[];
    
    /**
     * 自定义 URL 匹配规则
     */
    urlPatterns?: RegExp[];
  };
  
  /**
   * 排除的目录或文件模式
   */
  exclude?: string[];
  
  /**
   * 只包含的目录或文件模式
   */
  include?: string[];
}

// 解析路径别名和相对路径为实际的API路径
function resolveApiPath(importPath: string, currentFilePath: string, viteConfig?: any, config?: Required<CollectApiPluginOptions>): string | null {
  const apiDirName = config?.apiDir?.split('/').pop() || 'api';
  
  // 处理 @/api/xxx 格式
  if (importPath.startsWith(`@/${apiDirName}/`)) {
    return importPath.replace(`@/${apiDirName}/`, '');
  }
  
  // 处理相对路径，如 ../../api/xxx
  if (importPath.includes(`/${apiDirName}/`)) {
    const apiIndex = importPath.lastIndexOf(`/${apiDirName}/`);
    const apiPath = importPath.substring(apiIndex + apiDirName.length + 2); // 跳过 '/api/'
    return apiPath;
  }
  
  // 如果有别名配置，检查自定义别名
  const aliasConfig = config?.alias || {};
  for (const [alias, resolvedPath] of Object.entries(aliasConfig)) {
    if (importPath.startsWith(alias)) {
      const replacedPath = importPath.replace(alias, resolvedPath);
      if (replacedPath.includes(`/${apiDirName}/`)) {
        const apiIndex = replacedPath.lastIndexOf(`/${apiDirName}/`);
        return replacedPath.substring(apiIndex + apiDirName.length + 2);
      }
    }
  }
  
  // 如果有 Vite 别名配置
  if (viteConfig?.resolve?.alias) {
    for (const [alias, resolvedPath] of Object.entries(viteConfig.resolve.alias)) {
      if (typeof resolvedPath === 'string' && importPath.startsWith(alias)) {
        const replacedPath = importPath.replace(alias, resolvedPath);
        if (replacedPath.includes(`/${apiDirName}/`)) {
          const apiIndex = replacedPath.lastIndexOf(`/${apiDirName}/`);
          return replacedPath.substring(apiIndex + apiDirName.length + 2);
        }
      }
    }
  }
  
  return null;
}

// 默认配置
const defaultOptions: Required<CollectApiPluginOptions> = {
  apiDir: 'src/api',
  viewsDir: 'src/views',
  componentDirs: [
    { path: 'src/components', alias: '@/components' },
  ],
  outputPath: 'public/api-collection.json',
  extensions: ['.vue', '.js', '.ts'],
  apiFilePatterns: ['index.ts', 'index.js'],
  alias: { '@': 'src' },
  verbose: false,
  customExtractors: {
    functionCallPatterns: [],
    importPatterns: [],
    urlPatterns: []
  },
  exclude: [],
  include: []
};

// 合并配置
function mergeOptions(options: CollectApiPluginOptions): Required<CollectApiPluginOptions> {
  return {
    ...defaultOptions,
    ...options,
    componentDirs: options.componentDirs || defaultOptions.componentDirs,
    customExtractors: {
      ...defaultOptions.customExtractors,
      ...options.customExtractors
    }
  };
}

export default function collectApiPlugin(options: CollectApiPluginOptions = {}): Plugin {
  let viteConfig: any;
  const config = mergeOptions(options);
  
  return {
    name: "vite-plugin-collect-api",
    enforce: 'pre',
    configResolved(resolvedConfig) {
      // 保存 Vite 配置，包括路径别名
      viteConfig = resolvedConfig;
    },
    buildStart() {
      const rootPath = process.cwd();
      
      // 清空之前的数据
      Object.keys(viewApiData).forEach(key => delete viewApiData[key]);
      Object.keys(apiDefinitions).forEach(key => delete apiDefinitions[key]);
      componentCache.clear();
      processingStack.clear();
      
      // 首先扫描API定义
      scanApiDefinitions(rootPath, config);
      
      // 然后扫描views目录
      const viewsDir = resolve(rootPath, config.viewsDir);
      if (config.verbose) {
        console.log('🔍 开始扫描 views 目录:', viewsDir);
      }
      
      const files = scanDirectory(viewsDir, config.extensions, config.exclude, config.include);
      if (config.verbose) {
        console.log(`📁 找到 ${files.length} 个文件，开始分析API使用...`);
      }
      
      // 将 viteConfig 和 config 传递给处理函数
      files.forEach(filePath => processFileWithConfig(filePath, viteConfig, config));
      
      // 立即生成文件（适用于开发模式）
      generateApiFile(rootPath, config);
    },
    buildEnd() {
      // 构建结束时也生成一次（适用于生产构建）
      generateApiFile(process.cwd(), config);
    },
  };
}