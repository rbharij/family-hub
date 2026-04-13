// Wall display gets its own layout so it renders without the app shell
// (TopBar, NavTabs). The page itself uses `fixed inset-0 z-50` to cover
// the underlying shell that the root layout still mounts.
export default function WallLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
