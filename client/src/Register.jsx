import { useNavigate, Link, useLocation, useSearchParams } from 'react-router';
import { Box, Container, Stack, Title } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from './Api';
import RegistrationForm from './RegistrationForm';
import { authPath, loginDestination } from './LoginDestination';

function Register () {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const from = loginDestination(searchParams.get('from'));

  const onSubmitMutation = useMutation({
    mutationFn: (values) => Api.auth.register({ ...values, callbackURL: values.registrationMethod === 'magic-link' ? from : authPath('/login', from) }),
    onSuccess: (_, values) => navigate(authPath('/login', from), {
      state: {
        email: values.email,
        loginMethod: values.registrationMethod,
        flash: values.registrationMethod === 'magic-link'
          ? 'Check your inbox for a link to complete registration and log in. If you already have an account, the link will log you in.'
          : 'Please check your email to verify your account before logging in.',
      }
    }),
    onError: () => window.scrollTo(0, 0),
  });

  return (
    <>
      <Head>
        <title>Register</title>
      </Head>
      <Container>
        <Title mb='md'>Register</Title>
        <Stack>
          <RegistrationForm onSubmitMutation={onSubmitMutation} initialEmail={location.state?.email} />
          <Box>
            <Link to={authPath('/login', from)} state={{ email: location.state?.email }}>Already have an account?</Link>
          </Box>
        </Stack>
      </Container>
    </>
  );
}

export default Register;
