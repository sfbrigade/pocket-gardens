import { useState } from 'react';
import { Button, Combobox, Group, Loader, Stack, Text, TextInput, useCombobox } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useInfiniteQuery } from '@tanstack/react-query';
import Api from '../Api';

export default function CarerPicker ({ value, onChange, error, disabled, canAssign }) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const query = useInfiniteQuery({
    queryKey: ['carer-directory', debounced],
    queryFn: ({ signal, pageParam }) => Api.plots.carers({ search: debounced, offset: pageParam, pageSize: 10 }, signal),
    initialPageParam: 0,
    getNextPageParam: (response) => response.headers['x-next-offset'] ?? undefined,
    enabled: !!debounced && !disabled && canAssign,
  });
  const currentSearch = debounced === search.trim();
  const matches = currentSearch ? query.data?.pages.flatMap(({ data }) => data).filter(({ id }) => !value.some(({ userId }) => userId === id)) ?? [] : [];
  return (
    <Stack gap='xs'>
      <Combobox
        store={combobox} onOptionSubmit={(id) => {
          if (disabled || !canAssign || !currentSearch) return;
          if (id === '__more__') { query.fetchNextPage(); return; }
          const user = matches.find((user) => user.id === id);
          if (!user) return;
          onChange([...value, { userId: user.id, displayName: user.displayName }]);
          setSearch('');
          combobox.closeDropdown();
        }}
      >
        <Combobox.Target>
          <TextInput
            label='Who looks after it' description='Optional. Select registered users. You can add more than one person.'
            placeholder='Search by name or email' value={search} disabled={disabled || !canAssign} error={error}
            onChange={(event) => { setSearch(event.currentTarget.value); combobox.openDropdown(); combobox.updateSelectedOptionIndex(); }}
            onFocus={() => combobox.openDropdown()} onBlur={() => combobox.closeDropdown()}
            rightSection={query.isFetching ? <Loader size='xs' /> : <Combobox.Chevron />}
          />
        </Combobox.Target>
        <Combobox.Dropdown hidden={!search.trim() || !canAssign}>
          <Combobox.Options style={{ maxHeight: 'min(15rem, 40vh)', overflowY: 'auto' }}>
            {matches.map(({ id, displayName, email }) => (
              <Combobox.Option key={id} value={id}><Text size='sm'>{displayName}</Text>{email && <Text size='xs' c='dimmed'>{email}</Text>}</Combobox.Option>
            ))}
            {currentSearch && query.hasNextPage && <Combobox.Option value='__more__' disabled={query.isFetching}>Show more matches</Combobox.Option>}
            {currentSearch && query.isError && <Combobox.Empty>Unable to search. <Button variant='subtle' size='compact-xs' onMouseDown={(event) => event.preventDefault()} onClick={() => query.refetch()}>Retry search</Button></Combobox.Empty>}
            {query.isFetching && <Combobox.Empty>Searching registered users…</Combobox.Empty>}
            {!query.isError && !query.isFetching && currentSearch && query.data && !matches.length && !query.hasNextPage && <Combobox.Empty>No other registered users found.</Combobox.Empty>}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {!canAssign && <Text c='dimmed' size='sm'>Sign in with a staff account to keep these carers, or remove them before creating the garden.</Text>}
      {value.map(({ userId, displayName }) => (
        <Group key={userId} justify='space-between' wrap='nowrap'>
          <Text style={{ overflowWrap: 'anywhere' }}>{displayName}</Text>
          <Button variant='subtle' size='compact-sm' disabled={disabled} aria-label={`Remove ${displayName}`} onClick={() => onChange(value.filter((carer) => carer.userId !== userId))}>Remove</Button>
        </Group>
      ))}
      <Text c='dimmed' size='sm'>Steward and carer are the same relationship here. It can be added later.</Text>
    </Stack>
  );
}
