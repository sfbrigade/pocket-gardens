import { useState } from 'react';
import { Alert, Button, Combobox, Group, Loader, Modal, Stack, Text, TextInput, useCombobox } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { isNotEmpty, useForm } from '@mantine/form';
import { useInfiniteQuery } from '@tanstack/react-query';
import Api from '../Api';

export default function PlantPicker ({ onSelect, disabled }) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [adding, setAdding] = useState(false);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const query = useInfiniteQuery({
    queryKey: ['plant-directory', debounced],
    queryFn: ({ signal, pageParam }) => Api.plants.index({ search: debounced, pageSize: 10, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (response) => response.headers['x-next-offset'] ?? undefined,
    enabled: !!debounced && !disabled,
  });
  const matches = query.data?.pages.flatMap(({ data }) => data) ?? [];
  const newPlant = useForm({ initialValues: { plantName: '', commonName: '', latinName: '' }, validate: { plantName: isNotEmpty('Plant name is required') } });
  function select (value) {
    if (value === '__more__') {
      query.fetchNextPage();
      return;
    } else if (value === '__new__') {
      newPlant.setValues({ plantName: search.trim(), commonName: '', latinName: '' });
      setAdding(true);
    } else {
      const plant = matches.find(({ id }) => id === value);
      if (plant) onSelect({ plantId: plant.id, label: plant.plantName || plant.commonName || plant.latinName });
      setSearch('');
    }
    combobox.closeDropdown();
  }
  return (
    <>
      <Combobox store={combobox} onOptionSubmit={select}>
        <Combobox.Target>
          <TextInput label='Find a plant' placeholder='Search plant, common, or scientific name' disabled={disabled} value={search} onChange={(event) => { setSearch(event.currentTarget.value); combobox.openDropdown(); combobox.updateSelectedOptionIndex(); }} onFocus={() => combobox.openDropdown()} onBlur={() => combobox.closeDropdown()} rightSection={query.isFetching ? <Loader size='xs' /> : <Combobox.Chevron />} />
        </Combobox.Target>
        <Combobox.Dropdown hidden={!search.trim()}>
          <Combobox.Options>
            {query.isError && <Combobox.Empty>Unable to search. <Button variant='subtle' size='compact-xs' onMouseDown={(event) => event.preventDefault()} onClick={() => query.refetch()}>Retry search</Button></Combobox.Empty>}
            {matches.map((plant) => <Combobox.Option key={plant.id} value={plant.id}><Text size='sm'>{plant.plantName || plant.commonName || plant.latinName}</Text>{plant.latinName && <Text size='xs' c='dimmed'>{plant.latinName}</Text>}</Combobox.Option>)}
            {query.hasNextPage && <Combobox.Option value='__more__' disabled={query.isFetching}>Show more matches</Combobox.Option>}
            {!query.isError && !query.isFetching && debounced === search.trim() && query.data && <Combobox.Option value='__new__'>+ Add a new plant: {search.trim()}</Combobox.Option>}
            {query.isFetching && <Combobox.Empty>Searching directory…</Combobox.Empty>}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      <Modal opened={adding} onClose={() => setAdding(false)} title='Add a new plant'>
        <form onSubmit={(event) => {
          event.stopPropagation(); newPlant.onSubmit((values) => {
            const plant = { plantName: values.plantName.trim(), ...(values.commonName.trim() ? { commonName: values.commonName.trim() } : {}), ...(values.latinName.trim() ? { latinName: values.latinName.trim() } : {}) };
            onSelect({ newPlant: plant, label: plant.plantName }); setAdding(false); setSearch('');
          })(event);
        }}
        >
          <Stack>
            <Alert color='gray'>Review the directory matches first. This plant will be added to the directory when you save the garden.</Alert>
            <TextInput label='Plant name' required {...newPlant.getInputProps('plantName')} />
            <TextInput label='Common name' {...newPlant.getInputProps('commonName')} />
            <TextInput label='Scientific name' {...newPlant.getInputProps('latinName')} />
            <Group><Button type='submit'>Add to this draft</Button><Button variant='subtle' onClick={() => setAdding(false)}>Cancel</Button></Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
