import { useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { Alert, Button, Checkbox, Container, Fieldset, Group, Loader, Stack, TextInput, Title } from '@mantine/core';
import { hasLength, isEmail, isNotEmpty, useForm } from '@mantine/form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from '../Api';
import { useAuthContext } from '../AuthContext';
import PhotoInput from '../Components/PhotoInput';

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
  const location = useLocation();

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      firstName: '',
      lastName: '',
      email: '',
      picture: '',
      pictureUrl: '',
      isAdmin: false,
      ...user,
      password: '',
    },
    validate: {
      firstName: isNotEmpty('First name is required.'),
      lastName: isNotEmpty('Last name is required.'),
      email: isEmail('Please enter a valid email address.'),
      password: (value) => value ? hasLength({ min: 8 }, 'Passwords must be at least 8 characters.') : null,
    },
  });

  const onSubmitMutation = useMutation({
    mutationFn: (values) => Api.users.update(userId, values),
    onMutate: () => setSuccess(false),
    onSuccess: (response) => {
      if (userId === authContext.user.id) {
        authContext.setUser(response.data);
      }
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
        <form onSubmit={form.onSubmit(onSubmitMutation.mutateAsync)}>
          <Fieldset variant='unstyled'>
            <Stack w={{ base: '100%', xs: 320 }}>
              {location.state?.flash && <Alert>{location.state?.flash}</Alert>}
              {form.errors?._form && <Alert color='red'>{form.errors._form}</Alert>}
              {success && <Alert>Your account has been updated!</Alert>}
              <PhotoInput
                {...form.getInputProps('picture')}
                key={form.key('picture')}
                label='Picture'
                valueUrl={form.getValues().pictureUrl}
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
              <TextInput
                {...form.getInputProps('email')}
                key={form.key('email')}
                label='Email'
                type='email'
              />
              <TextInput
                {...form.getInputProps('password')}
                key={form.key('password')}
                label='Password'
                type='password'
              />
              {authContext.user.isAdmin && (
                <Checkbox
                  {...form.getInputProps('isAdmin', { type: 'checkbox' })}
                  key={form.key('isAdmin')}
                  label='Is an Administrator?'
                />
              )}
              <Group>
                <Button disabled={onSubmitMutation.isPending} type='submit'>Submit</Button>
              </Group>
            </Stack>
          </Fieldset>
        </form>
      </Container>
    </>
  );
}

export default UserForm;
