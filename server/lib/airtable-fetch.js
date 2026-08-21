/**
 * Paginated Airtable list helper shared by import / migrate CLIs.
 */

/**
 * @param {string} apiKey
 * @param {string} baseId
 * @param {string} tableName
 * @returns {Promise<object[]>}
 */
export async function listAllRecords (apiKey, baseId, tableName) {
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error?.message || response.statusText);
      err.status = response.status;
      throw err;
    }
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}
