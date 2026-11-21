import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Api from '../Api';

export default function DeleteMaintenanceUpdate ({ record, plotId }) {
  const client = useQueryClient();
  const [version, setVersion] = useState(null);
  const historyQuery = { queryKey: ['maintenance', plotId], exact: true };
  const mutation = useMutation({
    mutationFn: async ({ id, version }) => {
      try {
        await Api.maintenance.remove(id, version);
      } catch (error) {
        if (error.response?.status !== 404) throw error;
      }
    },
    onSuccess: (_result, { id }) => {
      client.resetQueries({ queryKey: ['maintenance-record', id], exact: true });
      client.resetQueries(historyQuery);
    },
  });
  const saving = mutation.isPending;
  const conflicted = mutation.error?.response?.status === 409;

  return (
    <>
      <Button color='red' variant='subtle' onClick={() => { mutation.reset(); setVersion(record.version); }}>Delete update</Button>
      <Modal opened={version !== null} onClose={() => { if (!saving) setVersion(null); }} title='Delete this update?' closeOnEscape={!saving} closeOnClickOutside={!saving}>
        <Stack>
          <Text>This removes the update from garden history. Its data and attached photos are retained internally. There is no restore screen.</Text>
          {mutation.isError && <Alert color='red' role='alert'>{mutation.error.response?.data?.message || 'Unable to delete this update. Try again.'}</Alert>}
          {conflicted && <Button variant='light' onClick={() => { setVersion(null); client.resetQueries(historyQuery); }}>Refresh history to review</Button>}
          <Group>
            <Button color='red' loading={saving} disabled={conflicted} onClick={() => mutation.mutate({ id: record.id, version }, { onSuccess: () => setVersion(null) })}>Delete this update</Button>
            <Button variant='subtle' disabled={saving} onClick={() => setVersion(null)}>Keep update</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
