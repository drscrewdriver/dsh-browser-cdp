/**
 * Single source of truth for the client bundle's build id.
 *
 * Both halves import it: the client stamps it in the panel title, the host serves
 * it from `/api/bcdp/stats` so a running renderer can notice it is behind and
 * reload itself once (the module URL DSH serves has a revision that does not
 * change with file contents, so the browser happily keeps an old bundle).
 *
 * Keep in sync with package.json — `node scripts/bump.mjs <version>` writes both.
 */
export const CLIENT_BUILD = '1.9.50'
