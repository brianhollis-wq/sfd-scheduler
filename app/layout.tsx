import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SessionBar from "@/components/SessionBar";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "SFD Staffing Schedule",
  description: "Salem Fire Department daily staffing and crew board",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Renders nothing when signed out, so the login page is unaffected. */}
        <SessionBar />
        {children}
      </body>
    </html>
  );
}
