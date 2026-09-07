import React from "react"
import type { Metadata } from 'next'
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import { AuthGuard } from '@/components/auth-guard'
import './globals.css'

const instrumentSans = Instrument_Sans({ 
  subsets: ["latin"],
  variable: '--font-instrument'
});

const instrumentSerif = Instrument_Serif({ 
  subsets: ["latin"],
  weight: "400",
  variable: '--font-instrument-serif'
});

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ["latin"],
  variable: '--font-jetbrains'
});

export const metadata: Metadata = {
  title: 'Zenvora - Enterprise Mobile Device Management Platform',
  description: 'Secure, scalable MDM solution for enterprises. Remotely manage Android devices with real-time monitoring, security controls, and complete device management capabilities.',
  keywords: 'MDM, mobile device management, Android management, enterprise security, device control',
  generator: 'v0.app',
  openGraph: {
    title: 'Zenvora - Enterprise MDM Platform',
    description: 'Professional mobile device management for enterprise teams',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Zenvora MDM',
    description: 'Enterprise Mobile Device Management Platform',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className='custom-scrollbar'>
      <body className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  )
}
