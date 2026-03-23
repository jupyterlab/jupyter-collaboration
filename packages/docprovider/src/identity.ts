/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { User } from '@jupyterlab/services';

/**
 * For PoC flows, allow overriding RTC identity from `?username=...`.
 */
export function getRtcIdentity(
  identity: User.IIdentity | null
): User.IIdentity {
  const username = getUsernameFromUrl();
  const anonymousFallback: User.IIdentity = {
    username: 'anonymous',
    name: 'Anonymous',
    display_name: 'Anonymous',
    initials: 'AN',
    color: '#9e9e9e'
  };
  const currentIdentity = identity ?? anonymousFallback;

  if (!username) {
    return currentIdentity;
  }

  const fallbackIdentity: User.IIdentity = {
    username,
    name: username,
    display_name: username,
    initials: initialsFromName(username),
    color: colorFromUsername(username)
  };
  const identityToUpdate = identity ?? fallbackIdentity;

  const color =
    typeof identityToUpdate.color === 'string'
      ? identityToUpdate.color
      : colorFromUsername(username);

  return {
    ...identityToUpdate,
    username,
    name: username,
    display_name: username,
    initials: initialsFromName(username),
    color
  };
}

function getUsernameFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const query = new URLSearchParams(window.location.search);
  const fromSearch = query.get('username');
  if (fromSearch && fromSearch.trim()) {
    return fromSearch.trim();
  }

  // Some JupyterLab routes can move query params into hash fragments.
  const hash = window.location.hash || '';
  const hashQueryIndex = hash.indexOf('?');
  if (hashQueryIndex === -1) {
    return null;
  }
  const hashQuery = new URLSearchParams(hash.slice(hashQueryIndex + 1));
  const fromHash = hashQuery.get('username');
  return fromHash && fromHash.trim() ? fromHash.trim() : null;
}

function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return 'U';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function colorFromUsername(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}
