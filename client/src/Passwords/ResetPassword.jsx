import { useParams, useSearchParams, Link } from 'react-router';
import { Alert, Box, Button, Container, Fieldset, Group, Stack, TextInput, Title } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { useMutation } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from '../Api';
import { authPath, loginDestination } from '../LoginDestination';

function ResetPassword () {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const token = params.token || searchParams.get('token');
  const from = loginDestination(searchParams.get('from'));

  const form = useForm({
    initialValues: {
      password: '',
    },
    validate: {
      password: hasLength({ min: 8, max: 128 }, 'Passwords must be between 8 and 128 characters.'),
    },
  });

  const onSubmitMutation = useMutation({
    mutationFn: (values) => Api.passwords.update(token, values.password),
    // Reload the current session and discard cached profiles after session revocation.
    onSuccess: () => window.location.assign(authPath('/login?passwordReset=success', from)),
    onError: (errors) => form.setErrors(errors),
    onSettled: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  });

  return (
    <>
      <Head>
        <title>Set your password</title>
        <meta name='referrer' content='no-referrer' />
      </Head>
      <Container>
        <Title mb='md'>Set your password</Title>
        <form onSubmit={form.onSubmit(onSubmitMutation.mutate)}>
          <Fieldset disabled={onSubmitMutation.isPending} variant='unstyled'>
            <Stack w={{ base: '100%', xs: 320 }}>
              {!token && (
                <Alert color='red'>
                  Sorry, this password reset link is invalid.<br />
                  <Link to={authPath('/passwords/forgot', from)}>Request another?</Link>
                </Alert>
              )}
              {form.errors._form && (
                <Alert color='red'>
                  {form.errors._form}<br />
                  <Link to={authPath('/passwords/forgot', from)}>Request another?</Link>
                </Alert>
              )}
              {token && (
                <>
                  <Box>Enter a new password for your account.</Box>
                  <TextInput
                    {...form.getInputProps('password')}
                    key='password'
                    label='New password'
                    type='password'
                    autoComplete='new-password'
                  />
                  <Group>
                    <Button type='submit' loading={onSubmitMutation.isPending}>
                      Save password
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          </Fieldset>
        </form>
      </Container>
    </>
  );
}

export default ResetPassword;
