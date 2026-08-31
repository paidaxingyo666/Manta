import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { RootProvider } from 'fumadocs-ui/provider/next'
import './globals.css'

const siteUrl = 'https://www.manta.sh.cn'

export const metadata: Metadata = {
  title: 'Manta Docs',
  description: 'Product documentation for Manta — the worktree IDE for AI coding agents.',
  metadataBase: new URL(siteUrl),
  applicationName: 'Manta Docs',
  icons: {
    icon: '/docs/favicon.ico',
    shortcut: '/docs/favicon.ico'
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: `${siteUrl}/docs`,
    siteName: 'Manta',
    title: 'Manta Docs',
    description: 'Product documentation for Manta — the worktree IDE for AI coding agents.'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Manta Docs',
    description: 'Product documentation for Manta — the worktree IDE for AI coding agents.'
  },
  robots: {
    index: true,
    follow: true
  },
  alternates: {
    canonical: `${siteUrl}/docs`
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en" className="bg-background text-foreground" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <RootProvider search={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  )
}
