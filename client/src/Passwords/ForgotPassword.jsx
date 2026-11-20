import { Link, useLocation, useSearchParams } from 'react-router';
import { Alert, Box, Button, Container, Fieldset, Group, Stack, TextInput, Title } from '@mantine/core';
import { isEmail, useForm } from '@mantine/form';
import { useMutation } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from '../Api';
import { authPath, loginDestination } from '../LoginDestination';

function ForgotPassword () {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const from = loginDestination(searchParams.get('from'));
  const form = useForm({
    initialValues: {
      email: location.state?.email || '',
    },
    validate: {
      email: isEmail('Please enter a valid email address.'),
    },
    onValuesChange: () => {
      form.clearErrors();
      onSubmitMutation.reset();
    },
  });

  const onSubmitMutation = useMutation({
    mutationFn: (values) => Api.passwords.reset(values.email, authPath('/passwords/reset', from)),
    onError: (errors) => form.setErrors(errors),
    onSettled: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  });

  return (
    <>
      <Head>
        <title>Set or reset your password</title>
      </Head>
      <Container>
        <Title mb='md'>Set or reset your password</Title>
        <form onSubmit={form.onSubmit(onSubmitMutation.mutate)}>
          <Fieldset disabled={onSubmitMutation.isPending} variant='unstyled'>
            <Stack w={{ base: '100%', xs: 320 }}>
              {form.errors._form && <Alert color='red'>{form.errors._form}</Alert>}
              {onSubmitMutation.isSuccess && <Alert>If an account exists for that email, a link to set or reset your password will arrive shortly. Check your inbox.</Alert>}
              <Box>Enter your account email. We&apos;ll send a link to add a password or replace your existing one.</Box>
              <TextInput
                {...form.getInputProps('email')}
                key='email'
                label='Email'
                type='email'
                autoComplete='email'
              />
              <Group>
                <Button type='submit' loading={onSubmitMutation.isPending}>Email me a password link</Button>
              </Group>
              <Box>
                <Link to={authPath('/login', from)} state={{ email: form.values.email, loginMethod: 'password' }}>Back to login...</Link>
              </Box>
            </Stack>
          </Fieldset>
        </form>
      </Container>
    </>
  );
}

export default ForgotPassword;
