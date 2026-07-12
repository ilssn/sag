import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDirectory, "..");
const contentRoot = path.resolve(siteRoot, "..");
const publicRoot = path.join(siteRoot, "public");

await mkdir(path.join(publicRoot, "schemas"), { recursive: true });
await cp(path.join(contentRoot, "schemas", "1.0"), path.join(publicRoot, "schemas", "1.0"), {
  recursive: true,
  force: true,
});

const coreDocuments = [
  ["Introduction", "README.md", "/docs/introduction/"],
  ["OCTX Core v1", "spec-v1.md", "/docs/core/"],
  ["SAG-structured Profile 1.0", "sag-structured-v1.md", "/docs/sag-structured/"],
  ["Tooling and lifecycle", "tooling-lifecycle.md", "/docs/tooling/"],
  ["Python API", "python-api.md", "/api/"],
  ["Glossary", "GLOSSARY.md", "/docs/glossary/"],
];

const indexLines = [
  "# OCTX documentation",
  "",
  "> Open Context Asset Format: portable, verifiable context assets for people, agents, and knowledge systems.",
  "",
  ...coreDocuments.map(([title, , href]) => `- [${title}](${href})`),
  "- [JSON Schemas](/docs/schemas/)",
  "",
];

await writeFile(path.join(publicRoot, "llms.txt"), indexLines.join("\n"), "utf8");

const fullSections = [];
for (const [title, file] of coreDocuments) {
  const content = (await readFile(path.join(contentRoot, file), "utf8")).trimEnd();
  fullSections.push(`\n\n---\n\n# ${title}\n\n${content}`);
}

await writeFile(
  path.join(publicRoot, "llms-full.txt"),
  `# OCTX complete documentation${fullSections.join("")}\n`,
  "utf8",
);
