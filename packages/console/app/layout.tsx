import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Byoky — Control Plane',
  description: 'See and control every AI dollar your company spends.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
