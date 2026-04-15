import { Fragment, type ReactNode } from 'react';

export function highlightCode(code: string): ReactNode[] {
  const re = /(\/\/[^\n]*)|(#[^\n]*)|('(?:[^'\\]|\\.)*')|(`(?:[^`\\]|\\.)*`)|("(?:[^"\\]|\\.)*")|(true|false|null|undefined)|(\b(?:const|let|var|await|new|return|if|else|function|async|import|from|export|type|interface)\b)|(\b\d+\b)|([\w$.]+)|([^\w\s])|(\s+)/g;
  const out: ReactNode[] = [];
  let m;
  let i = 0;
  while ((m = re.exec(code)) !== null) {
    const [, lineComment, hashComment, singleStr, tmpl, doubleStr, bool, keyword, num, ident, punct] = m;
    let cls = '';
    if (lineComment || hashComment) cls = 'tk-comment';
    else if (singleStr || tmpl || doubleStr) cls = 'tk-string';
    else if (bool) cls = 'tk-bool';
    else if (keyword) cls = 'tk-keyword';
    else if (num) cls = 'tk-number';
    else if (ident) {
      if (['JSON', 'session', 'response', 'Byoky', 'ByokyServer', 'Anthropic', 'OpenAI', 'fetch', 'Promise', 'console'].includes(ident)) cls = 'tk-builtin';
      else if (ident.includes('.')) cls = '';
      else cls = 'tk-ident';
    } else if (punct) cls = 'tk-punct';
    out.push(cls ? <span key={i++} className={cls}>{m[0]}</span> : <Fragment key={i++}>{m[0]}</Fragment>);
  }
  return out;
}
