import Link from "next/link";
import type { NavGroup } from "@/lib/site-config";

export function DocsSidebar({ currentHref, navigation }: { currentHref: string; navigation: NavGroup[] }) {
  return (
    <nav className="docs-sidebar-nav" aria-label="文档目录">
      {navigation.map((group) => (
        <section className="sidebar-group" key={group.title}>
          <h2>{group.title}</h2>
          <ul>
            {group.items.map((item) => {
              const active = item.href === currentHref;
              return (
                <li key={item.href}>
                  <Link className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}>
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
