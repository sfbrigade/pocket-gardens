import { Box, Button, CloseButton, Image, Input, Loader, Text } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import classNames from 'classnames';

import DropzoneUploader from './DropzoneUploader';
import classes from './PhotoInput.module.css';

function PhotoInput ({ children, description, disabled, error, id, label, name, onChange, onUploadStateChange, defaultValue, value, valueUrl }) {
  const [_value, handleChange] = useUncontrolled({
    value,
    defaultValue,
    finalValue: '',
    onChange,
  });

  function onRemoved () {
    handleChange('');
    onUploadStateChange?.('idle');
  }

  function onUploaded (status) {
    handleChange(status.filename);
    onUploadStateChange?.('uploaded');
  }

  return (
    <Input.Wrapper label={label} description={description} error={error}>
      <Input renderRoot={(props) => (
        <Box h='auto' {...props}>
          <DropzoneUploader
            id={id}
            multiple={false}
            disabled={disabled || (!!_value && _value !== '')}
            onRemoved={onRemoved}
            onUploaded={onUploaded}
            onUploading={() => onUploadStateChange?.('uploading')}
            onUploadError={() => onUploadStateChange?.('error')}
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
                    <CloseButton aria-label='Remove photo' onClick={(event) => { event.stopPropagation(); onRemove(s); }} className={classes.remove} />
                    <Loader className={classes.spinner} />
                    {s.status === 'error' && <Box p='xs'><Text c='red' role='alert'>Photo upload failed.</Text><Button type='button' size='xs' onClick={(event) => { event.stopPropagation(); onRetry(s); }}>Retry upload</Button></Box>}
                  </Box>
                ));
              } else if (statuses.length === 0 && _value) {
                return (
                  <Box className={classes.preview}>
                    {valueUrl ? <Image src={valueUrl} alt='Uploaded photo' /> : <Text p='md'>Photo uploaded and attached.</Text>}
                    <CloseButton aria-label='Remove photo' className={classes.remove} onClick={(event) => { event.stopPropagation(); onRemoved(); }} />
                  </Box>
                );
              } else if (statuses.length === 0 && !_value) {
                return children || <Text className='clickable' inherit={false} fz='sm' my='sm'>Drag-and-drop a photo file here, or click here to browse and select a file.</Text>;
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
