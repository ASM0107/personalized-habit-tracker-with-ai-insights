import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

function getAllSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripStringLiterals(code: string): string {
  return code
    .replace(/(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g, '""')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '""');
}

describe("Dune Architecture Enforcement", () => {
  const srcRoot = path.resolve(__dirname, "..");
  const allSourceFiles = getAllSourceFiles(srcRoot);

  it("verifies zero inline or block comments in source code", () => {
    const commentRegex = /(\/\/.*$|\/\*[\s\S]*?\*\/)/m;
    const violations: string[] = [];

    for (const filePath of allSourceFiles) {
      const rawContent = fs.readFileSync(filePath, "utf-8");
      const sanitizedCode = stripStringLiterals(rawContent);
      if (commentRegex.test(sanitizedCode)) {
        violations.push(path.relative(srcRoot, filePath));
      }
    }

    expect(violations).toEqual([]);
  });

  it("verifies zero cross-feature private imports between vertical slices", () => {
    const featuresDir = path.join(srcRoot, "features");
    const featureFolders = fs.readdirSync(featuresDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const violations: string[] = [];

    for (const feature of featureFolders) {
      const featureDir = path.join(featuresDir, feature);
      const featureFiles = getAllSourceFiles(featureDir);

      for (const filePath of featureFiles) {
        const content = fs.readFileSync(filePath, "utf-8");
        for (const otherFeature of featureFolders) {
          if (otherFeature === feature) {
            continue;
          }
          const privateImportPattern = new RegExp(
            `from\\s+['"].*features/${otherFeature}/(?!index).*['"]`
          );
          if (privateImportPattern.test(content)) {
            violations.push(
              `${path.relative(srcRoot, filePath)} illegally imports from internal ${otherFeature}`
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
