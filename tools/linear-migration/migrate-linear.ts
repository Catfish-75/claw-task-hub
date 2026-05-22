import { backfillLinearDescriptions, importLinear } from "./linear-import.js";

const [, , command = "help", ...args] = process.argv;

function readNumberFlag(name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const raw = args[index + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function usage() {
  process.stdout.write(`Claw Task Hub Linear migration tool

Usage:
  npm run migrate:linear -- import --pages 1000
  npm run migrate:linear -- backfill-descriptions --limit 500
  npm run migrate:linear -- help

Safety:
  Set CLAW_TASK_HUB_ALLOW_LINEAR_IMPORT=1 only for a planned one-off migration window.
  Keep normal Claw Task Hub API, MCP, and hub CLI free of Linear migration calls.
`);
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  if (command === "help" || command === "--help" || command === "-h") {
    usage();
  } else if (command === "import") {
    printJson(await importLinear(readNumberFlag("--pages", 1000)));
  } else if (command === "backfill-descriptions") {
    printJson(await backfillLinearDescriptions(readNumberFlag("--limit", 500)));
  } else {
    usage();
    throw new Error(`Unknown migration command: ${command}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
