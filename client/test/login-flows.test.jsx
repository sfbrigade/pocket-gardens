import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/client';

import Api from '../src/Api';
import StaticContextProvider from '../src/StaticContextProvider';
import AuthContextProvider from '../src/AuthContextProvider';
import Header from '../src/Header';
import Login from '../src/Login';
import EmailLink from '../src/EmailLink';
import Register from '../src/Register';
import ForgotPassword from '../src/Passwords/ForgotPassword';
import ResetPassword from '../src/Passwords/ResetPassword';
import Invite from '../src/Invites/Invite';

vi.mock('../src/Api', () => ({
  default: {
    auth: {
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      sendVerificationEmail: vi.fn(),
      verifyEmail: vi.fn(),
      sendMagicLink: vi.fn(),
      verifyMagicLink: vi.fn(),
    },
    passwords: { reset: vi.fn(), update: vi.fn() },
    users: { me: vi.fn() },
    invites: { get: vi.fn() },
  },
}));

const email = 'member@example.com';
const profile = { id: 'member', firstName: 'Test', lastName: 'Member', email, isAdmin: false };
const from = '/account?tab=profile#password';
const loginEntry = `/login?from=${encodeURIComponent(from)}`;

function Location () {
  const location = useLocation();
  return <output data-testid='location'>{location.pathname}{location.search}{location.hash}</output>;
}

function open (entry = '/login') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <StaticContextProvider value={{ authContext: { user: null }, env: { VITE_FEATURE_REGISTRATION: 'true' } }}>
      <UnheadProvider head={createHead()}>
        <MemoryRouter initialEntries={[entry]}>
          <QueryClientProvider client={queryClient}>
            <MantineProvider>
              <AuthContextProvider>
                <Header opened={false} close={() => {}} toggle={() => {}} />
                <Location />
                <Routes>
                  <Route path='/login' element={<Login />} />
                  <Route path='/register' element={<Register />} />
                  <Route path='/invites/:inviteId' element={<Invite />} />
                  <Route path='/passwords/forgot' element={<ForgotPassword />} />
                  <Route path='/passwords/reset' element={<ResetPassword />} />
                  <Route path='/auth/verify-email' element={<EmailLink action='verify-email' />} />
                  <Route path='/auth/magic-link' element={<EmailLink action='magic-link' />} />
                  <Route path='/account' element={<div>Account destination</div>} />
                  <Route path='/' element={<div>Home destination</div>} />
                </Routes>
              </AuthContextProvider>
            </MantineProvider>
          </QueryClientProvider>
        </MemoryRouter>
      </UnheadProvider>
    </StaticContextProvider>
  );
  return Object.assign(userEvent.setup(), { queryClient });
}

beforeEach(() => {
  vi.clearAllMocks();
  Api.users.me.mockResolvedValue({ status: 204, data: null });
  Api.auth.login.mockResolvedValue({ data: profile });
  Api.auth.logout.mockResolvedValue({ data: { status: true } });
  Api.auth.sendMagicLink.mockResolvedValue({ data: { status: true } });
  Api.auth.sendVerificationEmail.mockResolvedValue({ data: { status: true } });
  Api.auth.verifyEmail.mockResolvedValue({ data: { status: true } });
  Api.auth.verifyMagicLink.mockResolvedValue({ data: profile });
  Api.auth.register.mockResolvedValue({ data: { status: true } });
  Api.passwords.reset.mockResolvedValue({ data: { status: true } });
});

describe('login choices', () => {
  it('starts with email-link login and submits using Enter without requiring a password', async () => {
    const user = open(loginEntry);
    expect(screen.queryByLabelText('Password', { exact: true })).toBeNull();
    await user.type(screen.getByLabelText('Email', { exact: true }), `${email}{Enter}`);
    await waitFor(() => expect(Api.auth.sendMagicLink).toHaveBeenCalledWith(email, from));
    expect(Api.auth.login).not.toHaveBeenCalled();
  });

  it('does not submit an invalid email or an empty password', async () => {
    const user = open();
    await user.click(screen.getByRole('button', { name: 'Email me a login link' }));
    expect(Api.auth.sendMagicLink).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
    await user.click(screen.getByRole('button', { name: 'Log in with password' }));
    expect(Api.auth.login).not.toHaveBeenCalled();
  });

  it('allows existing short passwords and returns to the requested page', async () => {
    const user = open(loginEntry);
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
    await user.type(screen.getByLabelText('Password', { exact: true }), 'test{Enter}');
    await waitFor(() => expect(Api.auth.login).toHaveBeenCalledWith(email, 'test'));
    expect(await screen.findByText('Account destination')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe(from);
  });

  it('clears an email-link success notice when the email changes', async () => {
    const user = open();
    await user.type(screen.getByLabelText('Email', { exact: true }), `${email}{Enter}`);
    await screen.findByText(/a login link will arrive shortly/);
    await user.clear(screen.getByLabelText('Email', { exact: true }));
    expect(screen.queryByText(/a login link will arrive shortly/)).toBeNull();
  });

  it('clears an old verification error and resend action when the email changes', async () => {
    Api.auth.login.mockRejectedValue({ _form: 'Please verify your email before logging in.', _code: 'EMAIL_NOT_VERIFIED' });
    const user = open();
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long password{Enter}');
    await screen.findByRole('button', { name: 'Resend verification email' });
    await user.clear(screen.getByLabelText('Email', { exact: true }));
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).toBeNull();
    expect(screen.queryByText('Please verify your email before logging in.')).toBeNull();
  });

  it('keeps the email and clears old errors when switching methods', async () => {
    Api.auth.sendMagicLink.mockRejectedValue({ _form: 'Too many attempts. Please try again in a few minutes.' });
    const user = open();
    await user.type(screen.getByLabelText('Email', { exact: true }), `${email}{Enter}`);
    await screen.findByText(/Too many attempts/);
    await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
    expect(screen.queryByText(/Too many attempts/)).toBeNull();
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(email);
  });

  it('returns to password login after saving a password', () => {
    open('/login?passwordReset=success');
    expect(screen.getByRole('radio', { name: 'Log in with password' }).checked).toBe(true);
    expect(screen.getByLabelText('Password', { exact: true })).toBeTruthy();
  });

  for (const method of ['password', 'magic-link']) {
    it(`does not overwrite a new ${method} session with an older signed-out response`, async () => {
      let complete;
      const oldSession = new Promise(resolve => { complete = resolve; });
      Api.users.me.mockReturnValueOnce(oldSession);
      const user = open(method === 'password' ? loginEntry : `/auth/magic-link?token=test-token&from=${encodeURIComponent(from)}`);
      await waitFor(() => expect(Api.users.me).toHaveBeenCalled());
      if (method === 'password') {
        await user.type(screen.getByLabelText('Email', { exact: true }), email);
        await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
        await user.type(screen.getByLabelText('Password', { exact: true }), 'a long password{Enter}');
      } else {
        await user.click(screen.getByRole('button', { name: 'Log in' }));
      }
      await screen.findByRole('link', { name: 'Test!' });
      await act(async () => complete({ status: 204, data: null }));
      expect(screen.getByRole('link', { name: 'Test!' })).toBeTruthy();
    });
  }

  it('prevents duplicate requests and method changes while an email link is being sent', async () => {
    let complete;
    Api.auth.sendMagicLink.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const user = open();
    await user.type(screen.getByLabelText('Email', { exact: true }), `${email}{Enter}`);
    expect(screen.getByLabelText('Email', { exact: true }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('radio', { name: 'Log in with password' }).matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Email me a login link' }));
    expect(Api.auth.sendMagicLink).toHaveBeenCalledTimes(1);
    await act(async () => complete({ data: { status: true } }));
  });
});

describe('verification and recovery branches', () => {
  it('keeps the email and destination when the login flow branches into registration', async () => {
    const user = open(loginEntry);
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('link', { name: 'Need an account?' }));
    expect(screen.getByTestId('location').textContent).toBe(`/register?from=${encodeURIComponent(from)}`);
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(email);
    await user.type(screen.getByLabelText('First name'), 'Test');
    await user.type(screen.getByLabelText('Last name'), 'Member');
    await user.click(screen.getByRole('button', { name: 'Email me a registration link' }));
    await screen.findByText(/Check your inbox for a link to complete registration/);
    expect(Api.auth.register).toHaveBeenCalledWith(expect.objectContaining({ email, registrationMethod: 'magic-link', callbackURL: from }));
    expect(screen.getByTestId('location').textContent).toBe(`/login?from=${encodeURIComponent(from)}`);
  });

  it('keeps the resend action available after a temporary verification delivery failure', async () => {
    Api.auth.login.mockRejectedValue({ _form: 'Please verify your email before logging in.', _code: 'EMAIL_NOT_VERIFIED' });
    Api.auth.sendVerificationEmail.mockRejectedValueOnce({ _form: 'Email delivery failed. Please try again.' });
    const user = open();
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long password{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Resend verification email' }));
    await screen.findByText('Email delivery failed. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(await screen.findByText('Please check your email for a verification link.')).toBeTruthy();
  });

  it('resends verification with the intended return page', async () => {
    Api.auth.login.mockRejectedValue({ _form: 'Please verify your email before logging in.', _code: 'EMAIL_NOT_VERIFIED' });
    const user = open(loginEntry);
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long password{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Resend verification email' }));
    await waitFor(() => expect(Api.auth.sendVerificationEmail).toHaveBeenCalledWith(email, `/login?from=${encodeURIComponent(from)}`));
    expect(Api.auth.login).toHaveBeenCalledTimes(1);
  });

  it('retains the email and return page when opening and leaving password recovery', async () => {
    const user = open(loginEntry);
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('link', { name: 'Forgot your password?' }));
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(email);
    expect(new URL(screen.getByRole('link', { name: /Back to login/ }).getAttribute('href'), 'http://app.test').searchParams.get('from')).toBe(from);
    await user.click(screen.getByRole('button', { name: 'Email me a password link' }));
    await waitFor(() => expect(Api.passwords.reset).toHaveBeenCalledWith(email, `/passwords/reset?from=${encodeURIComponent(from)}`));
    await user.click(screen.getByRole('link', { name: /Back to login/ }));
    expect(screen.getByRole('radio', { name: 'Log in with password' }).checked).toBe(true);
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(email);
  });

  it('clears a recovery error when the email is edited', async () => {
    Api.passwords.reset.mockRejectedValueOnce({ _form: 'Temporary network failure.' });
    const user = open('/passwords/forgot');
    await user.type(screen.getByLabelText('Email', { exact: true }), `${email}{Enter}`);
    await screen.findByText('Temporary network failure.');
    await user.clear(screen.getByLabelText('Email', { exact: true }));
    expect(screen.queryByText('Temporary network failure.')).toBeNull();
  });

  it('opens password login with the same destination after email verification', async () => {
    const user = open(`/auth/verify-email?token=test-token&from=${encodeURIComponent(from)}`);
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    await screen.findByText('Your email has been verified. You can now log in.');
    expect(screen.getByRole('radio', { name: 'Log in with password' }).checked).toBe(true);
    expect(screen.getByTestId('location').textContent).toBe(`/login?from=${encodeURIComponent(from)}`);
  });

  it('retains the destination when requesting another expired login link', async () => {
    Api.auth.verifyMagicLink.mockRejectedValue({ _form: 'This link is invalid or has expired. Please request a new one.' });
    const user = open(`/auth/magic-link?token=test-token&from=${encodeURIComponent(from)}`);
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByText(/This link is invalid or has expired/);
    await user.click(screen.getByRole('link', { name: /Back to login|Request a new login link/ }));
    expect(screen.getByTestId('location').textContent).toBe(`/login?from=${encodeURIComponent(from)}`);
  });

  it('retains the email and selects password login after password registration', async () => {
    const user = open('/register');
    await user.type(screen.getByLabelText('First name'), 'Test');
    await user.type(screen.getByLabelText('Last name'), 'Member');
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('radio', { name: 'Register with password' }));
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long password{Enter}');
    await screen.findByText('Please check your email to verify your account before logging in.');
    expect(screen.getByRole('radio', { name: 'Log in with password' }).checked).toBe(true);
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(email);
  });

  it('does not submit a missing reset token and retains the return page when requesting another', async () => {
    const user = open(`/passwords/reset?from=${encodeURIComponent(from)}`);
    expect(screen.queryByRole('button', { name: 'Save password' })).toBeNull();
    expect(Api.passwords.update).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Request another?' }));
    expect(screen.getByTestId('location').textContent).toBe(`/passwords/forgot?from=${encodeURIComponent(from)}`);
  });

  it('reloads into password login with the intended destination after a successful reset', async () => {
    const originalWindow = window;
    const assign = vi.fn();
    vi.stubGlobal('window', new Proxy(originalWindow, {
      get: (target, key) => key === 'location' ? { assign } : Reflect.get(target, key, target),
    }));
    Api.passwords.update.mockResolvedValueOnce({ data: { status: true } });
    try {
      const user = open(`/passwords/reset?token=test-token&from=${encodeURIComponent(from)}`);
      await user.type(screen.getByLabelText('New password'), 'a new long password{Enter}');
      await waitFor(() => expect(assign).toHaveBeenCalledWith(`/login?passwordReset=success&from=${encodeURIComponent(from)}`));
      expect(Api.passwords.update).toHaveBeenCalledWith('test-token', 'a new long password');
    } finally {
      vi.stubGlobal('window', originalWindow);
    }
  });
});

describe('leaving a session', () => {
  it('uses the shared logout action to switch accounts without leaving an invitation', async () => {
    const invitedEmail = 'invited@example.com';
    Api.users.me.mockResolvedValue({ status: 200, data: profile });
    Api.invites.get.mockResolvedValue({ data: { email: invitedEmail } });
    Api.auth.logout.mockImplementationOnce(async () => {
      Api.users.me.mockResolvedValue({ status: 204, data: null });
      return { data: { status: true } };
    });
    const user = open('/invites/invitation-id');
    await user.click(await screen.findByRole('button', { name: 'Log out to accept invitation' }));
    expect(await screen.findByLabelText('Email', { exact: true })).toBeTruthy();
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(invitedEmail);
    expect(screen.getByTestId('location').textContent).toBe('/invites/invitation-id');
    expect(screen.queryByRole('link', { name: 'Test!' })).toBeNull();
    expect(Api.auth.logout).toHaveBeenCalledTimes(1);
  });

  it('shows a logout error and keeps the current user signed in when logout fails', async () => {
    Api.users.me.mockResolvedValue({ status: 200, data: profile });
    Api.auth.logout.mockRejectedValueOnce({ _form: 'Unable to log out. Please try again.' });
    const user = open('/account');
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('Unable to log out. Please try again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test!' })).toBeTruthy();
  });

  it('clears cached private profiles on logout before another account can log in', async () => {
    Api.users.me.mockResolvedValue({ status: 200, data: profile });
    Api.auth.logout.mockImplementationOnce(async () => {
      Api.users.me.mockResolvedValue({ status: 204, data: null });
      return { data: { status: true } };
    });
    const user = open('/account');
    await screen.findByRole('button', { name: 'Log out' });
    user.queryClient.setQueryData(['users', profile.id], { data: profile });
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('Home destination');
    await waitFor(() => {
      expect(user.queryClient.getQueryData(['users', profile.id])).toBeUndefined();
      expect(screen.queryByRole('link', { name: 'Test!' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
    });
  });
});
