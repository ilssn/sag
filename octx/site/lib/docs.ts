import "server-only";

import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { PRIMARY_API_DOCS, PRIMARY_DOCS } from "@/lib/site-config";
import type { SearchItem } from "@/lib/types";

export type Heading = {
  id: string;
  text: string;
  level: 2 | 3;
};

export type Doc = {
  slug: string;
  title: string;
  description: string;
  group: string;
  section: "docs" | "api";
  sourceFile?: string;
  content: string;
  headings: Heading[];
  href: string;
};

const CONTENT_ROOT = path.resolve(process.cwd(), "..");

const DOCUMENTS = [
  {
    slug: "introduction",
    title: "什么是 OCTX？",
    description: "OCTX 的完整含义、核心价值与文档入口。",
    group: "开始",
    section: "docs",
    href: "/docs/introduction",
    file: "README.md",
  },
  {
    slug: "core",
    title: "OCTX Core v1 规范",
    description: "容器、manifest、知识文档、身份、摘要、版本和扩展规则。",
    group: "格式规范",
    section: "docs",
    href: "/docs/core",
    file: "spec-v1.md",
  },
  {
    slug: "sag-structured",
    title: "SAG-structured Profile 1.0",
    description: "Chunks、Events、Entities、关系、向量和完整覆盖约束。",
    group: "格式规范",
    section: "docs",
    href: "/docs/sag-structured",
    file: "sag-structured-v1.md",
  },
  {
    slug: "schemas",
    title: "Machine Schemas",
    description: "OCTX v1 的 JSON Schema Draft 2020-12 与语义校验边界。",
    group: "格式规范",
    section: "docs",
    href: "/docs/schemas",
    file: "schemas/README.md",
  },
  {
    slug: "tooling",
    title: "工具与生命周期",
    description: "创建、读取、校验、导入、导出以及 Asset 与 Release 生命周期。",
    group: "构建与集成",
    section: "docs",
    href: "/docs/tooling",
    file: "tooling-lifecycle.md",
  },
  {
    slug: "glossary",
    title: "OCTX 领域词汇表",
    description: "OCTX、SAG 与 zleap-sag 的统一领域语言。",
    group: "参考",
    section: "docs",
    href: "/docs/glossary",
    file: "GLOSSARY.md",
  },
  {
    slug: "python-api",
    title: "OCTX Python API",
    description: "安装 octx，并使用 Python API 与 CLI 创建、打开、校验和安全解包 Package。",
    group: "Python 包",
    section: "api",
    href: "/api",
    file: "python-api.md",
  },
] as const;

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(CONTENT_ROOT, relativePath), "utf8");
}

function cleanHeadingText(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[\\*~]/g, "")
    .trim();
}

function stripFirstHeading(markdown: string) {
  return markdown.replace(/^#\s+[^\n]+\n+/, "");
}

function extractHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = cleanHeadingText(match[2]);
    headings.push({
      id: slugger.slug(text),
      text,
      level: match[1].length as 2 | 3,
    });
  }

  return headings;
}

function loadDocument(definition: (typeof DOCUMENTS)[number]): Doc {
  const raw = readSource(definition.file);
  const content = stripFirstHeading(raw);
  return {
    slug: definition.slug,
    title: definition.title,
    description: definition.description,
    group: definition.group,
    section: definition.section,
    sourceFile: definition.file,
    content,
    headings: extractHeadings(content),
    href: definition.href,
  };
}

export function getAllDocs(): Doc[] {
  return DOCUMENTS.map(loadDocument);
}

export function getDoc(slug: string) {
  return getAllDocs().find((doc) => doc.slug === slug);
}

export function getSearchItems(): SearchItem[] {
  return getAllDocs().map((doc) => ({
    title: doc.title,
    description: doc.description,
    href: doc.href,
    group: doc.group,
    text: `${doc.title}\n${doc.description}\n${doc.content}`.slice(0, 12000),
  }));
}

export function getAdjacentDocs(slug: string) {
  const current = getDoc(slug);
  if (!current) return { previous: undefined, next: undefined };
  const navigation = current.section === "api" ? PRIMARY_API_DOCS : PRIMARY_DOCS;
  const orderedHrefs = navigation.map((item) => item.href);
  const currentHref = current.href;
  const index = orderedHrefs.indexOf(currentHref);
  if (index < 0) return { previous: undefined, next: undefined };
  return {
    previous: index > 0 ? navigation[index - 1] : undefined,
    next: index < navigation.length - 1 ? navigation[index + 1] : undefined,
  };
}
