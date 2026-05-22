import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { spawnSync } from "node:child_process";

const binaryExtensions = new Set([
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".zip",
]);

const blockedContent = [
  { name: "Cyrillic text", pattern: /[\u0400-\u04FF]/u },
  { name: "private Windows user path", pattern: /\b[A-Z]:[\\/]Users[\\/]sav\b/iu },
  { name: "private tools path", pattern: /\bF:[\\/]Tools[\\/]CODEX\b/iu },
  { name: "private LAN address", pattern: /\b10\.10\.\d{1,3}\.\d{1,3}\b/u },
  { name: "personal placeholder", pattern: new RegExp(`${["Al", "exei"].join("")} ${["Sak", "harov"].join("")}|${["Sav", "workspace"].join("_")}`, "u") },
];

const tracked = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
if (tracked.status !== 0) {
  process.stderr.write(`Unable to list tracked files:\n${tracked.stderr}`);
  process.exit(tracked.status ?? 1);
}

const violations = [];

for (const file of tracked.stdout.split(/\r?\n/).filter(Boolean)) {
  if (!existsSync(file)) {
    continue;
  }
  if (/^\.codex-tmp-/.test(file)) {
    violations.push(`${file}: tracked scratch file`);
  }
  if (binaryExtensions.has(extname(file).toLowerCase())) {
    continue;
  }

  const buffer = readFileSync(file);
  if (buffer.includes(0)) {
    continue;
  }

  const content = buffer.toString("utf8");
  for (const rule of blockedContent) {
    if (rule.pattern.test(content)) {
      violations.push(`${file}: ${rule.name}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Public hygiene failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

console.log("Public hygiene passed");
