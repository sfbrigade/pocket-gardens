import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Alert, Button, Container, Fieldset, Group, Loader, Stack, Text, TextInput, Title } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from '../Api';
import { useAuthContext } from '../AuthContext';
import PhotoInput from '../Components/PhotoInput';
import UserRoleForm from './UserRoleForm';

function UserForm () {
  const authContext = useAuthContext();
  const params = useParams();
  const userId = params.userId ?? authContext.user.id;
  const query = useQuery({
    queryKey: ['users', userId],
    queryFn: () => Api.users.get(userId),
    enabled: !!userId,
  });

  if (query.isPending) return <Container><Loader aria-label='Loading account' /></Container>;
  if (query.isError && !query.data) return <Container><Alert color='red' title='Unable to load account'><Button variant='subtle' onClick={() => query.refetch()}>Try again</Button></Alert></Container>;
  return <UserEditor key={userId} userId={userId} user={query.data.data} />;
}

function UserEditor ({ userId, user }) {
  const authContext = useAuthContext();
  const queryClient = useQueryClient();
  const location = useLocation();

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { firstName: user.firstName, lastName: user.lastName, picture: user.picture },
    validate: {
      firstName: hasLength({ min: 2, max: 30 }, 'First name must be between 2 and 30 characters long.'),
      lastName: hasLength({ min: 2, max: 30 }, 'Last name must be between 2 and 30 characters long.'),
    },
  });

  const onSubmitMutation = useMutation({
    mutationFn: (values) => Api.users.update(userId, values),
    onMutate: () => setSuccess(false),
    onSuccess: (response) => {
      queryClient.setQueryData(['users', userId], response);
      if (userId === authContext.user.id) {
        queryClient.setQueryData(['users', 'me'], response.data);
      }
      form.setValues({ firstName: response.data.firstName, lastName: response.data.lastName, picture: response.data.picture });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setSuccess(true);
    },
    onError: (errors) => form.setErrors(errors),
    onSettled: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  });
  const [success, setSuccess] = useState(false);

  return (
    <>
      <Head>
        <title>My Account</title>
      </Head>
      <Container>
        <Title mb='md'>My Account</Title>
        <form onSubmit={form.onSubmit(onSubmitMutation.mutate)}>
          <Fieldset disabled={onSubmitMutation.isPending} legend='Profile'>
            <Stack w={{ base: '100%', xs: 320 }}>
              {location.state?.flash && <Alert>{location.state?.flash}</Alert>}
              {form.errors?._form && <Alert color='red'>{form.errors._form}</Alert>}
              {success && <Alert>Your account has been updated!</Alert>}
              <PhotoInput
                {...form.getInputProps('picture')}
                key={form.key('picture')}
                label='Picture'
                valueUrl={user.pictureUrl}
              />
              <TextInput
                {...form.getInputProps('firstName')}
                key={form.key('firstName')}
                label='First name'
              />
              <TextInput
                {...form.getInputProps('lastName')}
                key={form.key('lastName')}
                label='Last name'
              />
              <TextInput value={user.email} label='Email' type='email' readOnly />
              <Group>
                <Button disabled={onSubmitMutation.isPending} type='submit'>Submit</Button>
              </Group>
            </Stack>
          </Fieldset>
        </form>
        {userId === authContext.user.id && (
          <Fieldset legend='Sign-in options' mt='md'>
            <Stack>
              <Text size='sm'>You can log in with an email link without a password. Add a password if you also want to use password login.</Text>
              <Link to='/passwords/forgot?from=%2Faccount' state={{ email: user.email }}>Set or reset your password</Link>
            </Stack>
          </Fieldset>
        )}
        {authContext.user.isAdmin && <UserRoleForm user={user} />}
      </Container>
    </>
  );
}

export default UserForm;
