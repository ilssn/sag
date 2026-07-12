import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, List } from "lucide-react";
import { DocsMobileNav } from "@/components/docs-mobile-nav";
import { DocsSidebar } from "@/components/docs-sidebar";
import type { Heading } from "@/lib/docs";
import { API_NAV, DOC_NAV, type NavItem } from "@/lib/site-config";

type Props = {
  currentHref: string;
  section: "docs" | "api";
  title: string;
  headings: Heading[];
  previous?: NavItem;
  next?: NavItem;
  children: ReactNode;
};

export function DocsShell({ currentHref, section, title, headings, previous, next, children }: Props) {
  const navigation = section === "api" ? API_NAV : DOC_NAV;
  const sectionTitle = section === "api" ? "API" : "文档";

  return (
    <>
      <DocsMobileNav
        currentHref={currentHref}
        title={title}
        sectionTitle={sectionTitle}
        navigation={navigation}
      />
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <DocsSidebar currentHref={currentHref} navigation={navigation} />
        </aside>

        <main className="docs-main" id="main-content">
          {children}
          {(previous || next) && (
            <nav className="docs-pagination" aria-label="相邻文档">
              {previous ? (
                <Link href={previous.href}>
                  <ArrowLeft size={17} aria-hidden="true" />
                  <span>
                    <small>上一篇</small>
                    <strong>{previous.title}</strong>
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link href={next.href} className="next">
                  <span>
                    <small>下一篇</small>
                    <strong>{next.title}</strong>
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              )}
            </nav>
          )}
        </main>

        <aside className="docs-toc">
          {headings.length > 0 && (
            <nav aria-label="本页目录">
              <h2>
                <List size={15} aria-hidden="true" />
                本页目录
              </h2>
              {headings.map((heading) => (
                <a className={heading.level === 3 ? "nested" : ""} href={`#${heading.id}`} key={heading.id}>
                  {heading.text}
                </a>
              ))}
            </nav>
          )}
        </aside>
      </div>
    </>
  );
}
