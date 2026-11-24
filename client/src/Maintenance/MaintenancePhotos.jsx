import { useCallback, useState } from 'react';
import { Button, Group, Image, Stack, Text } from '@mantine/core';
import DropzoneUploader from '../Components/DropzoneUploader';

export default function MaintenancePhotos ({ photos, onChange, disabled, onUploadStateChange }) {
  const [statuses, setStatuses] = useState([]);
  const notify = useCallback((next) => {
    setStatuses(next);
    onUploadStateChange({
      busy: next.some(({ status }) => status === 'pending' || status === 'uploading'),
      failed: next.some(({ status }) => status === 'error'),
    });
  }, [onUploadStateChange]);
  const restored = photos.filter((photo) => !statuses.some(({ filename }) => filename === photo.upload));
  return (
    <Stack gap='xs'>
      <Text fw={500}>Photos — up to four, 10 MiB each</Text>
      {restored.map((photo, index) => (
        <Group key={photo.id || photo.upload}>
          {photo.url ? <Image src={photo.url} alt={`Existing visit photo ${index + 1}`} w={100} h={80} fit='cover' /> : <Text>Uploaded photo {index + 1} is attached.</Text>}
          <Button variant='subtle' color='red' disabled={disabled} onClick={() => onChange((current) => current.filter((item) => item !== photo))}>Remove attached photo {index + 1}</Button>
        </Group>
      ))}
      <DropzoneUploader multiple maxFiles={Math.max(0, 4 - restored.length)} disabled={disabled || restored.length >= 4} onStatusChange={notify} onUploaded={({ filename }) => onChange((current) => [...current, { upload: filename }])} onRemoved={({ filename }) => onChange((current) => current.filter((photo) => photo.upload !== filename))}>
        {({ statuses, onRemove, onRetry }) => (
          <Stack gap='xs'>
            {!disabled && statuses.length + restored.length < 4 && <Button type='button' variant='light'>Take or choose photos (JPEG, PNG, WebP, GIF)</Button>}
            {statuses.map((status) => (
              <Group key={status.id}>
                <Image src={status.file.preview} alt='Selected visit photo' w={100} h={80} fit='cover' />
                <Text>{status.status === 'uploaded' ? 'Ready to save' : status.status === 'error' ? 'Upload failed. Retry or remove this photo before saving.' : 'Uploading…'}</Text>
                <Button type='button' disabled={disabled} color='red' variant='subtle' onClick={(event) => { event.stopPropagation(); onRemove(status); }}>Remove selected photo</Button>
                {status.status === 'error' && <Button type='button' disabled={disabled} onClick={(event) => { event.stopPropagation(); onRetry(status); }}>Retry photo upload</Button>}
              </Group>
            ))}
          </Stack>
        )}
      </DropzoneUploader>
    </Stack>
  );
}
