/**
 * 服务端专用：从 cwd 向上查找最近的 .env 并补进 process.env（已存在的变量
 * 不覆盖）。bun 只自动加载 cwd 下的 .env、tsx 完全不加载，apps/* 里启动的
 * 服务读不到仓库根 .env 时会静默回退到本地默认值（本地 MinIO/DB）。
 *
 * 只能在服务端入口 `import "@sharebrain/config/dotenv"`，且要放在其他业务
 * import 之前；浏览器端禁止引入（依赖 node:fs）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function parseDotenv(content: string) {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([\w.]+)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    result[match[1]!] = value;
  }

  return result;
}

export function loadNearestDotenv() {
  let dir = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    const file = join(dir, ".env");
    if (existsSync(file)) {
      try {
        for (const [key, value] of Object.entries(parseDotenv(readFileSync(file, "utf8")))) {
          if (process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
      } catch {
        // 读取失败按无 .env 处理，走 schema 默认值。
      }
      return;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

loadNearestDotenv();
