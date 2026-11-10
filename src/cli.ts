export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2);
  }
}

export class AuthError extends CliError {
  constructor(message: string) {
    super(message, 3);
  }
}

export interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        values.set(arg.slice(2, eq), arg.slice(eq + 1));
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        values.set(key, next);
        i += 1;
      } else {
        flags.add(key);
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (["-n", "-o", "-r", "-c"].includes(arg)) {
        const next = argv[i + 1];
        if (!next) throw new UsageError(`Missing value for ${arg}`);
        const key = { "-n": "max", "-o": "offset", "-r": "region", "-c": "chat" }[arg]!;
        values.set(key, next);
        i += 1;
      } else {
        for (const char of arg.slice(1)) flags.add(char);
      }
      continue;
    }
    positionals.push(arg);
  }

  return { flags, values, positionals };
}

export function requireNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new UsageError(`Invalid number: ${raw}`);
  }
  return value;
}
