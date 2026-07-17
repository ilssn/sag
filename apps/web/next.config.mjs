/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 静态导出（ADR-0006）：web 部署与 Tauri 桌面共用同一份 out/ 产物，
  // 桌面运行时只携带 FastAPI sidecar，不存在 Node 服务器。
  output: "export",
  // 目录索引（out/chat/index.html）是所有静态宿主与 Tauri 资源解析的零配置公约数。
  trailingSlash: true,
  // export 要求关闭图片优化器；应用未用 next/image，属防御性设置。
  images: { unoptimized: true },
  // Keep development HMR artifacts isolated from `next build` output.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  eslint: { ignoreDuringBuilds: true },
  // 旧路径重定向按 ADR-0006 移除:不设兼容层,未知路径统一落 404 页。
};

export default nextConfig;
