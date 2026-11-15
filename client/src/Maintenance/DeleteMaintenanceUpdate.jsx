import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import Api from '../Api';
import { maintenanceError } from './maintenance-draft';

export default function DeleteMaintenanceUpdate ({ record, plotId }) {
  const client = useQueryClient();
  const [version, setVersion] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflicted, setConflicted] = useState(false);
  async function remove () {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await Api.maintenance.remove(record.id, version);
      client.removeQueries({ queryKey: ['maintenance-record', record.id] });
      await client.resetQueries({ queryKey: ['maintenance', plotId] });
      setVersion(null);
    } catch (failure) {
      if (failure.response?.status === 404) {
        await client.resetQueries({ queryKey: ['maintenance', plotId] });
        setVersion(null);
      } else {
        setError(maintenanceError(failure));
        if (failure.response?.status === 409) setConflicted(true);
      }
    } finally { setSaving(false); }
  }
  return (
    <>
      <Button color='red' variant='subtle' onClick={() => { setVersion(record.version); setError(''); setConflicted(false); }}>Delete update</Button>
      <Modal opened={version !== null} onClose={() => { if (!saving) setVersion(null); }} title='Delete this update?' closeOnEscape={!saving} closeOnClickOutside={!saving}>
        <Stack>
          <Text>This removes the update from garden history. Its data and attached photos are retained internally. There is no restore screen.</Text>
          {error && <Alert color='red' role='alert'>{error}</Alert>}
          {conflicted && <Button variant='light' onClick={async () => { setVersion(null); await client.resetQueries({ queryKey: ['maintenance', plotId] }); }}>Refresh history to review</Button>}
          <Group><Button color='red' loading={saving} disabled={conflicted} onClick={remove}>Delete this update</Button><Button variant='subtle' disabled={saving} onClick={() => setVersion(null)}>Keep update</Button></Group>
        </Stack>
      </Modal>
    </>
  );
}
