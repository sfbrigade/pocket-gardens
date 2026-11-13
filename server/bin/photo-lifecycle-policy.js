#!/usr/bin/env node
// Produces a MERGED document on stdout; never calls a storage mutation API.
// Redirect output to a new file, leaving the bucket's downloaded rules intact.
import fs from 'node:fs/promises';
import { uploadRetentionDays } from '#lib/upload-policy.js';

const [existingFile, ...extra] = process.argv.slice(2);
if (!existingFile || extra.length) throw new Error('Usage: node bin/photo-lifecycle-policy.js existing-lifecycle.json > proposed-lifecycle.json');
const current = JSON.parse(await fs.readFile(existingFile, 'utf8'));
if (!Array.isArray(current.Rules)) throw new Error('Expected a lifecycle document with a Rules array');
const days = uploadRetentionDays();
const ids = ['pocket-gardens-staging-expiration', 'pocket-gardens-staging-markers'];
const rules = current.Rules.filter(({ ID }) => !ids.includes(ID));
rules.push({ ID: ids[0], Status: 'Enabled', Filter: { Prefix: '_uploads/' }, Expiration: { Days: days }, NoncurrentVersionExpiration: { NoncurrentDays: days }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } });
rules.push({ ID: ids[1], Status: 'Enabled', Filter: { Prefix: '_uploads/' }, Expiration: { ExpiredObjectDeleteMarker: true } });
console.log(JSON.stringify({ ...current, Rules: rules }, null, 2));
