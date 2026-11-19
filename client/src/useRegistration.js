import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';

import Api from './Api';
import { authPath } from './LoginDestination';

export default function useRegistration ({ from, inviteId }) {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (values) => Api.auth.register({
      ...values,
      ...(inviteId ? { inviteId } : {}),
      callbackURL: values.registrationMethod === 'magic-link' ? from : authPath('/login', from),
    }),
    onSuccess: (_, values) => navigate(authPath('/login', from), {
      state: {
        email: values.email,
        loginMethod: values.registrationMethod,
        flash: values.registrationMethod === 'magic-link'
          ? 'Check your inbox for a link to complete registration and log in. If you already have an account, the link will log you in.'
          : 'Please check your email to verify your account before logging in.',
      },
    }),
    onError: () => window.scrollTo(0, 0),
  });
}
