import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone-esm';
import { v4 as uuid } from 'uuid';

import uploadPhoto from '../upload-photo';

function DropzoneUploader ({ className, children, disabled, id, maxFiles, multiple, onRemoved, onUploaded, onUploading, onUploadError, deferred = false, onSelected }) {
  const [statuses, setStatuses] = useState([]);
  const [rejectedFiles, setRejectedFiles] = useState([]);
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  const active = useRef(false);
  const uploads = useRef(new Map());
  const previews = useRef(new Map());
  const mutation = useMutation({
    mutationFn: uploadPhoto,
    retry: false,
  });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      for (const controller of uploads.current.values()) controller.abort();
      for (const url of previews.current.values()) URL.revokeObjectURL(url);
      uploads.current.clear();
      previews.current.clear();
    };
  }, []);

  async function upload (status) {
    const controller = new AbortController();
    uploads.current.set(status.id, controller);
    setStatuses((current) => current.map((entry) => entry.id === status.id ? { ...entry, status: 'uploading', error: null } : entry));
    onUploading?.(status);
    try {
      const filename = await mutation.mutateAsync({ file: status.file, signal: controller.signal });
      if (controller.signal.aborted || !uploads.current.has(status.id)) return;
      const completed = { ...status, filename, status: 'uploaded', error: null };
      onUploaded?.(completed);
      setStatuses((current) => current.map((entry) => entry.id === status.id ? completed : entry));
    } catch (error) {
      if (controller.signal.aborted || !uploads.current.has(status.id)) return;
      const failed = { ...status, status: 'error', error };
      setStatuses((current) => current.map((entry) => entry.id === status.id ? failed : entry));
      onUploadError?.(failed);
    } finally {
      if (uploads.current.get(status.id) === controller) uploads.current.delete(status.id);
    }
  }

  function onDropAccepted (files) {
    if (!active.current || disabledRef.current) return;
    setRejectedFiles([]);
    const next = files.map((file) => {
      const id = uuid();
      const preview = URL.createObjectURL(file);
      previews.current.set(id, preview);
      return { id, file: Object.assign(file, { preview }), status: deferred ? 'selected' : 'pending', filename: null };
    });
    setStatuses(next);
    if (deferred) onSelected?.(files[0]);
    else for (const status of next) upload(status);
  }

  function onRemove (status) {
    uploads.current.get(status.id)?.abort();
    uploads.current.delete(status.id);
    URL.revokeObjectURL(previews.current.get(status.id));
    previews.current.delete(status.id);
    setStatuses((current) => current.filter(({ id }) => id !== status.id));
    onRemoved?.(status);
  }

  const { getRootProps, getInputProps } = useDropzone({
    id,
    multiple,
    maxFiles: maxFiles ?? 0,
    maxSize: 10 * 1024 * 1024,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [], 'image/gif': [] },
    onDropAccepted,
    onDropRejected: setRejectedFiles,
    disabled: disabled || statuses.length > 0,
  });

  return (
    <div className={className}>
      <div {...getRootProps()}>
        <input {...getInputProps()} />
        {children({ statuses, onRemove, onRetry: upload, rejectedFiles })}
      </div>
      {rejectedFiles.map(({ file, errors }) => <p role='alert' key={file.name}>{errors.map(({ message }) => message).join(', ')}</p>)}
    </div>
  );
}

export default DropzoneUploader;
