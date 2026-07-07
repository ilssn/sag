"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface group-[.toaster]:text-ink group-[.toaster]:border-hairline group-[.toaster]:shadow-lift group-[.toaster]:rounded-md",
          description: "group-[.toast]:text-ink-muted",
          actionButton: "group-[.toast]:bg-ink group-[.toast]:text-paper",
          cancelButton: "group-[.toast]:bg-surface-2 group-[.toast]:text-ink-muted",
        },
      }}
      {...props}
    />
  );
}
