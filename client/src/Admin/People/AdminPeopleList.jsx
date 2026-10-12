import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Anchor, Button, Container, Group, Loader, Table, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from 'src/Api';
import Pagination from 'components/Pagination';

function AdminPeopleList () {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const search = searchParams.get('search') ?? '';

  const form = useForm({
    initialValues: {
      search,
    },
  });

  const [lastPage, setLastPage] = useState(1);

  const { data: people, isLoading } = useQuery({
    queryKey: ['people', page, search],
    queryFn: async () => {
      const response = await Api.people.index(page, search);
      setLastPage(Api.calculateLastPage(response, page));
      return response.data;
    },
  });

  return (
    <>
      <Head>
        <title>Manage People</title>
      </Head>
      <Container>
        <Title mb='md'>Manage People</Title>
        <form
          onSubmit={form.onSubmit((values) => {
            setSearchParams({
              search: values.search,
              page: '1',
            });
          })}
        >
          <TextInput
            {...form.getInputProps('search')}
            label='Search people'
          />
          <Group>
            <Button type='submit'>Search</Button>
          </Group>
        </form>
        <Table.ScrollContainer>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>First name</Table.Th>
                <Table.Th>Last name</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Phone</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading &&
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Group justify='center' py='lg'><Loader /></Group>
                  </Table.Td>
                </Table.Tr>}
              {!isLoading && people?.length === 0 &&
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    No people found.
                  </Table.Td>
                </Table.Tr>}
              {!isLoading && people?.map((person) => (
                <Table.Tr key={person.id}>
                  <Table.Td>{person.firstName}</Table.Td>
                  <Table.Td>{person.lastName}</Table.Td>
                  <Table.Td>
                    {person.email && (
                      <Anchor href={`mailto:${person.email}`}>
                        {person.email}
                      </Anchor>
                    )}
                  </Table.Td>
                  <Table.Td>{person.phone}</Table.Td>
                  <Table.Td>
                    <Anchor component={Link} to={`${person.id}`}>View Person</Anchor>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Pagination page={page} lastPage={lastPage} otherParams={{ search }} />
        </Table.ScrollContainer>
      </Container>
    </>
  );
}

export default AdminPeopleList;
