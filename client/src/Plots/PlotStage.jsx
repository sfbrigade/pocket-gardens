import { useEffect, useId } from 'react';
import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import Api from '../Api';
import { cacheUpdatedPlot, plotStageLabel } from '../plots';

export default function PlotStage ({ plot }) {
  const { plotId } = useParams();
  const client = useQueryClient();
  const modalId = useId();
  const mutationKey = ['plot-stage', plot.id];
  const filter = { mutationKey, exact: true };
  const saving = useIsMutating(filter) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: async (checkOnly) => {
      if (!checkOnly) {
        try {
          const { data } = await Api.plots.update(plot.id, { stage: 'preparing', expectedStage: 'potential' });
          return { garden: data };
        } catch (error) {
          const status = error.response?.status;
          if (status && status !== 409 && status < 500) throw error;
        }
      }
      try {
        const { data } = await Api.plots.get(plot.id);
        return { garden: data, checked: true };
      } catch (error) {
        return { checkError: error };
      }
    },
    onSuccess: ({ garden }) => garden && cacheUpdatedPlot(client, garden, plotId),
  });
  useEffect(() => () => modals.close(modalId), [modalId]);

  const result = mutation.data;
  const error = mutation.error || result?.checkError;
  const status = error?.response?.status;
  const blocked = [401, 403, 404].includes(status);
  const needsCheck = !!result?.checkError && !blocked;
  const errorMessage = {
    401: 'Sign in again to change the garden stage.',
    403: 'You no longer have access to change the garden stage.',
    404: 'This garden is no longer available.',
  }[status] || (needsCheck ? 'Unable to check the current stage. Check again before moving the garden.' : 'Unable to move the garden. Try again.');

  function confirmMove () {
    modals.openConfirmModal({
      modalId,
      title: 'Move this garden to Preparing?',
      children: <Text>The stage for {plot['Pocket Garden Name'] || 'this garden'} will change from Potential site to Preparing.</Text>,
      labels: { confirm: 'Move to Preparing', cancel: 'Cancel' },
      onConfirm: () => { if (!client.isMutating(filter)) mutation.mutate(false); },
    });
  }

  return (
    <Stack gap='xs'>
      <Group>
        <Badge color='green'>{plotStageLabel(plot.stage)}</Badge>
        {plot.stage === 'potential' && !blocked && !needsCheck && (
          <Button variant='light' loading={saving} onClick={confirmMove}>Move to Preparing</Button>
        )}
      </Group>
      {error && <Alert color='red' role='alert'>{errorMessage}</Alert>}
      {needsCheck && <Button variant='subtle' onClick={() => { if (!client.isMutating(filter)) mutation.mutate(true); }}>Check garden stage</Button>}
      {saving && <Text size='sm' role='status'>{mutation.variables ? 'Checking garden stage…' : 'Updating garden stage…'}</Text>}
      {result?.garden && (
        <Alert color={plot.stage === 'preparing' ? 'green' : 'blue'} role='status'>
          {plot.stage === 'preparing'
            ? (result.checked ? 'This garden is already Preparing.' : 'Garden moved to Preparing.')
            : (plot.stage === 'potential' ? 'This garden is still a Potential site. Try moving it again.' : 'The garden stage has changed. Review its current stage above.')}
        </Alert>
      )}
    </Stack>
  );
}
