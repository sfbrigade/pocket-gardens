import { expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/client';

import Api from '../src/Api';
import AdminPeopleList from '../src/Admin/People/AdminPeopleList';

it('keeps pagination with the displayed People results when an earlier search finishes last', async () => {
  const earlierSearch = Promise.withResolvers();
  const index = vi.spyOn(Api.people, 'index')
    .mockReturnValueOnce(earlierSearch.promise)
    .mockResolvedValueOnce({ data: [{ id: 'alice', firstName: 'Alice', lastName: 'Smith' }] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();

  render(
    <UnheadProvider head={createHead()}>
      <MemoryRouter initialEntries={['/admin/people?search=Smith&page=1']}>
        <QueryClientProvider client={queryClient}>
          <MantineProvider>
            <AdminPeopleList />
          </MantineProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </UnheadProvider>
  );

  expect(index).toHaveBeenCalledWith(1, 'Smith');
  const search = screen.getByRole('textbox', { name: 'Search people' });
  await user.clear(search);
  await user.type(search, 'Alice Smith');
  await user.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await screen.findByRole('cell', { name: 'Alice' });

  await act(async () => {
    earlierSearch.resolve({
      data: [{ id: 'bob', firstName: 'Bob', lastName: 'Smith' }],
      headers: { link: '</api/people?search=Smith&page=4>; rel="last"' },
    });
  });

  expect(queryClient.getQueryState(['people', 1, 'Smith'])?.status).toBe('success');
  expect(screen.getByRole('cell', { name: 'Alice' })).toBeTruthy();
  expect(screen.queryByRole('cell', { name: 'Bob' })).toBeNull();
  expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe('/admin/people?search=Alice+Smith&page=1');
  expect(screen.queryByRole('link', { name: '4' })).toBeNull();
});
