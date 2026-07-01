import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type Mode = "compile" | "build" | "typecheck";

const mode = process.argv[2] as Mode | undefined;
const lockDir = path.resolve(import.meta.dirname, "../.paraglide-lock");

function assertMode(value: Mode | undefined): asserts value is Mode {
  if (value !== "compile" && value !== "build" && value !== "typecheck") {
    throw new Error("Usage: bun scripts/with-paraglide.ts <compile|build|typecheck>");
  }
}

function run(command: string, args: string[]) {
  const result = Bun.spawnSync([command, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

async function acquireLock() {
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockDir);
      return;
    } catch (error) {
      if (Date.now() - startedAt > 120_000) {
        const stat = statSync(lockDir, { throwIfNoEntry: false });
        if (stat && Date.now() - stat.mtimeMs > 120_000) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      }

      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      await sleep(120);
    }
  }
}

assertMode(mode);
await acquireLock();

try {
  run("paraglide-js", [
    "compile",
    "--project",
    "../../project.inlang",
    "--outdir",
    "./src/paraglide",
    "--strategy",
    "localStorage",
    "preferredLanguage",
    "baseLocale",
    "--emit-ts-declarations",
  ]);

  if (mode === "build") {
    run("tsc", ["-p", "tsconfig.json"]);
  }

  if (mode === "typecheck") {
    run("tsc", ["--noEmit", "-p", "tsconfig.json"]);
  }
} finally {
  rmSync(lockDir, { recursive: true, force: true });
}
