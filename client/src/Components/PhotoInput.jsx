import { Box, Button, CloseButton, Image, Input, Loader, Text } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import classNames from 'classnames';

import DropzoneUploader from './DropzoneUploader';
import classes from './PhotoInput.module.css';

function PhotoInput ({ children, description, disabled, error, id, label, name, onChange, defaultValue, value, valueUrl, deferred = false, onFileChange }) {
  const [_value, handleChange] = useUncontrolled({
    value,
    defaultValue,
    finalValue: '',
    onChange,
  });

  function onRemoved () {
    handleChange('');
    onFileChange?.(null);
  }

  function onUploaded (status) {
    handleChange(status.filename);
  }

  return (
    <Input.Wrapper label={label} description={description} error={error}>
      <Input renderRoot={(props) => (
        <Box h='auto' {...props}>
          <DropzoneUploader
            id={id}
            multiple={false}
            deferred={deferred}
            onSelected={onFileChange}
            disabled={disabled || (!!_value && _value !== '')}
            onRemoved={onRemoved}
            onUploaded={onUploaded}
          >
            {({ statuses, onRemove, onRetry }) => {
              if (statuses.length > 0) {
                return statuses.map((s) => (
                  <Box
                    key={s.id}
                    className={classNames(classes.preview, {
                      [classes['preview--uploading']]: s.status === 'pending' || s.status === 'uploading',
                    })}
                  >
                    <Image src={s.file.preview} alt='' />
                    <CloseButton disabled={disabled} aria-label='Remove photo' onClick={(event) => { event.stopPropagation(); onRemove(s); }} className={classes.remove} />
                    <Loader className={classes.spinner} />
                    {s.status === 'error' && <Box p='xs'><Text c='red' role='alert'>{s.error?.response?.data?.errors?.map(({ message }) => message).join(' ') || s.error?.response?.data?.message || 'Photo upload failed.'}</Text><Button disabled={disabled} type='button' size='xs' onClick={(event) => { event.stopPropagation(); onRetry(s); }}>Retry upload</Button></Box>}
                  </Box>
                ));
              } else if (statuses.length === 0 && _value) {
                return (
                  <Box className={classes.preview}>
                    {valueUrl ? <Image src={valueUrl} alt='Uploaded photo' /> : <Text p='md'>Photo uploaded and attached.</Text>}
                    <CloseButton disabled={disabled} aria-label='Remove photo' className={classes.remove} onClick={(event) => { event.stopPropagation(); onRemoved(); }} />
                  </Box>
                );
              } else if (statuses.length === 0 && !_value) {
                return children || <Text className='clickable' inherit={false} fz='sm' my='sm'>Drag-and-drop a photo file here, or click here to browse and select a file. JPEG, PNG, WebP or GIF, up to 10 MiB.</Text>;
              }
            }}
          </DropzoneUploader>
        </Box>
      )}
      />
    </Input.Wrapper>
  );
}

export default PhotoInput;
