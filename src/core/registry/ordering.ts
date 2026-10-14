import type { DomainDefinition } from './types';

/**
 * Catalogue ordering for data elements: priority domains first, in the order
 * given, then every other domain alphabetically, then anything not assigned to
 * a domain. Within a domain, entries are alphabetical by display name.
 *
 * Priority is configuration (`PRIORITY_DOMAIN_IDS`), keyed by domain id rather
 * than detected from a name, so renaming a domain cannot move it and a domain
 * that merely mentions adolescents is not promoted.
 */
export function orderDomains<T extends Pick<DomainDefinition, 'id' | 'name'>>(
  domains: T[],
  priorityIds: string[],
): T[] {
  const rank = (domain: T) => {
    const index = priorityIds.indexOf(domain.id);
    return index === -1 ? priorityIds.length : index;
  };
  return [...domains].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'en-GB'));
}

export interface DomainGroup<T> {
  domainId: string | null;
  domainName: string;
  items: T[];
}

export function groupByDomain<T extends { name: string; domainId: string | null }>(
  items: T[],
  domains: Array<Pick<DomainDefinition, 'id' | 'name'>>,
  priorityIds: string[],
): Array<DomainGroup<T>> {
  const byDomain = new Map<string | null, T[]>();
  for (const item of items) {
    const key = item.domainId && domains.some((domain) => domain.id === item.domainId) ? item.domainId : null;
    byDomain.set(key, [...(byDomain.get(key) ?? []), item]);
  }
  const sortItems = (list: T[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }));
  const groups: Array<DomainGroup<T>> = orderDomains(domains, priorityIds)
    .filter((domain) => byDomain.has(domain.id))
    .map((domain) => ({ domainId: domain.id, domainName: domain.name, items: sortItems(byDomain.get(domain.id)!) }));
  if (byDomain.has(null)) {
    groups.push({ domainId: null, domainName: 'Not assigned to a domain', items: sortItems(byDomain.get(null)!) });
  }
  return groups;
}
