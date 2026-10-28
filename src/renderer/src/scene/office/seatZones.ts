// Which zone of a zoned map an agent sits in, by what the agent does.
//
// On the loft, desks belong to departments: research sits in the library,
// designers in Mia's art-director studio (the atelier), writers in the content
// studio, developers in the dev corner, temps at the guest desks. The floor asks this for each agent and gives it a free desk
// in that zone first, falling back to any free desk. Matching is on the
// agent's own words (role, description, name), in English or Russian.

export interface SeatAgent { id: string; name?: string; description?: string; role?: string; isGod?: boolean }

const RULES: Array<[zone: string, words: RegExp]> = [
  ['library', /research|analy|ресёрч|ресерч|исследов|аналит/i],
  ['atelier', /design|art direct|artist|illustrat|дизайн|арт-дир|худож|иллюстр/i],
  ['studio', /copy|writ|edit|content|копирайт|текст|редакт|контент/i],
  ['dev', /develop|engineer|program|coder|\bcode\b|\bdev\b|разработ|программ|инженер/i],
];

/** The zone for an agent, or undefined for "anywhere". */
export function seatZoneFor(agent: SeatAgent): string | undefined {
  if (agent.isGod) return 'theo';
  if (/^temp-/.test(agent.id)) return 'guests';
  const text = [agent.role, agent.description, agent.name].filter(Boolean).join(' ');
  for (const [zone, words] of RULES) if (words.test(text)) return zone;
  return undefined;
}

/** Index of the first free seat whose name says it is in `zone` (`<zone>-seat-N`),
 *  skipping index 0 (the boss's). -1 when none is free. */
export function freeSeatInZone(zone: string, seatNames: ReadonlyArray<string | null>, taken: ReadonlySet<number>): number {
  for (let i = 1; i < seatNames.length; i++) {
    if (!taken.has(i) && seatNames[i]?.startsWith(`${zone}-seat-`)) return i;
  }
  return -1;
}
