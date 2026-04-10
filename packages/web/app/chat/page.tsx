import type { Metadata } from 'next';
import { ChatApp } from './ChatApp';
import './chat.css';

export const metadata: Metadata = {
  title: 'Byoky Chat',
  description:
    'Multi-provider AI chat powered by your own API keys. Switch between Claude, GPT, and Gemini in one conversation.',
  alternates: {
    canonical: '/chat',
  },
};

export default function ChatPage() {
  return <ChatApp />;
}
