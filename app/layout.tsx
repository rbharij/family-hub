import type { Metadata } from "next"
import { Inter, Bricolage_Grotesque } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ConnectionStatusProvider } from "@/lib/connection-status"
import { AppSettingsProvider } from "@/lib/app-settings-context"
import { MessageCountProvider } from "@/lib/message-count-context"
import { SetupWizard } from "@/components/setup-wizard"
import { TopBar } from "@/components/top-bar"
import { Sidebar, BottomNavTabs } from "@/components/nav-tabs"
import { Toaster } from "@/components/ui/sonner"
import { IdleTimeoutProvider } from "@/lib/idle-timeout-context"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" })
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Family Hub",
  description: "Your family's central hub for calendars, tasks, shopping, and meals",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en-GB" suppressHydrationWarning className={`${inter.variable} ${display.variable}`}>
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
      <body className="font-sans antialiased">
        <ThemeProvider>
          <ConnectionStatusProvider>
            <AppSettingsProvider>
              <IdleTimeoutProvider>
              <MessageCountProvider>
              {/*
                Desktop (lg+): sidebar + scrollable content.
                Mobile: top bar, content in normal flow, fixed bottom nav.
              */}
              <div className="flex flex-col lg:flex-row lg:h-screen bg-background text-foreground">
                <Sidebar />
                <div className="flex-1 min-w-0 flex flex-col lg:h-screen">
                  <TopBar />
                  <main className="flex-1 lg:overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
                    {children}
                  </main>
                </div>
                <BottomNavTabs />
              </div>
              <SetupWizard />
              <Toaster position="top-center" richColors closeButton />
              </MessageCountProvider>
              </IdleTimeoutProvider>
            </AppSettingsProvider>
          </ConnectionStatusProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
