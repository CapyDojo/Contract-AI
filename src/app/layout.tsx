import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from '@/components/providers'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Contract AI - Intelligent Contract Review",
  description: "AI-powered contract review and analysis platform. Upload, analyze, and collaborate on legal documents with advanced AI assistance.",
  keywords: ["contract review", "AI legal", "document analysis", "legal tech", "contract management"],
  authors: [{ name: "Contract AI Team" }],
  creator: "Contract AI",
  publisher: "Contract AI",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://contract-ai.com",
    title: "Contract AI - Intelligent Contract Review",
    description: "AI-powered contract review and analysis platform",
    siteName: "Contract AI",
  },
  twitter: {
    card: "summary_large_image",
    title: "Contract AI - Intelligent Contract Review",
    description: "AI-powered contract review and analysis platform",
    creator: "@contractai",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster 
            position="bottom-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'hsl(var(--background))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
              }
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
