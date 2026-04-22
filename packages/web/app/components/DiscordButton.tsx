'use client';

export function DiscordButton({ invite }: { invite: string }) {
  return (
    <a
      href={`https://discord.gg/${invite}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 10px',
        textDecoration: 'none',
        borderRadius: '6px',
        border: '1px solid #d1d5db',
        background: '#f6f8fa',
        color: '#24292f',
        fontSize: '12px',
        fontWeight: 600,
        lineHeight: 1,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#5865F2" aria-hidden="true">
        <path d="M20.317 4.369A19.791 19.791 0 0 0 16.558 3c-.2.359-.43.843-.59 1.229a18.27 18.27 0 0 0-5.487 0C10.322 3.843 10.084 3.359 9.884 3a19.736 19.736 0 0 0-3.762 1.369C2.437 9.889 1.42 15.27 1.928 20.574A19.9 19.9 0 0 0 7.842 23.5c.477-.647.901-1.336 1.266-2.06a12.94 12.94 0 0 1-1.993-.954c.167-.122.331-.25.489-.38a14.22 14.22 0 0 0 12.392 0c.159.13.323.258.49.38-.637.379-1.307.699-2 .955a15.47 15.47 0 0 0 1.266 2.059 19.876 19.876 0 0 0 5.918-2.926c.59-6.156-.996-11.49-4.353-16.205ZM8.678 17.25c-1.182 0-2.152-1.09-2.152-2.42s.954-2.421 2.152-2.421c1.198 0 2.17 1.09 2.152 2.421-.002 1.33-.954 2.42-2.152 2.42Zm7.957 0c-1.182 0-2.152-1.09-2.152-2.42s.954-2.421 2.152-2.421c1.197 0 2.17 1.09 2.152 2.421 0 1.33-.955 2.42-2.152 2.42Z" />
      </svg>
      Discord
    </a>
  );
}
