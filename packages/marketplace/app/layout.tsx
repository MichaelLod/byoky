import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Byoky Marketplace',
  description: 'Discover and install apps that run on your own API keys',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
