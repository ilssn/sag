"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import type { NavGroup } from "@/lib/site-config";

type Props = {
  currentHref: string;
  title: string;
  sectionTitle: string;
  navigation: NavGroup[];
};

export function DocsMobileNav({ currentHref, title, sectionTitle, navigation }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="docs-mobile-bar">
      <button type="button" className="icon-button quiet" onClick={() => setOpen(true)} aria-label="打开文档目录">
        <Menu size={19} aria-hidden="true" />
      </button>
      <span>{sectionTitle}</span>
      <i>/</i>
      <strong>{title}</strong>

      {open &&
        createPortal(
          <div className="mobile-nav-overlay" onMouseDown={() => setOpen(false)}>
            <nav
              className="mobile-nav-panel"
              aria-label="移动端文档目录"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="mobile-nav-heading">
                <span>全部文档</span>
                <button
                  type="button"
                  className="icon-button quiet"
                  onClick={() => setOpen(false)}
                  aria-label="关闭文档目录"
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </div>
              {navigation.map((group) => (
                <section key={group.title}>
                  <h2>{group.title}</h2>
                  {group.items.map((item) => {
                    const active = item.href === currentHref;
                    return (
                      <Link
                        href={item.href}
                        className={active ? "active" : ""}
                        key={item.href}
                        onClick={() => setOpen(false)}
                      >
                        <strong>{item.title}</strong>
                        {item.description && <small>{item.description}</small>}
                      </Link>
                    );
                  })}
                </section>
              ))}
            </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}
