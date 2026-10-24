import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';

let respond;
axios.defaults.adapter = async (config) => respond(config);
const { default: Api } = await import('../src/Api.js');

test('plot creation errors retain recovery information and field validation', async () => {
  respond = async () => {
    throw new axios.AxiosError('Conflict', undefined, undefined, undefined, { status: 409, data: { message: 'Already saved', plotId: 'pg_saved' } });
  };
  await assert.rejects(Api.plots.create({}), (error) => error.plotId === 'pg_saved' && error._form === 'Already saved');
  respond = async () => {
    throw new axios.AxiosError('Invalid', undefined, undefined, undefined, { status: 422, data: { errors: [{ path: 'plants', message: 'Select a plant' }] } });
  };
  await assert.rejects(Api.plots.create({}), (error) => error.plants === 'Select a plant');
});
