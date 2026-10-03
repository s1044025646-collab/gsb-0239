// 开发/测试用：让 Node 原生 TypeScript 类型擦除能解析源码中的 "./x.js" -> "./x.ts"。
// 构建产物 dist/ 中是真实 .js 文件，不需要此钩子。
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const hookCode = `
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    specifier.endsWith('.js') &&
    context.parentURL
  ) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
    }
  }
  return nextResolve(specifier, context);
}
`;

const dataUrl =
  'data:text/javascript;base64,' + Buffer.from(hookCode, 'utf-8').toString('base64');

register(dataUrl, pathToFileURL('./'));
