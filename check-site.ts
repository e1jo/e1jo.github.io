/**
 * Static site health checker.
 *
 * Checks the basics that are easy to miss on a small HTML website:
 * - required files
 * - document language, title, description and H1
 * - duplicate IDs
 * - missing local files referenced by href/src
 *
 * Run with Node.js 22.6+:
 *   node --experimental-strip-types check-site.ts
 *
 * Or with tsx:
 *   npx tsx check-site.ts
 */

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

type Severity = "error" | "warning";

interface Finding {
  severity: Severity;
  message: string;
}

const ROOT = process.cwd();
const findings: Finding[] = [];

function report(severity: Severity, message: string): void {
  findings.push({ severity, message });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function stripQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? "";
}

function isExternalOrSpecialUrl(value: string): boolean {
  return (
    /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value) ||
    value.trim() === ""
  );
}

async function checkLocalReference(
  value: string,
  htmlDirectory: string,
  attribute: string,
): Promise<void> {
  if (isExternalOrSpecialUrl(value)) return;

  const cleanValue = decodeURIComponent(stripQueryAndHash(value));
  if (!cleanValue) return;

  const target = cleanValue.startsWith("/")
    ? resolve(ROOT, `.${cleanValue}`)
    : resolve(htmlDirectory, cleanValue);

  // Avoid checking paths that escape the project directory.
  const relativeTarget = normalize(target).slice(ROOT.length);
  if (isAbsolute(relativeTarget) || relativeTarget.startsWith("..")) return;

  if (!(await exists(target))) {
    report("warning", `Missing local ${attribute} target: "${value}"`);
  }
}

async function main(): Promise<void> {
  const indexPath = join(ROOT, "index.html");
  const robotsPath = join(ROOT, "robots.txt");

  if (!(await exists(indexPath))) {
    report("error", "index.html was not found in the project root.");
  } else {
    const html = await readFile(indexPath, "utf8");
    const htmlDirectory = dirname(indexPath);

    if (!/<html\b[^>]*\blang\s*=/i.test(html)) {
      report("warning", 'The <html> element is missing its "lang" attribute.');
    }

    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    if (!title) {
      report("warning", "A non-empty <title> element is recommended.");
    }

    const description = [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) => {
      const tag = match[0];
      return (
        getAttribute(tag, "name")?.toLowerCase() === "description" &&
        Boolean(getAttribute(tag, "content")?.trim())
      );
    });

    if (!description) {
      report("warning", 'A meta description is missing or empty.');
    }

    if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html)) {
      report("warning", "No <h1> heading was found.");
    }

    const ids = [...html.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)]
      .map((match) => match[1] ?? match[2] ?? match[3])
      .filter(Boolean);

    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        report("error", `Duplicate HTML id found: "${id}"`);
      }
      seen.add(id);
    }

    const tags = html.match(/<(?:a|area|link|script|img|source|video|audio|iframe)\b[^>]*>/gi) ?? [];

    for (const tag of tags) {
      const tagName = tag.match(/^<([a-z]+)/i)?.[1]?.toLowerCase();
      const attribute = ["a", "area", "link"].includes(tagName ?? "") ? "href" : "src";
      const value = getAttribute(tag, attribute);

      if (value) {
        await checkLocalReference(value, htmlDirectory, attribute);
      }
    }
  }

  if (!(await exists(robotsPath))) {
    report("warning", "robots.txt was not found in the project root.");
  }

  const errors = findings.filter((item) => item.severity === "error");
  const warnings = findings.filter((item) => item.severity === "warning");

  console.log("\nStatic site health check\n");

  if (findings.length === 0) {
    console.log("✓ No issues found. Your basic site checks look good.");
  } else {
    for (const finding of findings) {
      const icon = finding.severity === "error" ? "✗" : "!";
      console.log(`${icon} [${finding.severity.toUpperCase()}] ${finding.message}`);
    }
  }

  console.log(`\nResults: ${errors.length} error(s), ${warnings.length} warning(s).\n`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("The site check could not be completed:", error);
  process.exitCode = 1;
});
