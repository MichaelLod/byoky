'use client';

import { useEffect, useState, type ReactNode } from 'react';

const CHROME_URL = 'https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon';
const IOS_URL = 'https://apps.apple.com/app/byoky/id6760779919';
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.byoky.app';

function detectStoreUrl(): string {
  if (typeof navigator === 'undefined') return CHROME_URL;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return IOS_URL;
  if (/Android/i.test(ua)) return ANDROID_URL;
  return CHROME_URL;
}

export function InstallWalletButton({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [href, setHref] = useState(CHROME_URL);

  useEffect(() => {
    setHref(detectStoreUrl());
  }, []);

  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
