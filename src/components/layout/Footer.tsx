'use client';

import { Linkedin, Mail, MessageCircle, Github, BookOpen } from 'lucide-react';

function XIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const socials = [
  { icon: Linkedin, label: 'LinkedIn', href: 'https://www.linkedin.com/in/dhruv-joshi-52769b265/', color: '#0a66c2' },
  { icon: XIcon, label: '@mdhruvjoshi', href: 'https://x.com/mdhruvjoshi', color: '#a1a1aa' },
  { icon: Github, label: 'GitHub', href: 'https://github.com/DhruvJoshi-GIT', color: '#8b949e' },
  { icon: Mail, label: 'Email', href: 'mailto:mdhruvjoshi@gmail.com', color: '#ea4335' },
  { icon: MessageCircle, label: 'dhruvjoshi.28', href: '#', color: '#5865f2', isDiscord: true },
];

export function Footer() {
  const handleDiscordClick = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText('dhruvjoshi.28');
    const btn = e.currentTarget as HTMLElement;
    btn.setAttribute('data-copied', 'true');
    setTimeout(() => btn.setAttribute('data-copied', ''), 2000);
  };

  return (
    <footer className="mt-20 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--primary), var(--secondary))' }}>
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Built by Dhruv Joshi</p>
              <p className="text-xs" style={{ color: '#64748b' }}>Full-stack developer</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {socials.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target={social.isDiscord ? undefined : '_blank'}
                rel="noopener noreferrer"
                onClick={social.isDiscord ? handleDiscordClick : undefined}
                className="group relative flex items-center gap-2 px-3.5 py-2 rounded-xl border transition-all hover:scale-105 hover:-translate-y-0.5"
                style={{
                  backgroundColor: `${social.color}10`,
                  borderColor: `${social.color}25`,
                }}
              >
                <social.icon className="w-4 h-4" style={{ color: social.color }} />
                <span className="text-sm font-medium transition-colors" style={{ color: '#94a3b8' }}>
                  {social.label}
                </span>
                {social.isDiscord && (
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded opacity-0 group-[&[data-copied='true']]:opacity-100 transition-opacity pointer-events-none whitespace-nowrap" style={{ backgroundColor: '#1e293b', color: '#34d399' }}>
                    Copied!
                  </span>
                )}
              </a>
            ))}
          </div>

          <p className="text-xs text-center" style={{ color: '#374151' }}>
            CS Visual Lab — Interactive Computer Science Encyclopedia
          </p>
        </div>
      </div>
    </footer>
  );
}
