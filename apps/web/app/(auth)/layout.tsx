import { SpaceBackdrop } from "@/components/features/space-backdrop";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-space-field grid min-h-screen place-items-center px-4 py-10">
      <SpaceBackdrop />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
