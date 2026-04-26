import "./globals.css";
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { NavBar } from "@/components/NavBar";
import { MobileNavProvider, Sidebar } from "@/components/Sidebar";
import { TimeframeProvider } from "@/components/TimeframeContext";
import {
  countDailyAggregateFiles,
  loadNotionConfig,
  loadTopicClusters,
} from "@/lib/data";
import { readRefreshState } from "@/lib/refresh";

export const metadata: Metadata = {
  title: "Acme · GEO",
  description:
    "Localhost analytics for Acme — search, AI-answer visibility, and cross-channel performance.",
};

// Don't cache layout data — re-read the Notion config on every navigation
// so a first-run bootstrap that writes the DB URL takes effect immediately.
export const dynamic = "force-dynamic";

/**
 * Layout composition (matches the project design system):
 *   MobileNavProvider
 *   └─ <Sidebar/>          fixed left (224px desktop, drawer on mobile)
 *   └─ main-column         margin-left 240px — sidebar is 224px and we
 *                          add a 16px gutter so wide cards / tables /
 *                          chips don't butt directly into the sidebar's
 *                          right border. Inner padding bumps further on
 *                          md+ (px-8) and lg+ (px-10) so the gutter
 *                          scales with viewport width.
 *      ├─ <NavBar/>        sticky topbar
 *      ├─ <main>           page content, scrollable
 *      └─ <footer>
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notion, refreshState, availableDays, clusters] = await Promise.all([
    loadNotionConfig(),
    readRefreshState(),
    countDailyAggregateFiles(),
    loadTopicClusters(),
  ]);

  // slug → display name map for breadcrumb resolution on /topics/[slug].
  // English names are the canonical breadcrumb label; the cluster page
  // itself has its own lang switcher for DE content.
  const clusterLabels: Record<string, string> = Object.fromEntries(
    clusters.map((c) => [c.slug, c.names.en]),
  );

  return (
    <html lang="en">
      <body>
        <TimeframeProvider availableDays={availableDays}>
          <MobileNavProvider>
            <Sidebar notionUrl={notion.database_url ?? null} />
            <div className="md:ml-60 min-h-dvh flex flex-col">
              <NavBar refreshState={refreshState} slugLabels={clusterLabels} />
              <main className="flex-1 w-full px-4 md:px-8 lg:px-10 py-6 md:py-8 animate-fadeInUp">
                <div className="max-w-7xl mx-auto">
                  {children}
                </div>
              </main>
              <footer className="w-full px-4 md:px-8 lg:px-10 py-6 md:py-8 border-t border-hairline text-[11px] text-ink-500 flex items-center gap-3 md:gap-4 flex-wrap">
                <span className="font-semibold tracking-[0.14em] uppercase text-ink-600">
                  Acme · GEO
                </span>
                <span className="hidden sm:inline text-ink-400">·</span>
                <span>GSC / GA4 / LLM traffic refreshable from the topbar.</span>
                <span className="hidden md:inline text-ink-400">·</span>
                <span>Peec + Notion are Claude-triggered.</span>
                <span className="hidden md:inline text-ink-400">·</span>
                <span>Insights and tasks are written by Claude.</span>
              </footer>
            </div>
            <AutoRefresh />
          </MobileNavProvider>
        </TimeframeProvider>
      </body>
    </html>
  );
}
