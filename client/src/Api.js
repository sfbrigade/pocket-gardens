/* eslint-disable no-throw-literal */

import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import { capitalize } from 'inflection';

const instance = axios.create({
  headers: {
    Accept: 'application/json',
  },
});

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === StatusCodes.UNAUTHORIZED && !error.config?.url?.startsWith('/api/auth/') && typeof window !== 'undefined') {
      window.location = '/login';
    }
    return Promise.reject(error);
  }
);

function parseLinkHeader (response) {
  const link = response.headers?.link;
  if (link) {
    const linkRe = /<([^>]+)>; rel="([^"]+)"/g;
    const urls = {};
    let m;
    while ((m = linkRe.exec(link)) !== null) {
      const url = m[1];
      urls[m[2]] = url;
    }
    return urls;
  }
  return null;
}

function calculateLastPage (response, page) {
  const linkHeader = parseLinkHeader(response);
  let newLastPage = page;
  if (linkHeader?.last) {
    const match = linkHeader.last.match(/page=(\d+)/);
    newLastPage = parseInt(match[1], 10);
  } else if (linkHeader?.next) {
    newLastPage = page + 1;
  }
  return newLastPage;
}

function handleError (error) {
  const errors = {};
  if (error.response?.status === StatusCodes.UNPROCESSABLE_ENTITY) {
    for (const err of error.response.data.errors) {
      errors[err.path] ||= new Set();
      errors[err.path].add(err.message);
    }
    for (const key of Object.keys(errors)) {
      errors[key] = capitalize([...errors[key]].join(', '));
    }
  } else {
    errors._form = error.message;
  }
  throw errors;
}

function handleAuthError (error) {
  const code = error.response?.data?.code;
  if (code === 'INVALID_EMAIL_OR_PASSWORD') throw { _form: 'Invalid email and/or password.' };
  if (code === 'EMAIL_NOT_VERIFIED') throw { _form: 'Please verify your email before logging in.', _code: code };
  if (code === 'BANNED_USER') throw { _form: 'Your account has been deactivated.' };
  if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED') throw { _form: 'This link is invalid or has expired. Please request a new one.' };
  if (error.response?.status === StatusCodes.TOO_MANY_REQUESTS) throw { _form: 'Too many attempts. Please try again in a few minutes.' };
  throw { _form: error.response?.data?.message || error.message };
}

async function loadAuthenticatedUser () {
  const response = await Api.users.me().catch(handleAuthError);
  if (response.status !== StatusCodes.OK || !response.data?.id) {
    throw { _form: 'Your session could not be confirmed. Please log in again.' };
  }
  return response;
}

const Api = {
  calculateLastPage,
  parseLinkHeader,
  assets: {
    create (data, signal) {
      return instance.post('/api/assets', data, { signal });
    },
    upload (url, headers, file, signal) {
      return instance.put(url, file, { headers, signal });
    },
  },
  auth: {
    async login (email, password) {
      await instance.post('/api/auth/sign-in/email', { email, password }).catch(handleAuthError);
      return loadAuthenticatedUser();
    },
    logout () {
      return instance.post('/api/auth/sign-out', {}).catch(handleAuthError);
    },
    register ({ registrationMethod = 'password', password, ...data }) {
      if (registrationMethod === 'magic-link') {
        const { email, firstName, lastName, inviteId, callbackURL } = data;
        return instance.post('/api/auth/sign-in/magic-link', {
          email,
          ...(callbackURL ? { callbackURL } : {}),
          metadata: { registration: { firstName, lastName, inviteId } },
        }).catch(handleAuthError);
      }
      return instance.post('/api/auth/sign-up/email', { ...data, password }).catch(handleAuthError);
    },
    sendVerificationEmail (email, callbackURL) {
      return instance.post('/api/auth/send-verification-email', { email, ...(callbackURL ? { callbackURL } : {}) }).catch(handleAuthError);
    },
    verifyEmail (token) {
      return instance.get('/api/auth/verify-email', { params: { token } }).catch(handleAuthError);
    },
    sendMagicLink (email, callbackURL) {
      return instance.post('/api/auth/sign-in/magic-link', { email, ...(callbackURL ? { callbackURL } : {}) }).catch(handleAuthError);
    },
    async verifyMagicLink (token) {
      await instance.get('/api/auth/magic-link/verify', { params: { token } }).catch(handleAuthError);
      return loadAuthenticatedUser();
    },
  },
  invites: {
    index (page = 1) {
      return instance.get('/api/invites', { params: { page } });
    },
    create (data) {
      return instance.post('/api/invites', data).catch(handleError);
    },
    get (id) {
      return instance.get(`/api/invites/${id}`);
    },
    accept (id, data) {
      return instance.post(`/api/invites/${id}/accept`, data);
    },
    resend (id) {
      return instance.patch(`/api/invites/${id}/resend`);
    },
    revoke (id) {
      return instance.delete(`/api/invites/${id}`);
    },
  },
  passwords: {
    reset (email, redirectTo) {
      return instance.post('/api/auth/request-password-reset', { email, ...(redirectTo ? { redirectTo } : {}) }).catch(handleAuthError);
    },
    update (token, password) {
      return instance.post('/api/auth/reset-password', { token, newPassword: password }).catch(handleAuthError);
    },
  },
  people: {
    index (page = 1, search) {
      return instance.get('/api/people', { params: { page, search } });
    },
  },
  plots: {
    carers (params, signal) {
      return instance.get('/api/plots/carers', { params, signal });
    },
    capabilities (signal) {
      return instance.get('/api/plots/capabilities', { signal });
    },
    get (id, signal) {
      return instance.get(`/api/plots/${encodeURIComponent(id)}`, { signal });
    },
    create (data) {
      return instance.post('/api/plots', data).catch((error) => {
        if (error.response?.status === StatusCodes.CONFLICT) {
          throw { _form: error.response.data.message, plotId: error.response.data.plotId };
        }
        return handleError(error);
      });
    },
    index ({ north, south, east, west, offset, pageSize = 100 }, signal) {
      return instance.get('/api/plots', {
        params: { north, south, east, west, offset, pageSize },
        signal,
      });
    },
  },
  plants: {
    index (params, signal) {
      return instance.get('/api/plants', { params, signal });
    },
  },
  users: {
    index (page = 1) {
      return instance.get('/api/users', { params: { page } });
    },
    me () {
      return instance.get('/api/users/me');
    },
    get (id) {
      return instance.get(`/api/users/${id}`);
    },
    update (id, { firstName, lastName, picture }) {
      const data = { firstName, lastName, ...(picture === undefined ? {} : { picture: picture || null }) };
      return instance.patch(`/api/users/${id}`, data).catch(handleError);
    },
    setRole (id, role) {
      return instance.post('/api/auth/admin/set-role', { userId: id, role }).catch(handleAuthError);
    },
  },
};

export default Api;
