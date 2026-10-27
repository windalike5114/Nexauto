/** Display grouping only: members retain independent fitment identities. */
export type FriendlyApplication = {
  id: string; seriesId: string | null; seriesName: string; powertrainId: string; engine: string;
  variantId: string; variantName: string; bodyStyle: string; driveType: string; vehicleClass: string;
  displayEngine?: string;
};
export type FriendlyVehicleGroup = { id: string; name: string; applications: FriendlyApplication[] };

/** Expose a detail only when every remaining application agrees on it. */
export function sharedVehicleDetails(applications: FriendlyApplication[]) {
  function shared(key: 'seriesName' | 'engine' | 'variantName') {
    const values = applications.map(app => app[key].trim());
    return values.length && values.every(value => value && !/^(unknown|unspecified|not specified|n\/a)$/i.test(value) && value === values[0]) ? values[0] : undefined;
  }
  return { chassis: shared('seriesName'), engine: shared('engine'), variantName: shared('variantName') };
}

export function selectionApplications(applications: FriendlyApplication[], selection: { variantGroup?: string; applicationIds?: string[]; applicationId?: string }) {
  if (selection.variantGroup) return groupFriendlyApplications(applications).find(group => group.id === selection.variantGroup)?.applications ?? [];
  const ids = new Set(selection.applicationIds?.length ? selection.applicationIds : selection.applicationId ? [selection.applicationId] : []);
  return applications.filter(app => ids.has(app.id));
}

export function friendlyEngine(app: FriendlyApplication) {
  const label=app.displayEngine?.trim() || app.engine.split(/\s*[—–]\s*|\s+-\s+/)[0].replace(/\s*\d+[- ]cyl(?:inders?)?/gi, '').replace(/\s+/g, ' ').trim();
  return /^(unknown|unspecified|not specified|n\/a)$/i.test(label)?'':label;
}
export function groupFriendlyApplications(applications: FriendlyApplication[]): FriendlyVehicleGroup[] {
  const groups = new Map<string, FriendlyVehicleGroup>();
  for (const app of applications) {
    const engine = friendlyEngine(app);
    // Missing identity fields never collapse unrelated configurations together.
    const complete = Boolean(app.bodyStyle && engine && app.driveType);
    const parts = [app.bodyStyle || app.variantName || 'Vehicle configuration', engine, app.driveType].filter(Boolean);
    const id = JSON.stringify([app.bodyStyle.toLowerCase(), engine.toLowerCase(), app.driveType.toLowerCase(), app.vehicleClass.toLowerCase(), complete ? '' : app.id]);
    const name = parts.join(' · ');
    const group = groups.get(id) ?? { id, name, applications: [] };
    if (!group.applications.some(member => member.id === app.id)) group.applications.push(app);
    groups.set(id, group);
  }
  const result = [...groups.values()];
  // Missing fields can produce identical visible labels; retain an exact-code discriminator.
  for (const group of result) if (result.some(other => other.id !== group.id && other.name === group.name)) {
    group.name += ` · ${group.applications[0].seriesName || group.applications[0].engine || group.applications[0].variantName}`;
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function coverageStatus(memberIds: string[], matchedIds: string[]): 'fits' | 'conditional' | 'not-listed' {
  const members = [...new Set(memberIds)], matches = new Set(matchedIds);
  if (!members.length || !members.some(id => matches.has(id))) return 'not-listed';
  return members.every(id => matches.has(id)) ? 'fits' : 'conditional';
}
