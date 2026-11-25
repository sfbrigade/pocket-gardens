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
  const restoredCount = photos.filter((photo) => !statuses.some(({ filename }) => filename === photo.upload)).length;

  function movePhoto (index, other) {
    onChange((current) => {
      const next = [...current];
      [next[index], next[other]] = [next[other], next[index]];
      return next;
    });
  }

  return (
    <Stack gap='xs'>
      <Text fw={500}>Photos — up to four, 10 MiB each</Text>
      <DropzoneUploader
        multiple
        maxFiles={Math.max(0, 4 - restoredCount)}
        disabled={disabled || restoredCount >= 4}
        onStatusChange={notify}
        onUploaded={({ filename }) => onChange((current) => [...current, { upload: filename }])}
        onRemoved={({ filename }) => onChange((current) => current.filter((photo) => photo.upload !== filename))}
      >
        {({ statuses, onRemove, onRetry }) => (
          <Stack gap='xs'>
            {photos.map((photo, index) => {
              const uploaded = photo.upload && statuses.find(({ filename }) => filename === photo.upload);
              const preview = photo.url || uploaded?.file.preview;
              const number = index + 1;
              return (
                <Group key={photo.id || photo.upload}>
                  {preview ? <Image src={preview} alt={`Visit photo ${number}`} w={100} h={80} fit='cover' /> : <Text>Uploaded photo {number} is attached.</Text>}
                  {uploaded && <Text>Ready to save</Text>}
                  {photos.length > 1 && (
                    <>
                      <Button type='button' variant='subtle' size='compact-xs' disabled={disabled || index === 0} onClick={(event) => { event.stopPropagation(); movePhoto(index, index - 1); }}>Move photo {number} up</Button>
                      <Button type='button' variant='subtle' size='compact-xs' disabled={disabled || index === photos.length - 1} onClick={(event) => { event.stopPropagation(); movePhoto(index, index + 1); }}>Move photo {number} down</Button>
                    </>
                  )}
                  <Button
                    type='button'
                    variant='subtle'
                    color='red'
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (uploaded) onRemove(uploaded);
                      else onChange((current) => current.filter((item) => item !== photo));
                    }}
                  >
                    Remove attached photo {number}
                  </Button>
                </Group>
              );
            })}
            {!disabled && statuses.length + restoredCount < 4 && <Button type='button' variant='light'>Take or choose photos (JPEG, PNG, WebP, GIF)</Button>}
            {statuses.filter(({ status }) => status !== 'uploaded').map((status) => (
              <Group key={status.id}>
                <Image src={status.file.preview} alt='Selected visit photo' w={100} h={80} fit='cover' />
                <Text>{status.status === 'error' ? 'Upload failed. Retry or remove this photo before saving.' : 'Uploading…'}</Text>
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
