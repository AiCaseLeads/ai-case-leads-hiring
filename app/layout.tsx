import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Careers · AI Case Leads", template: "%s · AI Case Leads" },
  description:
    "Explore opportunities at AI Case Leads and apply directly to our team.",
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
