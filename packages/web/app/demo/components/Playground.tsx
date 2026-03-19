import { useState } from 'react';
import type { ByokySession } from '@byoky/sdk';
import { Chat } from './Chat';
import { StructuredOutput } from './StructuredOutput';
import { ToolUseDemo } from './ToolUseDemo';
import { BackendRelay } from './BackendRelay';
import { SessionInfo } from './SessionInfo';

const tabs = [
  { id: 'chat', label: 'Chat' },
  { id: 'structured', label: 'Structured Output' },
  { id: 'tools', label: 'Tool Use' },
  { id: 'relay', label: 'Backend Relay' },
  { id: 'session', label: 'Session' },
] as const;

type TabId = (typeof tabs)[number]['id'];

interface Props {
  session: ByokySession;
}

export function Playground({ session }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('chat');

  return (
    <div className="playground">
      <div className="playground-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`playground-tab ${activeTab === tab.id ? 'playground-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="playground-content">
        {activeTab === 'chat' && <Chat session={session} />}
        {activeTab === 'structured' && <StructuredOutput session={session} />}
        {activeTab === 'tools' && <ToolUseDemo session={session} />}
        {activeTab === 'relay' && <BackendRelay session={session} />}
        {activeTab === 'session' && <SessionInfo session={session} />}
      </div>
    </div>
  );
}
