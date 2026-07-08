export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10">
      {/* 环境层：点阵网格径向淡出 + 顶部光晕（纯装饰，语义 token，亮暗自适应） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid [mask-image:radial-gradient(ellipse_75%_60%_at_50%_40%,black,transparent)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-halo" />
      <div className="relative">{children}</div>
    </div>
  );
}
