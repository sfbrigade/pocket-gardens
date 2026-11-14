import Api from './Api';

export default async function uploadPhoto ({ file, signal }) {
  signal?.throwIfAborted();
  const { data } = await Api.assets.create({ filename: file.name, contentType: file.type || 'application/octet-stream', byteSize: file.size }, signal);
  signal?.throwIfAborted();
  await Api.assets.upload(data.url, data.headers, file, signal);
  signal?.throwIfAborted();
  return data.filename;
}
