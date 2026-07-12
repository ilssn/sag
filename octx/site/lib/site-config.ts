export type NavItem = {
  title: string;
  href: string;
  description?: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const DOC_NAV: NavGroup[] = [
  {
    title: "开始",
    items: [
      {
        title: "什么是 OCTX？",
        href: "/docs/introduction",
        description: "格式定位、核心价值与阅读入口",
      },
    ],
  },
  {
    title: "格式规范",
    items: [
      {
        title: "OCTX Core v1",
        href: "/docs/core",
        description: "容器、manifest、身份与完整性",
      },
      {
        title: "SAG-structured",
        href: "/docs/sag-structured",
        description: "Chunk、Event、Entity、关系与向量",
      },
      {
        title: "Machine Schemas",
        href: "/docs/schemas",
        description: "JSON Schema 2020-12",
      },
    ],
  },
  {
    title: "构建与集成",
    items: [
      {
        title: "工具与生命周期",
        href: "/docs/tooling",
        description: "Create、Open、Validate、Import、Export",
      },
    ],
  },
  {
    title: "参考",
    items: [
      {
        title: "领域词汇表",
        href: "/docs/glossary",
        description: "统一术语与概念边界",
      },
    ],
  },
];

export const API_NAV: NavGroup[] = [
  {
    title: "Python 包",
    items: [
      {
        title: "Python API",
        href: "/api",
        description: "安装、创建、读取、校验与 CLI",
      },
    ],
  },
];

export const PRIMARY_DOCS = DOC_NAV.flatMap((group) => group.items);
export const PRIMARY_API_DOCS = API_NAV.flatMap((group) => group.items);

export const TOP_NAV = [
  { title: "文档", href: "/docs/introduction", activePrefix: "/docs" },
  { title: "API", href: "/api", activePrefix: "/api" },
];
