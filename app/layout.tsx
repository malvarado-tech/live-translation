import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Live Translation",
  description:
    "Real-time speech translation for live events, fanned out to listeners' phones over WebRTC.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Applies the theme remembered on this device before first paint, so a
// Night-mode phone in a dark room never flashes the light theme.
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("lt.theme");document.documentElement.setAttribute("data-theme",t==="night"?"night":"light")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${barlow.variable} ${barlowCondensed.variable} ${atkinson.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-ink">
        {children}
      </body>
    </html>
  );
}
