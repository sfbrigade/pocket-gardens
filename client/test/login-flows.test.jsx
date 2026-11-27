import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/client';

import Api from '../src/Api';
import { setSession } from './mock-auth-client';
import StaticContextProvider from '../src/StaticContextProvider';
import AuthContextProvider from '../src/AuthContextProvider';
import Header from '../src/Header';
import Login from '../src/Login';
import EmailLink from '../src/EmailLink';
import Register from '../src/Register';
import ForgotPassword from '../src/Passwords/ForgotPassword';
import ResetPassword from '../src/Passwords/ResetPassword';
import Invite from '../src/Invites/Invite';
import UserForm from '../src/Users/UserForm';
import AppRedirects from '../src/AppRedirects';

vi.mock('../src/Api', () => ({
  default: {
    auth: {
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      sendVerificationEmail: vi.fn(),
      verifyEmail: vi.fn(),
      sendMagicLink: vi.fn(),
    },
    passwords: { reset: vi.fn(), update: vi.fn() },
    users: { me: vi.fn(), get: vi.fn(), update: vi.fn() },
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

function open (entry = '/login', { accountEditor = false } = {}) {
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
                <AppRedirects>
                  <Routes>
                    <Route path='/login' element={<Login />} />
                    <Route path='/register' element={<Register />} />
                    <Route path='/invites/:inviteId' element={<Invite />} />
                    <Route path='/passwords/forgot' element={<ForgotPassword />} />
                    <Route path='/passwords/reset' element={<ResetPassword />} />
                    <Route path='/auth/verify-email' element={<EmailLink action='verify-email' />} />
                    <Route path='/auth/magic-link' element={<EmailLink action='magic-link' />} />
                    <Route path='/account' element={accountEditor ? <UserForm /> : <div>Account destination</div>} />
                    <Route path='/' element={<div>Home destination</div>} />
                  </Routes>
                </AppRedirects>
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
  setSession(null);
  Api.users.me.mockResolvedValue({ status: 200, data: profile });
  Api.auth.login.mockImplementation(async () => { setSession(profile); return { data: { user: profile } }; });
  Api.auth.logout.mockImplementation(async () => { setSession(null); return { data: { status: true } }; });
  Api.auth.sendMagicLink.mockResolvedValue({ data: { status: true } });
  Api.auth.sendVerificationEmail.mockResolvedValue({ data: { status: true } });
  Api.auth.verifyEmail.mockResolvedValue({ data: { status: true } });
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

  it('clears anonymous cached data and pending requests after explicit password login', async () => {
    const user = open(loginEntry);
    user.queryClient.setQueryData(['plots', 'capabilities'], { canAssignCarers: false });
    let complete;
    const pending = user.queryClient.fetchQuery({
      queryKey: ['people', 'private-person'],
      queryFn: () => new Promise(resolve => { complete = resolve; }),
    }).catch(() => {});
    await user.type(screen.getByLabelText('Email', { exact: true }), email);
    await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
    await user.type(screen.getByLabelText('Password', { exact: true }), 'test{Enter}');
    await screen.findByText('Account destination');
    await act(async () => { complete({ email: 'private@example.com' }); await pending; });
    expect(user.queryClient.getQueryData(['plots', 'capabilities'])).toBeUndefined();
    expect(user.queryClient.getQueryData(['people', 'private-person'])).toBeUndefined();
  });

  it('asks the SDK to confirm an expired session and preserves the protected destination', async () => {
    setSession(profile);
    Api.users.me.mockResolvedValueOnce({ status: 204, data: null });
    open(from);
    await screen.findByRole('button', { name: 'Email me a login link' });
    expect(new URL(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href'), 'http://app.test').searchParams.get('from')).toBe(from);
    expect(screen.queryByRole('link', { name: 'Test!' })).toBeNull();
  });

  it('hides the previous profile while the new identity profile is pending or fails', async () => {
    const previous = { ...profile, id: 'previous', firstName: 'Previous' };
    setSession(previous);
    Api.users.me.mockResolvedValue({ status: 200, data: previous });
    const user = open('/account');
    await screen.findByRole('link', { name: 'Previous!' });
    let rejectProfile;
    Api.users.me.mockReturnValueOnce(new Promise((resolve, reject) => { rejectProfile = reject; }));
    await act(async () => setSession(profile));
    expect(screen.queryByRole('link', { name: 'Previous!' })).toBeNull();
    await screen.findByLabelText('Loading session');
    await act(async () => rejectProfile(new Error('Profile unavailable')));
    await screen.findByText('Profile unavailable');
    expect(screen.queryByRole('link', { name: 'Previous!' })).toBeNull();
    expect(user.queryClient.getQueryData(['users', 'me', previous.id])).toBeUndefined();
  });

  it('cancels private queries and an old profile response when the SDK changes identity', async () => {
    const previous = { ...profile, id: 'previous', firstName: 'Previous', isAdmin: true };
    let finishProfile;
    setSession(previous);
    Api.users.me.mockReturnValueOnce(new Promise(resolve => { finishProfile = resolve; }));
    const user = open('/auth/magic-link?token=test-token');
    await waitFor(() => expect(Api.users.me).toHaveBeenCalled());
    user.queryClient.setQueryData(['users', previous.id], { data: previous });
    user.queryClient.setQueryData(['plots', 'capabilities'], { canAssignCarers: true });
    user.queryClient.setQueryData(['plot-editor', previous.id, 'garden', true], { staffPermissionNotes: 'Staff only' });
    const publicGarden = { id: 'garden', stage: 'potential' };
    let completeGarden;
    const pendingGarden = user.queryClient.fetchQuery({
      queryKey: ['plot', 'garden'],
      queryFn: () => new Promise(resolve => { completeGarden = resolve; }),
    }).catch(() => {});
    let complete;
    const pending = user.queryClient.fetchQuery({
      queryKey: ['people', 'private-person'],
      queryFn: () => new Promise(resolve => { complete = resolve; }),
    }).catch(() => {});
    await act(async () => setSession(profile));
    await screen.findByRole('link', { name: 'Test!' });
    await act(async () => {
      finishProfile({ status: 200, data: previous });
      complete({ email: 'private@example.com' });
      completeGarden(publicGarden);
      await pending;
      await pendingGarden;
    });
    expect(user.queryClient.getQueryData(['users', 'me', profile.id])).toEqual(profile);
    expect(user.queryClient.getQueryData(['users', previous.id])).toBeUndefined();
    expect(user.queryClient.getQueryData(['plots', 'capabilities'])).toBeUndefined();
    expect(user.queryClient.getQueryData(['plot-editor', previous.id, 'garden', true])).toBeUndefined();
    expect(user.queryClient.getQueryData(['plot', 'garden'])).toEqual(publicGarden);
    expect(user.queryClient.getQueryData(['people', 'private-person'])).toBeUndefined();
    expect(screen.queryByRole('link', { name: 'Previous!' })).toBeNull();
  });

  it('navigates through native verification only after confirming a magic link', async () => {
    const originalWindow = window;
    const assign = vi.fn();
    vi.stubGlobal('window', new Proxy(originalWindow, {
      get: (target, key) => key === 'location' ? { assign } : Reflect.get(target, key, target),
    }));
    try {
      const user = open(`/auth/magic-link?token=test-token&from=${encodeURIComponent(from)}`);
      expect(assign).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Log in' }));
      const url = new URL(assign.mock.calls[0][0], 'http://app.test');
      expect(url.pathname).toBe('/api/auth/magic-link/verify');
      expect(url.searchParams.get('token')).toBe('test-token');
      expect(url.searchParams.get('callbackURL')).toBe(from);
      expect(new URL(url.searchParams.get('errorCallbackURL'), url).searchParams.get('from')).toBe(from);
    } finally {
      vi.stubGlobal('window', originalWindow);
    }
  });

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
  for (const method of ['password', 'magic-link']) {
    it(`keeps the invitation and return destination through ${method} registration`, async () => {
      Api.invites.get.mockResolvedValue({ data: { email } });
      const user = open(`/invites/invitation-id?from=${encodeURIComponent(from)}`);
      await user.type(await screen.findByLabelText('First name'), 'Test');
      await user.type(screen.getByLabelText('Last name'), 'Member');
      if (method === 'password') {
        await user.click(screen.getByRole('radio', { name: 'Register with password' }));
        await user.type(screen.getByLabelText('Password', { exact: true }), 'a long password');
      }
      await user.click(screen.getByRole('button', { name: method === 'password' ? 'Register with password' : 'Email me a registration link' }));
      await waitFor(() => expect(Api.auth.register).toHaveBeenCalledWith(expect.objectContaining({
        email,
        inviteId: 'invitation-id',
        registrationMethod: method,
        callbackURL: method === 'password' ? `/login?from=${encodeURIComponent(from)}` : from,
      })));
      expect(await screen.findByText(method === 'password'
        ? 'Please check your email to verify your account before logging in.'
        : /Check your inbox for a link to complete registration/)).toBeTruthy();
      expect(screen.getByTestId('location').textContent).toBe(`/login?from=${encodeURIComponent(from)}`);
    });
  }

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

  for (const [code, message] of [
    ['BANNED_USER', 'Your account has been deactivated.'],
    ['REGISTRATION_CLOSED', 'Registration is closed. A valid invitation is required.'],
    ['INVALID_INVITATION', 'This invitation is invalid or no longer available.'],
    ['__proto__', 'This link is invalid or has expired. Please request a new one.'],
  ]) {
    it(`shows the ${code} callback error with a safe return link`, async () => {
      const user = open(`/auth/magic-link?error=${code}&from=${encodeURIComponent(from)}`);
      await screen.findByText(message);
      expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
      await user.click(screen.getByRole('link', { name: 'Back to login' }));
      expect(screen.getByTestId('location').textContent).toBe(`/login?from=${encodeURIComponent(from)}`);
    });
  }

  it('keeps email confirmation available when a signed-in profile read fails', async () => {
    setSession(profile);
    Api.users.me.mockRejectedValueOnce(new Error('Profile service unavailable'));
    open(`/auth/magic-link?error=INVALID_TOKEN&from=${encodeURIComponent(from)}`);
    await waitFor(() => expect(Api.users.me).toHaveBeenCalled());
    await screen.findByText('This link is invalid or has expired. Please request a new one.');
    expect(screen.queryByText('Profile service unavailable')).toBeNull();
  });

  it('retains the destination when requesting another expired login link', async () => {
    const user = open(`/auth/magic-link?error=INVALID_TOKEN&from=${encodeURIComponent(from)}`);
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

describe('session refresh across tabs', () => {
  for (const { name, nextUser, clearCache } of [
    { name: 'another account signs in', nextUser: { ...profile, id: 'current', firstName: 'Current' }, clearCache: true },
    { name: 'the account signs out', nextUser: null, clearCache: true },
    { name: 'the same account refreshes its profile', nextUser: { ...profile, id: 'previous', firstName: 'Updated' }, clearCache: false },
  ]) {
    it(`${clearCache ? 'clears' : 'preserves'} cached data when focus returns and ${name}`, async () => {
      const previous = { ...profile, id: 'previous', firstName: 'Previous' };
      setSession(previous);
      Api.users.me.mockResolvedValue({ status: 200, data: previous });
      const user = open('/account');
      await screen.findByRole('link', { name: 'Previous!' });
      user.queryClient.setQueryData(['users', previous.id], { data: previous });
      user.queryClient.setQueryData(['plots', 'capabilities'], { canAssignCarers: true });
      const privatePerson = { email: 'private@example.com' };
      user.queryClient.setQueryData(['people', 'private-person'], privatePerson);
      let complete;
      const pending = user.queryClient.fetchQuery({
        queryKey: ['people', 'private-person'],
        queryFn: () => new Promise(resolve => { complete = resolve; }),
      }).catch(() => {});
      Api.users.me.mockResolvedValue({ status: nextUser ? 200 : 204, data: nextUser });
      await act(async () => { setSession(nextUser); await user.queryClient.invalidateQueries({ queryKey: ['users', 'me', nextUser?.id] }); });
      await screen.findByRole('link', { name: nextUser ? `${nextUser.firstName}!` : 'Log in', exact: true });
      expect(user.queryClient.getQueryData(['users', 'me', nextUser?.id]) ?? null).toEqual(nextUser);
      expect(user.queryClient.getQueryData(['users', previous.id])).toEqual(clearCache ? undefined : { data: previous });
      expect(user.queryClient.getQueryData(['plots', 'capabilities'])).toEqual(clearCache ? undefined : { canAssignCarers: true });
      expect(user.queryClient.getQueryData(['people', 'private-person'])).toEqual(clearCache ? undefined : privatePerson);
      await act(async () => { complete(privatePerson); await pending; });
      expect(user.queryClient.getQueryData(['people', 'private-person'])).toEqual(clearCache ? undefined : privatePerson);
    });
  }
});

describe('leaving a session', () => {
  for (const switchAccount of [false, true]) {
    it(`ignores an old profile save after ${switchAccount ? 'logging in as another account' : 'logging out'}`, async () => {
      const previous = { ...profile, id: 'previous', firstName: 'Previous', picture: null, emailVerified: true };
      const current = { ...profile, id: 'current', firstName: 'Current' };
      setSession(previous);
      Api.users.me.mockResolvedValue({ status: 200, data: previous });
      Api.users.get.mockResolvedValue({ data: previous });
      let finishSave;
      const save = new Promise(resolve => { finishSave = resolve; });
      Api.users.update.mockReturnValue(save);
      Api.auth.logout.mockImplementation(async () => {
        setSession(null);
        Api.users.me.mockResolvedValue({ status: 204, data: null });
        return { data: { status: true } };
      });
      Api.auth.login.mockImplementation(async () => {
        setSession(current);
        Api.users.me.mockResolvedValue({ status: 200, data: current });
        return { data: current };
      });
      const user = open('/account', { accountEditor: true });
      await user.type(await screen.findByLabelText('First name'), 'Edited');
      await user.click(screen.getByRole('button', { name: 'Submit', exact: true }));
      await waitFor(() => expect(Api.users.update).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Log out' }));
      await screen.findByText('Home destination');
      await screen.findByRole('link', { name: 'Log in', exact: true });
      if (switchAccount) {
        await user.click(screen.getByRole('link', { name: 'Log in', exact: true }));
        await user.type(screen.getByLabelText('Email', { exact: true }), email);
        await user.click(screen.getByRole('radio', { name: 'Log in with password' }));
        await user.type(screen.getByLabelText('Password', { exact: true }), 'a long password{Enter}');
        await screen.findByRole('link', { name: 'Current!' });
      }
      // A failed refresh must not leave the old mutation's identity in the UI.
      Api.users.me.mockRejectedValue(new Error('Session profile refresh unavailable'));
      await act(async () => { finishSave({ data: { ...previous, firstName: 'PreviousEdited' } }); await save; });
      expect(user.queryClient.getQueryData(['users', 'me', current.id]) ?? null).toEqual(switchAccount ? current : null);
      expect(user.queryClient.getQueryData(['users', previous.id])).toBeUndefined();
      expect(screen.queryByRole('link', { name: 'PreviousEdited!' })).toBeNull();
    });
  }

  it('updates the current profile and session after an ordinary profile save', async () => {
    const current = { ...profile, picture: null, emailVerified: true };
    const updated = { ...current, firstName: 'Updated' };
    setSession(current);
    Api.users.me.mockResolvedValue({ status: 200, data: current });
    Api.users.get.mockResolvedValue({ data: current });
    Api.users.update.mockImplementation(async () => {
      Api.users.me.mockResolvedValue({ status: 200, data: updated });
      Api.users.get.mockResolvedValue({ data: updated });
      return { data: updated };
    });
    const user = open('/account', { accountEditor: true });
    const firstName = await screen.findByLabelText('First name');
    await user.clear(firstName);
    await user.type(firstName, updated.firstName);
    await user.click(screen.getByRole('button', { name: 'Submit', exact: true }));
    expect(await screen.findByText('Your account has been updated!')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Updated!' })).toBeTruthy();
    expect(user.queryClient.getQueryData(['users', 'me', current.id])).toEqual(updated);
  });

  it('uses the shared logout action to switch accounts without leaving an invitation', async () => {
    const invitedEmail = 'invited@example.com';
    setSession(profile);
    Api.users.me.mockResolvedValue({ status: 200, data: profile });
    Api.invites.get.mockResolvedValue({ data: { email: invitedEmail } });
    Api.auth.logout.mockImplementationOnce(async () => {
      setSession(null);
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
    setSession(profile);
    Api.users.me.mockResolvedValue({ status: 200, data: profile });
    Api.auth.logout.mockRejectedValueOnce({ _form: 'Unable to log out. Please try again.' });
    const user = open('/account');
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('Unable to log out. Please try again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test!' })).toBeTruthy();
  });

  it('clears cached private profiles on logout before another account can log in', async () => {
    setSession(profile);
    Api.users.me.mockResolvedValue({ status: 200, data: profile });
    Api.auth.logout.mockImplementationOnce(async () => {
      setSession(null);
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
