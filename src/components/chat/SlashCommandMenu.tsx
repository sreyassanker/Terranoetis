import React, { useEffect, useRef } from 'react';
import { SLASH_COMMANDS, type SlashCommand } from './slashCommands';

export type { SlashCommand };

interface SlashCommandMenuProps {
  query: string;
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
}

export function SlashCommandMenu({
  query,
  selectedIndex,
  onSelect,
}: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Filter commands by query (case-insensitive substring match)
  const cleanQuery = query.toLowerCase().replace(/^\//, '');
  const filteredCommands = SLASH_COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(cleanQuery) ||
    cmd.description.toLowerCase().includes(cleanQuery)
  );

  useEffect(() => {
    // Scroll selected item into view smoothly
    if (listRef.current) {
      const activeEl = listRef.current.querySelector<HTMLElement>('.slash-item-active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (filteredCommands.length === 0) {
    return null;
  }

  return (
    <div
      className="slash-command-menu"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 8,
        background: '#ffffff',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        boxShadow: '0 -8px 32px rgba(15, 23, 42, 0.12), 0 0 1px rgba(0, 0, 0, 0.08)',
        zIndex: 50,
        overflow: 'hidden',
        maxHeight: 280,
        display: 'flex',
        flexDirection: 'column',
      }}
      role="listbox"
      aria-label="Slash commands"
    >
      <div
        ref={listRef}
        style={{
          overflowY: 'auto',
          padding: '6px 0',
          scrollbarWidth: 'thin',
        }}
      >
        {filteredCommands.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          const Icon = cmd.icon;

          return (
            <div
              key={cmd.id}
              className={`slash-item ${isSelected ? 'slash-item-active' : ''}`}
              role="option"
              aria-selected={isSelected}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 14px',
                cursor: 'pointer',
                background: isSelected ? 'rgba(2, 132, 199, 0.08)' : 'transparent',
                borderLeft: isSelected ? '3px solid #0284c7' : '3px solid transparent',
                transition: 'background 0.12s ease, border-color 0.12s ease',
              }}
              onMouseEnter={() => {}}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blurring textarea
                onSelect(cmd);
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  color: isSelected ? '#0284c7' : '#64748b',
                  flexShrink: 0,
                }}
              >
                <Icon size={16} strokeWidth={1.8} />
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: isSelected ? '#0284c7' : '#0f172a',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    flexShrink: 0,
                  }}
                >
                  {cmd.label}
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color: isSelected ? '#334155' : '#64748b',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {cmd.description}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
