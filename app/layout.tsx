import type { Metadata } from "next";
import { Geist, Newsreader } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Stitch",
  description:
    "Type a word and embroider it. Change the stitch and the thread colors.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${newsreader.variable} fixed inset-0 h-full w-full overflow-hidden overscroll-none antialiased`}
    >
      <body className="fixed inset-0 h-full w-full overflow-hidden overscroll-none font-sans">
        {children}
      </body>
    </html>
  );
}
