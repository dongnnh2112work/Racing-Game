import type { Metadata } from 'next'
import 'inter-ui'
import '../styles.css'

export const metadata: Metadata = {
  title: 'Racing Game',
  description: 'Open source racing game with hand tracking and ESP32 steering wheel support',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
