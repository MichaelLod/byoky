'use client';

import type { ReactNode } from 'react';

export function highlightCode(code: string): ReactNode[] {
  const lines = code.split('\n');
  return lines.map((line, i) => {
    const parts: ReactNode[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      const commentMatch = remaining.match(/^(\/\/.*)/);
      if (commentMatch) {
        parts.push(<span key={key++} style={{ color: '#7a7a9c' }}>{commentMatch[1]}</span>);
        remaining = remaining.slice(commentMatch[1].length);
        continue;
      }

      const stringMatch = remaining.match(/^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/);
      if (stringMatch) {
        parts.push(<span key={key++} style={{ color: '#86efac' }}>{stringMatch[1]}</span>);
        remaining = remaining.slice(stringMatch[1].length);
        continue;
      }

      const kwMatch = remaining.match(/^(import|from|export|const|let|var|await|async|new|true|false|null|undefined|function|return|if|else)\b/);
      if (kwMatch) {
        parts.push(<span key={key++} style={{ color: '#FF8C4D' }}>{kwMatch[1]}</span>);
        remaining = remaining.slice(kwMatch[1].length);
        continue;
      }

      const typeMatch = remaining.match(/^([A-Z][a-zA-Z0-9]*)/);
      if (typeMatch) {
        parts.push(<span key={key++} style={{ color: '#67e8f9' }}>{typeMatch[1]}</span>);
        remaining = remaining.slice(typeMatch[1].length);
        continue;
      }

      const numMatch = remaining.match(/^(\d+)/);
      if (numMatch) {
        parts.push(<span key={key++} style={{ color: '#FF6B2B' }}>{numMatch[1]}</span>);
        remaining = remaining.slice(numMatch[1].length);
        continue;
      }

      const plainMatch = remaining.match(/^([^/'"`A-Z\d]+|[/'"`])/);
      if (plainMatch) {
        parts.push(<span key={key++}>{plainMatch[1]}</span>);
        remaining = remaining.slice(plainMatch[1].length);
      } else {
        parts.push(<span key={key++}>{remaining[0]}</span>);
        remaining = remaining.slice(1);
      }
    }

    return <span key={i}>{parts}{i < lines.length - 1 ? '\n' : ''}</span>;
  });
}

export function HighlightedCode({ code }: { code: string }) {
  return <code>{highlightCode(code)}</code>;
}
