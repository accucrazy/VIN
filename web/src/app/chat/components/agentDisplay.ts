// Agent display metadata for the chat UI — pure data + pure function.
//
// Ported from the-pocket-pandora and rewired for the VIN agent roster
// (vin, researcher). The original pulled per-agent PNGs from /public; we keep
// avatar `null` here so MessageBubble falls back to the initial-letter chip
// (no image assets required to run).
interface KnownAgent {
  name: string;
  avatar: string | null;
  color: string;
  bgColor: string;
  borderColor: string;
  solidBgColor: string;
}

const KNOWN_AGENTS: Record<string, KnownAgent> = {
  vin: {
    name: 'Vin',
    avatar: null,
    color: 'text-brand-600',
    bgColor: 'bg-brand-50',
    borderColor: 'border-brand-200',
    solidBgColor: 'bg-brand-500',
  },
  researcher: {
    name: 'Researcher',
    avatar: null,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    solidBgColor: 'bg-emerald-500',
  },
  // `host` retained for backward compat with messages that came in via the
  // upstream protocol (Pandora's host = Stacey). VIN uses `vin` instead.
  host: {
    name: 'Vin',
    avatar: null,
    color: 'text-brand-600',
    bgColor: 'bg-brand-50',
    borderColor: 'border-brand-200',
    solidBgColor: 'bg-brand-500',
  },
};

const DEFAULT = {
  color: 'text-slate-600',
  bgColor: 'bg-slate-50',
  borderColor: 'border-slate-200',
  solidBgColor: 'bg-slate-500',
};

export interface AgentDisplay {
  name: string;
  initial: string;
  avatar: string | null;
  color: string;
  bgColor: string;
  borderColor: string;
  solidBgColor: string;
}

export function getAgentDisplay(agentId: string, agentName?: string): AgentDisplay {
  const k = KNOWN_AGENTS[agentId];
  if (k) {
    const name = agentName || k.name;
    return {
      name,
      initial: name.charAt(0).toUpperCase(),
      avatar: k.avatar,
      color: k.color,
      bgColor: k.bgColor,
      borderColor: k.borderColor,
      solidBgColor: k.solidBgColor,
    };
  }
  const name = agentName || agentId || 'Agent';
  return {
    name,
    initial: name.charAt(0).toUpperCase(),
    avatar: null,
    color: DEFAULT.color,
    bgColor: DEFAULT.bgColor,
    borderColor: DEFAULT.borderColor,
    solidBgColor: DEFAULT.solidBgColor,
  };
}
