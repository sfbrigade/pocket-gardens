import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Fieldset, Stack, Text } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import Api from '../Api';
import { useAuthContext } from '../AuthContext';

function UserRoleForm ({ user }) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthContext();
  const editingSelf = user.id === currentUser.id;
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);

  useEffect(() => setIsAdmin(user.isAdmin), [user.id, user.isAdmin]);

  const mutation = useMutation({
    mutationFn: () => Api.users.setRole(user.id, isAdmin ? 'admin' : 'user'),
    onSuccess: ({ data }) => {
      // Keep the confirmed role even if the background profile refresh fails.
      queryClient.setQueryData(['users', user.id], response => response && ({
        ...response,
        data: { ...response.data, isAdmin: data.user.role.split(',').includes('admin') },
      }));
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  function onSubmit (event) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit}>
      <Fieldset legend='Administrator access' disabled={mutation.isPending}>
        <Stack>
          <Text>Email verification: {user.emailVerified ? 'Verified' : 'Pending'}</Text>
          {editingSelf && <Alert>Ask another administrator to change your administrator access.</Alert>}
          {!user.emailVerified && <Alert>This user must verify their email before becoming an administrator.</Alert>}
          {mutation.error && <Alert color='red'>{mutation.error._form || 'Unable to update administrator access. Please try again.'}</Alert>}
          {mutation.isSuccess && <Alert>Administrator access has been updated.</Alert>}
          <Checkbox
            label='Is an Administrator?'
            checked={isAdmin}
            disabled={editingSelf || (!user.emailVerified && !user.isAdmin)}
            onChange={(event) => {
              setIsAdmin(event.currentTarget.checked);
              mutation.reset();
            }}
          />
          <Button type='submit' disabled={editingSelf || isAdmin === user.isAdmin || (isAdmin && !user.emailVerified)}>
            Save administrator access
          </Button>
        </Stack>
      </Fieldset>
    </form>
  );
}

export default UserRoleForm;
