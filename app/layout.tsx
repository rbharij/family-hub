import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ConnectionStatusProvider } from "@/lib/connection-status"
import { AppSettingsProvider } from "@/lib/app-settings-context"
import { MessageCountProvider } from "@/lib/message-count-context"
import { SetupWizard } from "@/components/setup-wizard"
import { TopBar } from "@/components/top-bar"
import { TopNavTabs, BottomNavTabs } from "@/components/nav-tabs"
import { Toaster } from "@/components/ui/sonner"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Family Hub",
  description: "Your family's central hub for calendars, chores, shopping, and meals",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline script: apply dark class before first paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var el=document.documentElement;
              el.classList.add('no-theme-transition');
              var m=localStorage.getItem('theme-mode')||'auto';
              var overrideUntil=localStorage.getItem('theme-override-until');
              if(overrideUntil&&Date.now()>parseInt(overrideUntil,10)){
                m='auto';
                localStorage.setItem('theme-mode','auto');
                localStorage.removeItem('theme-override-until');
              }
              var h=new Date().getHours();
              var df=parseInt(localStorage.getItem('dark-from-hour')||'19',10);
              var lf=parseInt(localStorage.getItem('light-from-hour')||'7',10);
              var dark=m==='dark'||(m==='auto'&&(h>=df||h<lf));
              if(dark)el.classList.add('dark');
              requestAnimationFrame(function(){
                requestAnimationFrame(function(){
                  el.classList.remove('no-theme-transition');
                });
              });
            }catch(e){}}())`,
          }}
        />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <ConnectionStatusProvider>
            <AppSettingsProvider>
              <MessageCountProvider>
              {/*
                Desktop (lg+): fixed-height shell — top bar + nav tabs + scrollable content.
                Mobile: normal document flow — content scrolls, bottom nav is fixed.
              */}
              <div className="flex flex-col lg:h-screen bg-background text-foreground">
                <TopBar />
                <TopNavTabs />
                {/* Mobile: pad below content for bottom nav + safe area. Desktop: no bottom nav. */}
                <main className="flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
                  {children}
                </main>
                <BottomNavTabs />
              </div>
              <SetupWizard />
              <Toaster position="top-center" richColors closeButton />
              </MessageCountProvider>
            </AppSettingsProvider>
          </ConnectionStatusProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
