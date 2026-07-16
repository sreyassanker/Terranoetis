interface CommandChipsProps {
  content: string;
  focusLocation: (lat: number, lon: number, opts?: Record<string, unknown>) => void;
  toggleLayer: (id: string) => void;
}

export function CommandChips({ content, focusLocation, toggleLayer }: CommandChipsProps) {
  const cmdChips: Array<{label:string;action:string;lat?:number;lon?:number;layerId?:string}> = [];
  const cmdBlock = content.match(/## COMMANDS\n([\s\S]*?)(?:\n##|\n*$)/);
  if (cmdBlock) {
    const cmdMatches = cmdBlock[1].match(/\{[^}]+\}/g);
    if (cmdMatches) {
      for (const json of cmdMatches) {
        try {
          const cmd = JSON.parse(json);
          if (cmd.action === 'flyTo' && cmd.lat && cmd.lon) {
            cmdChips.push({label:(cmd.label||'Fly'),action:'flyTo',lat:cmd.lat,lon:cmd.lon});
          }
          if (cmd.action === 'toggleLayer' && cmd.layerId) {
            cmdChips.push({label:cmd.layerId,action:'toggleLayer',layerId:cmd.layerId});
          }
        } catch { /* skip */ }
      }
    }
  }
  if (cmdChips.length === 0) return null;
  return (
    <div className="msg-commands" style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
      {cmdChips.map((chip,i) => (
        <span key={i} className="ai-chip command-chip" style={{fontSize:10,padding:'2px 8px'}}
          onClick={() => {
            if (chip.action === 'flyTo' && chip.lat && chip.lon) focusLocation(chip.lat, chip.lon, { label: chip.label || 'Location', color: '#60a5fa', height: 1500 });
            if (chip.action === 'toggleLayer' && chip.layerId) toggleLayer(chip.layerId);
          }}>{chip.label}</span>
      ))}
    </div>
  );
}
