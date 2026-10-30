import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Navloom",
  description: "Evidence-based application exploration for web and Android.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
