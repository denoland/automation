// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

export async function runCommand(params: {
  cwd: string;
  cmd: string[];
}) {
  const p = Deno.run({
    cwd: params.cwd,
    cmd: params.cmd,
    stderr: "piped",
    stdout: "piped",
  });

  const [status, stdout, stderr] = await Promise.all([
    p.status(),
    p.output(),
    p.stderrOutput(),
  ]);
  p.close();

  if (!status.success) {
    throw new Error(
      `Error executing ${params.cmd[0]}: ${new TextDecoder().decode(stderr)}`,
    );
  }

  return new TextDecoder().decode(stdout);
}

export async function runCommandWithOutput(params: {
  cwd: string;
  cmd: string[];
}) {
  const p = Deno.run({
    cwd: params.cwd,
    cmd: params.cmd,
    stderr: "inherit",
    stdout: "inherit",
  });

  const status = await p.status();
  p.close();

  if (!status.success) {
    throw new Error(
      `Error executing ${params.cmd[0]}. Code: ${status.code}`,
    );
  }
}

export async function withRetries<TReturn>(params: {
  action: () => Promise<TReturn>;
  retryCount: number;
  retryDelaySeconds: number;
}) {
  for (let i = 0; i < params.retryCount; i++) {
    if (i > 0) {
      console.log(
        `Failed. Trying again in ${params.retryDelaySeconds} seconds...`,
      );
      await delay(params.retryDelaySeconds * 1000);
      console.log(`Attempt ${i + 1}/${params.retryCount}...`);
    }
    try {
      return await params.action();
    } catch (err) {
      console.error(err);
    }
  }

  throw new Error(`Failed after ${params.retryCount} attempts.`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function existsSync(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export class GitLogOutput {
  #output: string;

  constructor(output: string) {
    this.#output = output;
  }

  get outputText() {
    return this.#output;
  }

  formatForReleaseMarkdown() {
    const IGNORED_COMMIT_PREFIX = [
      "build",
      "chore",
      "ci",
      "docs",
      "refactor",
      "test",
    ];
    return this.#output.split(/\r?\n/)
      .map((line) => line.replace(/^[a-f0-9]{9} /i, "").trim())
      .filter((l) => {
        return !IGNORED_COMMIT_PREFIX.some((prefix) => l.startsWith(prefix)) &&
          l.length > 0;
      })
      .sort()
      .map((line) => `- ${line}`)
      .join("\n");
  }
}
