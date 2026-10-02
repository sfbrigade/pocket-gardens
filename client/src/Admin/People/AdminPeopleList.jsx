import { useState } from 'react';
import { useLocation } from 'react-router';
import { Anchor, Container, Group, Loader, Table, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Head } from '@unhead/react';

import Api from 'src/Api';
import Pagination from 'components/Pagination';

function AdminPeopleList () {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const page = parseInt(params.get('page') ?? '1', 10);
  const [lastPage, setLastPage] = useState(1);

  const { data: people, isLoading } = useQuery({
    queryKey: ['people', page],
    queryFn: async () => {
      const response = await Api.people.index(page);
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
        <Table.ScrollContainer>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>First name</Table.Th>
                <Table.Th>Last name</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Phone</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Td colSpan={4}>
                  <Group justify='center' py='lg'>
                    <Loader />
                  </Group>
                </Table.Td>
              )}
              {!isLoading &&
                people?.map((person) => (
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
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
          <Pagination page={page} lastPage={lastPage} />
        </Table.ScrollContainer>
      </Container>
    </>
  );
}

export default AdminPeopleList;
