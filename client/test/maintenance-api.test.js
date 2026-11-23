import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';

test('maintenance deletion accepts already-removed records and surfaces conflicts', async (t) => {
  let status = 404;
  const adapter = axios.defaults.adapter;
  t.after(() => { axios.defaults.adapter = adapter; });
  axios.defaults.adapter = async (config) => {
    assert.equal(config.method, 'delete');
    assert.equal(config.url, '/api/maintenance-records/visit');
    assert.deepEqual(JSON.parse(config.data), { version: 1 });
    const response = { status };
    if (!config.validateStatus(status)) throw new axios.AxiosError('Delete failed', undefined, config, undefined, response);
    return response;
  };
  const { default: Api } = await import('../src/Api.js');

  assert.equal((await Api.maintenance.remove('visit', 1)).status, 404);
  status = 204;
  assert.equal((await Api.maintenance.remove('visit', 1)).status, 204);
  status = 409;
  await assert.rejects(Api.maintenance.remove('visit', 1), error => axios.isAxiosError(error) && error.response?.status === 409);
});
